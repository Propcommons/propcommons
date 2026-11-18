// The validator pipeline. Takes one version folder and returns the spec's result object.
// It reads that folder and nothing else, except that MAN-PARENT and CMP-REFS check whether
// other version folders exist in the same working tree.
//
// Order (from the implementation brief):
//   1. file list and sizes, before parsing anything (FOLDER-FILES, FILE-SIZE)
//   2. the manifest (MAN-SCHEMA, MAN-PATH, MAN-PARENT)
//   3. the Khronos validator on model.glb (FILE-VALID); stop the model checks on failure
//   4. read the model with glTF-Transform and measure once
//   5. every remaining rule as a pure function of document, manifest, measurements and budgets
//   6. return every result, not just the first failure
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import gltfValidator from "gltf-validator";
import { externalUris, readGlb } from "./glb.ts";
import {
  boundsOf,
  checkHull,
  placedPrimitives,
  round,
  size,
  texelDensity,
  textureMeasures,
  triangleCount,
  type Vec3,
} from "./measure.ts";
import { assetVersionState, parseVersionPath, relPosix, type VersionPath } from "./paths.ts";
import {
  type AssetMeasured,
  type CompositionMeasured,
  passes,
  type RuleResult,
  result,
  type ValidationResult,
} from "./result.ts";
import { fileExt, MODEL_RULES } from "./rules/model.ts";
import { schemaProblems, validateAssetManifest, validateCompositionManifest } from "./schemas.ts";
import { BUDGETS, type SizeClass, SPEC_VERSION } from "./spec.ts";

/** Thrown when the validator cannot run at all (exit code 2), e.g. the folder does not exist. */
export class CannotValidate extends Error {}

export interface ValidateOptions {
  /** Repository root used for the target label and for MAN-PARENT / CMP-REFS lookups. */
  root?: string;
}

const ASSET_FILES = { required: ["asset.json", "model.glb"], optional: ["collision.glb"] };
const COMPOSITION_FILES = { required: ["composition.json"], optional: [] as string[] };

interface Listing {
  files: Map<string, number>; // name → size in bytes, regular files only
  unexpected: string[];
}

function listFolder(dir: string): Listing {
  const files = new Map<string, number>();
  const unexpected: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const st = lstatSync(path.join(dir, name));
    // Symlinks and sub-folders are never followed or read.
    if (st.isFile()) files.set(name, st.size);
    else unexpected.push(`${name}${st.isDirectory() ? "/" : " (not a regular file)"}`);
  }
  return { files, unexpected };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const emptyAssetMeasured = (): AssetMeasured => ({
  bounds_m: null,
  triangles: null,
  materials: null,
  textures: [],
  texel_density_px_per_m: null,
  file_bytes: null,
  sha256: null,
});

/** Runs the Khronos glTF Validator; returns its error messages (empty when valid). */
async function khronosErrors(
  bytes: Uint8Array,
  uri: string,
  /** JSON pointers of external URIs already reported by FILE-EMBEDDED; their load errors are skipped. */
  externalPointers: Set<string> = new Set(),
): Promise<string[]> {
  try {
    const report = await gltfValidator.validateBytes(bytes, {
      uri,
      maxIssues: 0,
      format: "glb",
      // Never load anything from outside the file.
      externalResourceFunction: () =>
        Promise.reject(new Error("external resources are not loaded")),
    });
    return (report.issues?.messages ?? [])
      .filter(
        (m: any) => m.severity === 0 && !(m.code === "IO_ERROR" && externalPointers.has(m.pointer)),
      )
      .map((m: any) => `${m.code} at ${m.pointer ?? "/"}: ${m.message}`);
  } catch (e) {
    return [`the file could not be parsed (${e instanceof Error ? e.message : String(e)})`];
  }
}

let io: NodeIO | null = null;
function getIO(): NodeIO {
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS);
  return io;
}

/**
 * Checks the folder's file list and sizes before anything is parsed. Returns the names of files
 * that are safe to read.
 */
function checkFiles(
  listing: Listing,
  expected: { required: string[]; optional: string[] },
  results: RuleResult[],
): Set<string> {
  const allowed = new Set([...expected.required, ...expected.optional]);
  const problems: string[] = [];
  const missing = expected.required.filter((f) => !listing.files.has(f));
  if (missing.length) problems.push(`missing ${missing.join(", ")}`);
  const extra = [
    ...[...listing.files.keys()].filter((f) => !allowed.has(f)),
    ...listing.unexpected,
  ];
  if (extra.length) problems.push(`unexpected ${extra.join(", ")}`);
  if (problems.length)
    results.push(
      result("FOLDER-FILES", extra.length ? extra : missing, [...allowed], {
        detail: `The folder is ${problems.join("; ")}.`,
      }),
    );
  const readable = new Set<string>();
  for (const name of allowed) {
    const bytes = listing.files.get(name);
    if (bytes === undefined) continue;
    const limit = name.endsWith(".json")
      ? BUDGETS.files.maxManifestBytes
      : BUDGETS.files.maxAnyFileBytes;
    if (bytes > limit) {
      results.push(
        result("FILE-SIZE", bytes, limit, { file: name, context: " for any file of this kind" }),
      );
      continue; // rejected unread
    }
    readable.add(name);
  }
  return readable;
}

function readJsonFile(
  file: string,
  ruleId: "MAN-SCHEMA" | "CMP-SCHEMA",
  results: RuleResult[],
): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    results.push(
      result(ruleId, null, null, {
        detail: `is not valid JSON: ${e instanceof Error ? e.message : String(e)}.`,
      }),
    );
    return undefined;
  }
}

function checkPath(manifest: any, vp: VersionPath | null, results: RuleResult[]) {
  if (!manifest || typeof manifest !== "object") return;
  const expected = vp ? `${vp.author}/${vp.slug} version ${vp.version}` : null;
  const actual = `${manifest.id} version ${manifest.version}`;
  if (!vp) {
    results.push(
      result(
        "MAN-PATH",
        actual,
        "not in the layout assets/author/slug/vN or compositions/author/slug/vN",
      ),
    );
  } else if (manifest.id !== `${vp.author}/${vp.slug}` || manifest.version !== vp.version) {
    results.push(result("MAN-PATH", actual, expected));
  }
}

export async function validateFolder(
  folder: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const dir = path.resolve(folder);
  let listing: Listing;
  try {
    if (!lstatSync(dir).isDirectory()) throw new Error("not a folder");
    listing = listFolder(dir);
  } catch (e) {
    throw new CannotValidate(
      `Cannot read the folder ${folder}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const vp = parseVersionPath(dir);
  const root = options.root ? path.resolve(options.root) : (vp?.root ?? path.dirname(dir));
  const target = relPosix(root, dir) || ".";

  // A takedown: a folder that holds only tombstone.json passes and is skipped by every other rule.
  if (
    listing.files.size === 1 &&
    listing.files.has("tombstone.json") &&
    !listing.unexpected.length
  ) {
    return { spec: SPEC_VERSION, target, kind: "tombstone", pass: true, results: [], measured: {} };
  }

  const isComposition =
    vp?.kind === "composition" || (!vp && listing.files.has("composition.json"));
  return isComposition
    ? validateComposition(dir, root, target, vp, listing)
    : validateAsset(dir, root, target, vp, listing);
}

async function validateAsset(
  dir: string,
  root: string,
  target: string,
  vp: VersionPath | null,
  listing: Listing,
): Promise<ValidationResult> {
  const results: RuleResult[] = [];
  const measured = emptyAssetMeasured();

  // 1. Files and sizes, before parsing anything.
  const readable = checkFiles(listing, ASSET_FILES, results);

  // 2. Manifest.
  let manifest: any;
  let sizeClass: SizeClass | null = null;
  if (readable.has("asset.json")) {
    manifest = readJsonFile(path.join(dir, "asset.json"), "MAN-SCHEMA", results);
    if (manifest !== undefined) {
      for (const p of schemaProblems(validateAssetManifest, manifest))
        results.push(result("MAN-SCHEMA", null, null, { detail: `${p.path} ${p.message}.` }));
      checkPath(manifest, vp, results);
      if (["small", "medium", "large"].includes(manifest?.size_class))
        sizeClass = manifest.size_class;
      if (typeof manifest?.parent === "string") {
        const state = assetVersionState(root, manifest.parent);
        if (state !== "live")
          results.push(
            result("MAN-PARENT", manifest.parent, null, {
              detail: state === "missing" ? "does not exist" : "has been taken down",
            }),
          );
      }
    }
  }

  // Size budget for the declared class, now that it is known.
  if (sizeClass) {
    const max = BUDGETS.sizeClasses[sizeClass].maxFileBytes;
    for (const name of ["model.glb", "collision.glb"]) {
      const bytes = listing.files.get(name);
      if (readable.has(name) && bytes !== undefined && bytes > max) {
        results.push(
          result("FILE-SIZE", bytes, max, { file: name, context: ` for size class ${sizeClass}` }),
        );
      }
    }
  }

  // 3. The Khronos validator, then the raw-JSON checks that must happen before any library
  //    could try to follow an external URI.
  let doc: Document | null = null;
  let json: any = null;
  if (readable.has("model.glb")) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, "model.glb")));
    measured.file_bytes = bytes.byteLength;
    measured.sha256 = sha256(bytes);
    // Find external URIs from the raw JSON first, so FILE-EMBEDDED (not FILE-VALID) reports them.
    let ext: string[] = [];
    const pointers = new Set<string>();
    try {
      const raw = readGlb(bytes).json;
      ext = externalUris(raw);
      for (const k of ["buffers", "images"] as const)
        (raw[k] ?? []).forEach((x: any, i: number) => {
          if (typeof x?.uri === "string" && !x.uri.startsWith("data:"))
            pointers.add(`/${k}/${i}/uri`);
        });
    } catch {
      // Not a readable GLB; the Khronos validator will say why.
    }
    const errors = await khronosErrors(bytes, "model.glb", pointers);
    if (errors.length) {
      results.push(
        result("FILE-VALID", errors.length, 0, {
          file: "model.glb",
          detail:
            errors.slice(0, 3).join("; ") +
            (errors.length > 3 ? ` (and ${errors.length - 3} more)` : ""),
        }),
      );
    } else {
      json = readGlb(bytes).json;
      const extResults = fileExt(json);
      results.push(...extResults);
      if (ext.length) {
        results.push(
          result("FILE-EMBEDDED", ext, null, { file: "model.glb", detail: ext.join(", ") }),
        );
      } else {
        // 4. Read with glTF-Transform and measure once.
        try {
          doc = await getIO().readBinary(bytes);
        } catch (e) {
          // An unsupported required extension already failed FILE-EXT; don't report it twice.
          if (!extResults.length)
            results.push(
              result("FILE-VALID", 1, 0, {
                file: "model.glb",
                detail: `it could not be read: ${e instanceof Error ? e.message : String(e)}`,
              }),
            );
        }
      }
    }
  }

  let modelBounds: ReturnType<typeof boundsOf> = null;
  if (doc && json) {
    const prims = placedPrimitives(doc);
    modelBounds = boundsOf(prims.flatMap((p) => p.positions));
    const ctx = {
      doc,
      json,
      sizeClass,
      prims,
      bounds: modelBounds,
      triangles: triangleCount(prims),
      materials: doc.getRoot().listMaterials().length,
      texelDensity: texelDensity(prims),
    };
    measured.bounds_m = modelBounds ? size(modelBounds) : null;
    measured.triangles = ctx.triangles;
    measured.materials = ctx.materials;
    measured.textures = textureMeasures(doc);
    measured.texel_density_px_per_m = ctx.texelDensity;
    // 5. Every remaining rule.
    for (const rule of MODEL_RULES) results.push(...rule(ctx));
  }

  if (readable.has("collision.glb")) {
    results.push(...(await collisionRules(path.join(dir, "collision.glb"), modelBounds)));
  }

  return { spec: SPEC_VERSION, target, kind: "asset", pass: passes(results), results, measured };
}

async function collisionRules(
  file: string,
  modelBounds: ReturnType<typeof boundsOf>,
): Promise<RuleResult[]> {
  const out: RuleResult[] = [];
  const bytes = new Uint8Array(readFileSync(file));
  const errors = await khronosErrors(bytes, "collision.glb");
  if (errors.length) {
    return [result("COL-CLEAN", `an invalid glTF binary (${errors[0]})`, null)];
  }
  const json = readGlb(bytes).json;
  const found: string[] = [];
  for (const k of [
    "materials",
    "textures",
    "images",
    "samplers",
    "cameras",
    "animations",
    "skins",
  ]) {
    if (Array.isArray(json[k]) && json[k].length) found.push(`${json[k].length} ${k}`);
  }
  if (json.extensionsUsed?.length) found.push(`extensions ${json.extensionsUsed.join(", ")}`);
  const ext = externalUris(json);
  if (ext.length) found.push(`external files ${ext.join(", ")}`);
  if (found.length) out.push(result("COL-CLEAN", found.join(", "), null));
  if (ext.length) return out; // never follow an external URI

  let doc: Document;
  try {
    doc = await getIO().readBinary(bytes);
  } catch (e) {
    out.push(
      result("COL-CLEAN", `unreadable data (${e instanceof Error ? e.message : String(e)})`, null),
    );
    return out;
  }
  const hulls = placedPrimitives(doc);
  const c = BUDGETS.collision;
  const problems: string[] = [];
  if (hulls.length > c.maxHulls)
    problems.push(`There are ${hulls.length} collision meshes; the limit is ${c.maxHulls}.`);
  hulls.forEach((h, i) => {
    const name = h.node.getName() || `mesh ${i + 1}`;
    if (h.primitive.getMode() !== 4) {
      problems.push(`Collision mesh "${name}" is not a triangle list.`);
      return;
    }
    const hull = checkHull(h);
    if (hull.vertices > c.maxHullVertices)
      problems.push(
        `Collision mesh "${name}" has ${hull.vertices} vertices; the limit is ${c.maxHullVertices}.`,
      );
    if (!hull.closed) problems.push(`Collision mesh "${name}" is not closed.`);
    else if (hull.maxOutside > c.convexTolerance_m)
      problems.push(
        `Collision mesh "${name}" is not convex: a vertex lies ${round(hull.maxOutside, 4)} m outside a face.`,
      );
  });
  if (problems.length)
    out.push(
      result("COL-CONVEX", hulls.length, c.maxHulls, {
        detail: problems.join(" "),
        hulls: c.maxHulls,
        vertices: c.maxHullVertices,
      }),
    );

  const colBounds = boundsOf(hulls.flatMap((h) => h.positions));
  if (modelBounds && colBounds) {
    let worst = 0;
    let allowance = 0;
    for (let a = 0; a < 3; a++) {
      const extent = (modelBounds.max[a] as number) - (modelBounds.min[a] as number);
      const tol = extent * c.boundsTolerance + BUDGETS.tolerances.length_m;
      const over = Math.max(
        (modelBounds.min[a] as number) - (colBounds.min[a] as number) - tol,
        (colBounds.max[a] as number) - (modelBounds.max[a] as number) - tol,
      );
      if (over > worst) {
        worst = over;
        allowance = tol;
      }
    }
    if (worst > 0) out.push(result("COL-BOUNDS", round(worst + allowance, 4), round(allowance, 4)));
  }
  return out;
}

async function validateComposition(
  dir: string,
  root: string,
  target: string,
  vp: VersionPath | null,
  listing: Listing,
): Promise<ValidationResult> {
  const results: RuleResult[] = [];
  const measured: CompositionMeasured = { items: null, file_bytes: null, sha256: null };
  const readable = checkFiles(listing, COMPOSITION_FILES, results);
  if (readable.has("composition.json")) {
    const file = path.join(dir, "composition.json");
    const bytes = new Uint8Array(readFileSync(file));
    measured.file_bytes = bytes.byteLength;
    measured.sha256 = sha256(bytes);
    const c: any = readJsonFile(file, "CMP-SCHEMA", results);
    if (c !== undefined) {
      for (const p of schemaProblems(validateCompositionManifest, c))
        results.push(result("CMP-SCHEMA", null, null, { detail: `${p.path} ${p.message}.` }));
      checkPath(c, vp, results);
      const items: unknown[] = Array.isArray(c?.items) ? c.items : [];
      measured.items = items.length;
      const b = BUDGETS.composition;
      if (Array.isArray(c?.items) && (items.length < b.minItems || items.length > b.maxItems))
        results.push(result("CMP-COUNT", items.length, b.maxItems, { min: b.minItems }));
      items.forEach((item: any, i) => {
        const index = i + 1;
        if (typeof item?.asset === "string") {
          const state = assetVersionState(root, item.asset);
          if (state !== "live")
            results.push(
              result("CMP-REFS", item.asset, null, {
                index,
                detail: state === "missing" ? "does not exist" : "has been taken down",
              }),
            );
        }
        if (
          Array.isArray(item?.rotation) &&
          item.rotation.every((n: unknown) => typeof n === "number")
        ) {
          const len = Math.hypot(...(item.rotation as number[]));
          if (Math.abs(len - 1) > BUDGETS.tolerances.quaternionLength)
            results.push(
              result("CMP-ROT", round(len, 6), BUDGETS.tolerances.quaternionLength, { index }),
            );
        }
        if (typeof item?.scale === "number" && (item.scale < b.minScale || item.scale > b.maxScale))
          results.push(result("CMP-SCALE", item.scale, b.maxScale, { index, min: b.minScale }));
      });
    }
  }
  return {
    spec: SPEC_VERSION,
    target,
    kind: "composition",
    pass: passes(results),
    results,
    measured,
  };
}

export type { Vec3 };
