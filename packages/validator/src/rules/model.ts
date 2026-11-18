// Model rules: pure functions of the document, its raw JSON, the manifest, the measurements and
// the budgets. Each returns zero or more results for its own rule ID.
import type { Document } from "@gltf-transform/core";
import { listTextureInfoByMaterial } from "@gltf-transform/functions";
import { sniffImage } from "../glb.ts";
import {
  type Box,
  footprint,
  imageSize,
  type PlacedPrimitive,
  round,
  sceneNodes,
} from "../measure.ts";
import { type RuleResult, result } from "../result.ts";
import { BUDGETS, type SizeClass } from "../spec.ts";

export interface ModelContext {
  doc: Document;
  json: any;
  sizeClass: SizeClass | null;
  prims: PlacedPrimitive[];
  bounds: Box | null;
  triangles: number;
  materials: number;
  texelDensity: number | null;
}

type Rule = (c: ModelContext) => RuleResult[];

const TOL = BUDGETS.tolerances;

/** FILE-EXT runs on the raw JSON, before glTF-Transform reads the file. */
export const fileExt = (json: any): RuleResult[] => {
  const allow = new Set(BUDGETS.extensionAllowlist);
  const required: string[] = json.extensionsRequired ?? [];
  const used: string[] = json.extensionsUsed ?? [];
  const bad = [...required.map((e) => `${e} (required)`), ...used.filter((e) => !allow.has(e))];
  return bad.length
    ? [result("FILE-EXT", bad, BUDGETS.extensionAllowlist, { file: "model.glb" })]
    : [];
};

const isIdentity = (v: number[], identity: number[], tol: number) =>
  v.every((x, i) => Math.abs(x - (identity[i] as number)) <= tol);

const sceneRoot: Rule = ({ doc }) => {
  const scenes = doc.getRoot().listScenes();
  const problems: string[] = [];
  if (scenes.length !== 1)
    problems.push(`The file has ${scenes.length} scenes; it needs exactly 1.`);
  const roots = scenes[0]?.listChildren() ?? [];
  if (scenes.length >= 1 && roots.length !== 1)
    problems.push(`The scene has ${roots.length} root nodes; it needs exactly 1.`);
  const root = roots[0];
  if (root && roots.length === 1) {
    const moved = !isIdentity(root.getTranslation(), [0, 0, 0], TOL.length_m);
    const turned = !isIdentity(root.getRotation(), [0, 0, 0, 1], TOL.quaternionLength);
    const scaled = !isIdentity(root.getScale(), [1, 1, 1], TOL.scale);
    if (moved || turned || scaled) {
      const what = [moved && "translation", turned && "rotation", scaled && "scale"].filter(
        Boolean,
      );
      problems.push(`The root node "${root.getName()}" has a ${what.join(", ")}.`);
    }
  }
  return problems.map((detail) => result("SCENE-ROOT", null, null, { detail }));
};

const sceneScale: Rule = ({ doc }) =>
  sceneNodes(doc)
    .filter((n) => !isIdentity(n.getScale(), [1, 1, 1], TOL.scale))
    .map((n) =>
      result(
        "SCENE-SCALE",
        n.getScale().map((s) => round(s)),
        1,
        {
          node: n.getName() || "(unnamed)",
          measured: `[${n
            .getScale()
            .map((s) => round(s))
            .join(", ")}]`,
        },
      ),
    );

const sceneStatic: Rule = ({ json }) => {
  const found: string[] = [];
  const count = (k: string) => (Array.isArray(json[k]) ? json[k].length : 0);
  if (count("cameras")) found.push(`${count("cameras")} camera(s)`);
  if (count("animations")) found.push(`${count("animations")} animation(s)`);
  if (count("skins")) found.push(`${count("skins")} skin(s)`);
  const lights = json.extensions?.KHR_lights_punctual?.lights?.length ?? 0;
  if (lights) found.push(`${lights} light(s)`);
  const morphs = (json.meshes ?? []).reduce(
    (n: number, m: any) => n + (m.primitives ?? []).filter((p: any) => p.targets?.length).length,
    0,
  );
  if (morphs) found.push(`${morphs} primitive(s) with morph targets`);
  return found.length ? [result("SCENE-STATIC", found.join(", "), null)] : [];
};

export function classRange(c: SizeClass): string {
  const b = BUDGETS.sizeClasses[c];
  return `${b.minInclusive ? "" : "over "}${b.minLongestSide_m} to ${b.maxLongestSide_m}`;
}

const sizeClass: Rule = ({ bounds, sizeClass }) => {
  if (!bounds || !sizeClass) return [];
  const b = BUDGETS.sizeClasses[sizeClass];
  const longest = round(Math.max(...bounds.max.map((v, i) => v - (bounds.min[i] as number))));
  // Lengths get the 1 mm tolerance at both edges, in favour of the declared class.
  const tooSmall = b.minInclusive
    ? longest < b.minLongestSide_m - TOL.length_m
    : longest <= b.minLongestSide_m - TOL.length_m;
  const tooBig = longest > b.maxLongestSide_m + TOL.length_m;
  return tooSmall || tooBig
    ? [
        result("SIZE-CLASS", longest, [b.minLongestSide_m, b.maxLongestSide_m], {
          class: sizeClass,
          limit: classRange(sizeClass),
        }),
      ]
    : [];
};

const originY: Rule = ({ bounds }) => {
  if (!bounds) return [];
  const low = round(bounds.min[1]);
  if (Math.abs(low) <= TOL.length_m) return [];
  return [
    result("ORIGIN-Y", low, TOL.length_m, {
      measured: Math.abs(low),
      direction: low > 0 ? "above" : "below",
      fix: low > 0 ? "down" : "up",
      abs: Math.abs(low),
    }),
  ];
};

const originXZ: Rule = ({ bounds }) => {
  if (!bounds) return [];
  const inside =
    bounds.min[0] - TOL.length_m <= 0 &&
    bounds.max[0] + TOL.length_m >= 0 &&
    bounds.min[2] - TOL.length_m <= 0 &&
    bounds.max[2] + TOL.length_m >= 0;
  if (inside) return [];
  const f = footprint(bounds);
  return [result("ORIGIN-XZ", round(Math.hypot(...f.centre), 4), null)];
};

const originCenter: Rule = ({ bounds }) => {
  if (!bounds) return [];
  const f = footprint(bounds);
  const distance = Math.hypot(...f.centre);
  const limit = BUDGETS.origin.centerFraction * f.width;
  if (distance <= limit + TOL.length_m) return [];
  return [
    result("ORIGIN-CENTER", round(distance, 4), round(limit, 4), {
      dx: round(-f.centre[0], 4),
      dz: round(-f.centre[1], 4),
    }),
  ];
};

const MODE_NAMES = [
  "POINTS",
  "LINES",
  "LINE_LOOP",
  "LINE_STRIP",
  "TRIANGLES",
  "TRIANGLE_STRIP",
  "TRIANGLE_FAN",
];

const geoMode: Rule = ({ prims }) => {
  const bad = prims.filter((p) => p.primitive.getMode() !== 4);
  if (!bad.length) return [];
  const detail = bad
    .map(
      (p) =>
        `${p.node.getName() || "node"}: ${MODE_NAMES[p.primitive.getMode()] ?? p.primitive.getMode()}`,
    )
    .join("; ");
  return [result("GEO-MODE", bad.length, null, { detail })];
};

const geoTris: Rule = ({ triangles, sizeClass }) => {
  if (!sizeClass) return [];
  const max = BUDGETS.sizeClasses[sizeClass].maxTriangles;
  if (triangles <= max) return [];
  return [
    result("GEO-TRIS", triangles, max, {
      class: sizeClass,
      percent: Math.ceil((1 - max / triangles) * 100),
    }),
  ];
};

const geoAttrs: Rule = ({ prims }) => {
  const problems: string[] = [];
  for (const p of prims) {
    const sem = new Set(p.primitive.listSemantics());
    const missing: string[] = [];
    if (!sem.has("POSITION")) missing.push("POSITION");
    if (!sem.has("NORMAL")) missing.push("NORMAL");
    const material = p.primitive.getMaterial();
    if (material) {
      for (const info of listTextureInfoByMaterial(material)) {
        const uv = `TEXCOORD_${info.getTexCoord()}`;
        if (!sem.has(uv) && !missing.includes(uv)) missing.push(uv);
      }
    }
    if (missing.length) problems.push(`${p.node.getName() || "node"} lacks ${missing.join(", ")}`);
  }
  return problems.length
    ? [result("GEO-ATTRS", problems.length, null, { detail: problems.join("; ") })]
    : [];
};

const geoColor: Rule = ({ prims }) => {
  const n = prims.filter((p) =>
    p.primitive.listSemantics().some((s) => s.startsWith("COLOR_")),
  ).length;
  return n ? [result("GEO-COLOR", n, 0)] : [];
};

const matCount: Rule = ({ materials, sizeClass }) => {
  if (!sizeClass) return [];
  const max = BUDGETS.sizeClasses[sizeClass].maxMaterials;
  return materials > max ? [result("MAT-COUNT", materials, max, { class: sizeClass })] : [];
};

const matBlend: Rule = ({ doc }) => {
  const blend = doc
    .getRoot()
    .listMaterials()
    .filter((m) => m.getAlphaMode() === "BLEND");
  return blend.length
    ? [
        result("MAT-BLEND", blend.length, null, {
          detail: blend.map((m) => m.getName() || "(unnamed)").join(", "),
        }),
      ]
    : [];
};

const texFormat: Rule = ({ doc }) => {
  const bad: string[] = [];
  for (const [i, t] of doc.getRoot().listTextures().entries()) {
    const image = t.getImage();
    const kind = image ? sniffImage(image) : "unknown";
    const declared = t.getMimeType();
    const ok =
      (kind === "png" && declared === "image/png") ||
      (kind === "jpeg" && declared === "image/jpeg");
    if (!ok)
      bad.push(
        `${t.getName() || `image ${i}`} is ${kind === "unknown" ? "not PNG or JPEG" : kind} (declared ${declared || "none"})`,
      );
  }
  return bad.length ? [result("TEX-FORMAT", bad.length, null, { detail: bad.join("; ") })] : [];
};

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

const texSize: Rule = ({ doc, sizeClass }) => {
  if (!sizeClass) return [];
  const max = BUDGETS.sizeClasses[sizeClass].maxTextureSide_px;
  const out: RuleResult[] = [];
  for (const [i, t] of doc.getRoot().listTextures().entries()) {
    const dims = imageSize(t);
    if (!dims) continue; // an unreadable image is TEX-FORMAT's problem
    const { width, height } = dims;
    if (isPow2(width) && isPow2(height) && width <= max && height <= max) continue;
    out.push(
      result("TEX-SIZE", [width, height], max, {
        class: sizeClass,
        detail: t.getName() || `image ${i}`,
        measured: `${width}×${height}`,
      }),
    );
  }
  return out;
};

const texOrm: Rule = ({ doc }) => {
  const n = doc
    .getRoot()
    .listMaterials()
    .filter((m) => {
      const occ = m.getOcclusionTexture();
      const mr = m.getMetallicRoughnessTexture();
      return occ && mr && occ !== mr && occ.getImage() !== mr.getImage();
    }).length;
  return n ? [result("TEX-ORM", n, null)] : [];
};

const texDensity: Rule = ({ texelDensity }) => [
  result("TEX-DENSITY", texelDensity, null, {
    measured: texelDensity === null ? "not measurable (no textured triangles)" : texelDensity,
  }),
];

/** Model rules in spec order (FILE-VALID, FILE-EMBEDDED and FILE-EXT run earlier, on raw bytes). */
export const MODEL_RULES: Rule[] = [
  sceneRoot,
  sceneScale,
  sceneStatic,
  sizeClass,
  originY,
  originXZ,
  originCenter,
  geoMode,
  geoTris,
  geoAttrs,
  geoColor,
  matCount,
  matBlend,
  texFormat,
  texSize,
  texOrm,
  texDensity,
];
