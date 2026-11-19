// Repository-level operations shared by the command line, the MCP server and CI:
// finding the repository root, creating a new asset from the template, running the pull-request
// checks together with folder validation, and building index.json.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assetVersionState, HANDLE, isRealDir, PINNED, parseVersionPath, SLUG } from "./paths.ts";
import type { ValidationResult } from "./result.ts";
import { type ChangedFile, type ChangeStatus, checkPr, type PrCheckResult } from "./rules/pr.ts";
import { type SizeClass, SPEC_VERSION } from "./spec.ts";
import { validateFolder } from "./validate.ts";

/** Walks up from `start` to the folder holding project.config.json. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "project.config.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

export function readMaintainers(root: string): string[] {
  const file = path.join(root, "MAINTAINERS");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim().toLowerCase())
    .filter(Boolean);
}

// ---- init ----

export interface InitOptions {
  root: string;
  /** "author/slug" */
  id: string;
  name?: string;
  sizeClass?: SizeClass;
  tags?: string[];
  aiAssisted?: boolean;
  tools?: string[];
  /** The author's credit roles; defaults to directed when AI-assisted, otherwise modeled. */
  roles?: string[];
}

export class UsageError extends Error {}

function titleCase(slug: string): string {
  const words = slug.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Copies template/ to assets/<author>/<slug>/v1 and fills in the manifest. Returns the folder. */
export function initAsset(o: InitOptions): string {
  const [author, slug, ...rest] = o.id.split("/");
  if (!author || !slug || rest.length || !HANDLE.test(author) || !SLUG.test(slug))
    throw new UsageError(
      `"${o.id}" is not a valid ID. Use author/slug: your GitHub handle in lower case, then lower-case letters, digits and hyphens, e.g. alice/strawberry-whole.`,
    );
  const slugDir = path.join(o.root, "assets", author, slug);
  if (isRealDir(slugDir) && readdirSync(slugDir).length)
    throw new UsageError(
      `${path.relative(o.root, slugDir)} already exists. To make a better version of it, use "propcommons improve" (or the MCP tool improve_asset) instead.`,
    );
  const template = path.join(o.root, "template");
  const dir = path.join(slugDir, "v1");
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(template, "model.glb"), path.join(dir, "model.glb"));
  const manifest = JSON.parse(readFileSync(path.join(template, "asset.json"), "utf8"));
  Object.assign(manifest, {
    id: `${author}/${slug}`,
    version: 1,
    name: o.name ?? titleCase(slug),
    size_class: o.sizeClass ?? manifest.size_class,
    tags: o.tags ?? manifest.tags,
    credits: [{ github: author, roles: o.roles ?? (o.aiAssisted ? ["directed"] : ["modeled"]) }],
    ai_assisted: o.aiAssisted ?? manifest.ai_assisted,
    tools: o.tools ?? manifest.tools,
  });
  writeFileSync(path.join(dir, "asset.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- improve ----

export interface ImproveOptions {
  root: string;
  /** The asset to start from: "author/slug" (its latest version) or "author/slug@N". */
  from: string;
  /** The GitHub handle of the person making the improvement. */
  author: string;
  /** Slug for a new asset under another author's handle; defaults to the original's slug. */
  slug?: string;
  aiAssisted: boolean;
  tools: string[];
  roles?: string[];
}

export interface ImproveResult {
  /** The new version folder. */
  dir: string;
  /** The pinned version it starts from, e.g. alice/mug@2. */
  source: string;
  /** That version's folder. */
  sourceDir: string;
  /** True when the new folder is the next version of the same asset (same author). */
  sameAsset: boolean;
}

/** The version numbers of assets/<author>/<slug>/ that exist in a tree, highest first. */
function versionsOf(root: string, author: string, slug: string): number[] {
  const dir = path.join(root, "assets", author, slug);
  if (!isRealDir(dir)) return [];
  return readdirSync(dir)
    .map((n) => /^v([1-9][0-9]*)$/.exec(n)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .sort((a, b) => b - a);
}

/**
 * Starts an improvement of an existing asset: a copy of its version folder, model included, as
 * the next version (when the person is its author) or as a new asset under the person's own handle
 * with `parent` naming the original. The copy is the starting point; check-pr refuses it until
 * model.glb has changed.
 */
export function improveAsset(o: ImproveOptions): ImproveResult {
  const m =
    /^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:@([1-9][0-9]*))?$/.exec(
      o.from,
    );
  if (!m)
    throw new UsageError(
      `"${o.from}" is not an asset ID. Use author/slug for its latest version, or author/slug@N for one version, e.g. alice/mug@2.`,
    );
  const [, fromAuthor = "", fromSlug = ""] = m;
  if (!HANDLE.test(o.author))
    throw new UsageError(`"${o.author}" is not a GitHub handle. Use the handle in lower case.`);
  const live = versionsOf(o.root, fromAuthor, fromSlug).filter(
    (v) => assetVersionStateAt(o.root, fromAuthor, fromSlug, v) === "live",
  );
  if (!live.length)
    throw new UsageError(`There is no asset ${fromAuthor}/${fromSlug} in this clone.`);
  const version = m[3] ? Number(m[3]) : (live[0] as number);
  if (!live.includes(version))
    throw new UsageError(
      `${fromAuthor}/${fromSlug}@${version} does not exist or was taken down. Live versions: ${live.join(", ")}.`,
    );
  const source = `${fromAuthor}/${fromSlug}@${version}`;
  const sourceDir = path.join(o.root, "assets", fromAuthor, fromSlug, `v${version}`);
  const sameAsset = o.author === fromAuthor;
  const slug = sameAsset ? fromSlug : (o.slug ?? fromSlug);
  if (!SLUG.test(slug)) throw new UsageError(`"${slug}" is not a valid slug.`);
  const next = (versionsOf(o.root, o.author, slug)[0] ?? 0) + 1;
  const dir = path.join(o.root, "assets", o.author, slug, `v${next}`);
  mkdirSync(dir, { recursive: true });
  for (const f of ["model.glb", "collision.glb"])
    if (isRegularFile(path.join(sourceDir, f)))
      copyFileSync(path.join(sourceDir, f), path.join(dir, f));
  const manifest = JSON.parse(readFileSync(path.join(sourceDir, "asset.json"), "utf8"));
  const mine = { github: o.author, roles: o.roles ?? (o.aiAssisted ? ["directed"] : ["modeled"]) };
  // The person comes first; the original's credits stay, since the new version is built on it.
  const credits = [
    mine,
    ...(Array.isArray(manifest.credits) ? manifest.credits : []).filter(
      (c: { github?: string }) => c?.github !== o.author,
    ),
  ];
  Object.assign(manifest, {
    id: `${o.author}/${slug}`,
    version: next,
    credits,
    ai_assisted: o.aiAssisted || manifest.ai_assisted === true,
    tools: [...new Set(o.tools)],
    parent: sameAsset ? (manifest.parent ?? null) : source,
    source_url: null,
    notes_url: null,
  });
  writeFileSync(path.join(dir, "asset.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, source, sourceDir, sameAsset };
}

function assetVersionStateAt(root: string, author: string, slug: string, v: number) {
  return assetVersionState(root, `${author}/${slug}@${v}`);
}

/**
 * The pinned version whose model.glb is byte-for-byte the same as this folder's: its parent, or
 * the previous version of the same asset. Null when the model has changed (or there is nothing to
 * compare with). `base` is where those versions are looked up; it defaults to the folder's tree.
 * check-pr passes only = "parent": a new version of one's own asset may change just the manifest.
 */
export function unchangedFrom(folder: string, base?: string, only?: "parent"): string | null {
  const vp = parseVersionPath(folder);
  if (vp?.kind !== "asset") return null;
  const tree = base ?? vp.root;
  const model = path.join(folder, "model.glb");
  if (!isRegularFile(model)) return null;
  const candidates: string[] = [];
  try {
    const parent = JSON.parse(readFileSync(path.join(folder, "asset.json"), "utf8")).parent;
    if (typeof parent === "string" && PINNED.test(parent)) candidates.push(parent);
  } catch {
    // An unreadable manifest is reported by validate; there is nothing to compare here.
  }
  if (vp.version > 1 && only !== "parent")
    candidates.push(`${vp.author}/${vp.slug}@${vp.version - 1}`);
  const hash = sha256File(model);
  for (const ref of candidates) {
    const p = PINNED.exec(ref);
    if (!p) continue;
    const other = path.join(
      tree,
      "assets",
      p[1] as string,
      p[2] as string,
      `v${p[3]}`,
      "model.glb",
    );
    if (isRegularFile(other) && sha256File(other) === hash) return ref;
  }
  return null;
}

// ---- check-pr ----

export interface PullRequestCheck {
  spec: string;
  pass: boolean;
  kind: PrCheckResult["kind"];
  /** Set when the pull request cannot be checked as an asset pull request. */
  problem: string | null;
  pr: PrCheckResult;
  /** One validation result per version folder the pull request adds. */
  folders: ValidationResult[];
}

/** Parses `git diff --name-status` output. Renames count as a deletion plus an addition. */
export function parseNameStatus(text: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [code = "", ...paths] = line.split("\t");
    const letter = code.charAt(0);
    if (letter === "R" || letter === "C") {
      if (letter === "R" && paths[0]) out.push({ path: paths[0], status: "deleted" });
      if (paths[1]) out.push({ path: paths[1], status: "added" });
      continue;
    }
    const status: ChangeStatus = letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
    if (paths[0]) out.push({ path: paths[0], status });
  }
  return out;
}

export interface PullRequestInput {
  /** Checkout of the base branch: source of the merged-version list and the maintainers file. */
  baseRoot: string;
  /** Checkout of the pull request's head, read only as data. */
  headRoot: string;
  changed: ChangedFile[];
  author: string;
  body: string;
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function isRegularFile(file: string): boolean {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
}

/** True when a folder's model.glb is still the placeholder that `init` copies from template/. */
export function isPlaceholderModel(root: string, folder: string): boolean {
  const template = path.join(root, "template", "model.glb");
  const model = path.join(folder, "model.glb");
  return (
    isRegularFile(template) && isRegularFile(model) && sha256File(model) === sha256File(template)
  );
}

/** Changed paths (or any folder above them) that are symbolic links in the head checkout. */
function symlinksIn(headRoot: string, changed: ChangedFile[]): string[] {
  const found = new Set<string>();
  for (const c of changed) {
    if (c.status === "deleted") continue;
    const parts = c.path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join("/");
      try {
        if (lstatSync(path.join(headRoot, rel)).isSymbolicLink()) found.add(rel);
      } catch {
        break;
      }
    }
  }
  return [...found].sort();
}

export async function checkPullRequest(input: PullRequestInput): Promise<PullRequestCheck> {
  const pr = checkPr({
    author: input.author,
    body: input.body,
    changed: input.changed,
    baseRoot: input.baseRoot,
    maintainers: readMaintainers(input.baseRoot),
  });
  let problem: string | null = null;
  const links = symlinksIn(input.headRoot, input.changed);
  if (links.length)
    problem = `Symbolic links are not allowed in pull requests: ${links.join(", ")}. Replace them with the real files.`;
  else if (pr.kind === "mixed") {
    const other = input.changed
      .map((c) => c.path)
      .filter((p) => !p.startsWith("assets/") && !p.startsWith("compositions/"));
    problem = `This pull request changes assets and other files together. Please split it: one pull request that only adds asset or composition folders, and another for everything else. These files are not in assets/ or compositions/: ${other.join(", ")}. To take them out of this pull request, put them back as they are on the main branch (for example: git checkout upstream/main -- ${other[0] ?? "<file>"}), commit, and push.`;
  } else if (pr.kind === "code")
    problem = "This pull request changes no assets; it is checked by code CI.";
  const folders: ValidationResult[] = [];
  const placeholders: string[] = [];
  const copies: string[] = [];
  if (pr.kind === "assets") {
    const template = path.join(input.baseRoot, "template", "model.glb");
    const templateHash = existsSync(template) ? sha256File(template) : null;
    for (const rel of pr.folders) {
      const dir = path.join(input.headRoot, rel);
      if (!isRealDir(dir)) continue;
      folders.push(await validateFolder(dir, { root: input.headRoot }));
      const model = path.join(dir, "model.glb");
      if (templateHash && isRegularFile(model) && sha256File(model) === templateHash)
        placeholders.push(rel);
      const same = unchangedFrom(dir, input.baseRoot, "parent");
      if (same) copies.push(`${rel} (the same file as ${same})`);
    }
  }
  if (!problem && placeholders.length)
    problem = `${placeholders.join(", ")} still has the placeholder box from \`propcommons init\` as its model.glb. Replace it with your own model, then commit and push.`;
  if (!problem && copies.length)
    problem = `The model.glb in ${copies.join(", ")} has not changed. An improvement needs a better model: replace model.glb, then commit and push.`;
  return {
    spec: SPEC_VERSION,
    pass:
      !links.length &&
      !placeholders.length &&
      !copies.length &&
      pr.kind === "assets" &&
      pr.pass &&
      folders.every((f) => f.pass),
    kind: pr.kind,
    problem,
    pr,
    folders,
  };
}

// ---- build-index ----

export interface Credit {
  github?: string;
  name?: string;
  roles: string[];
}

export interface IndexAsset {
  id: string;
  version: number;
  ref: string;
  latest: boolean;
  taken_down: boolean;
  pass: boolean;
  path: string;
  files: { model: string; collision: string | null } | null;
  previews: { front: string; side: string; top: string; kit: string; thumb: string } | null;
  manifest: any;
  measured: any;
  sha256: string | null;
  credits: Credit[];
  tombstone: { reason: string; date: string; by: string } | null;
  results: ValidationResult["results"];
}

export interface IndexComposition {
  /** Path of a rendered image of the scene (three-quarter front view); null when taken down. */
  preview: string | null;
  id: string;
  version: number;
  ref: string;
  latest: boolean;
  taken_down: boolean;
  pass: boolean;
  path: string;
  manifest: any;
  items: any[];
  credits: Credit[];
  results: ValidationResult["results"];
}

export interface Index {
  spec: string;
  built: string;
  assets: IndexAsset[];
  compositions: IndexComposition[];
}

function versionFolders(
  root: string,
  top: "assets" | "compositions",
): { rel: string; author: string; slug: string; version: number }[] {
  const out: { rel: string; author: string; slug: string; version: number }[] = [];
  const base = path.join(root, top);
  if (!isRealDir(base)) return out;
  for (const author of readdirSync(base).sort()) {
    if (!isRealDir(path.join(base, author))) continue;
    for (const slug of readdirSync(path.join(base, author)).sort()) {
      if (!isRealDir(path.join(base, author, slug))) continue;
      for (const v of readdirSync(path.join(base, author, slug))) {
        const m = /^v([1-9][0-9]*)$/.exec(v);
        if (m && isRealDir(path.join(base, author, slug, v)))
          out.push({ rel: `${top}/${author}/${slug}/${v}`, author, slug, version: Number(m[1]) });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel, "en") || a.version - b.version);
}

const creditKey = (c: Credit) => (c.github ? `gh:${c.github}` : `name:${c.name}`);

/** Merges credit lists: one entry per person, with the union of their roles, in first-seen order. */
export function mergeCredits(lists: Credit[][]): Credit[] {
  const merged = new Map<string, Credit>();
  for (const list of lists) {
    for (const c of list ?? []) {
      const key = creditKey(c);
      const prev = merged.get(key);
      if (prev) prev.roles = [...new Set([...prev.roles, ...c.roles])];
      else merged.set(key, { ...c, roles: [...c.roles] });
    }
  }
  return [...merged.values()];
}

function buildDate(): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return (epoch ? new Date(Number(epoch) * 1000) : new Date()).toISOString();
}

/** Validates every version folder in the repository and builds the public index. */
export async function buildIndex(root: string): Promise<Index> {
  const assets: IndexAsset[] = [];
  const latest = (
    list: { version: number; author: string; slug: string }[],
    a: string,
    s: string,
  ) => Math.max(...list.filter((x) => x.author === a && x.slug === s).map((x) => x.version));

  const assetFolders = versionFolders(root, "assets");
  for (const f of assetFolders) {
    const dir = path.join(root, f.rel);
    const r = await validateFolder(dir, { root });
    const tomb = existsSync(path.join(dir, "tombstone.json")) && r.results.length === 0 && r.pass;
    const manifest = tomb ? null : readJson(path.join(dir, "asset.json"));
    const hasCollision = existsSync(path.join(dir, "collision.glb"));
    const previewBase = `previews/${f.author}/${f.slug}/v${f.version}`;
    assets.push({
      id: `${f.author}/${f.slug}`,
      version: f.version,
      ref: `${f.author}/${f.slug}@${f.version}`,
      latest: f.version === latest(assetFolders, f.author, f.slug),
      taken_down: tomb,
      pass: r.pass,
      path: f.rel,
      files: tomb
        ? null
        : {
            model: `${f.rel}/model.glb`,
            collision: hasCollision ? `${f.rel}/collision.glb` : null,
          },
      previews: tomb
        ? null
        : {
            front: `${previewBase}/front.png`,
            side: `${previewBase}/side.png`,
            top: `${previewBase}/top.png`,
            kit: `${previewBase}/kit.png`,
            thumb: `${previewBase}/thumb.png`,
          },
      manifest,
      measured: tomb ? null : r.measured,
      sha256: tomb ? null : ((r.measured as { sha256?: string | null }).sha256 ?? null),
      credits: [],
      tombstone: tomb ? readJson(path.join(dir, "tombstone.json")) : null,
      results: r.results,
    });
  }
  // Effective credits of an asset: its own, then those of its parent chain.
  const byRef = new Map(assets.map((a) => [a.ref, a]));
  const effective = (a: IndexAsset, seen = new Set<string>()): Credit[] => {
    if (seen.has(a.ref) || !a.manifest) return [];
    seen.add(a.ref);
    const parent = typeof a.manifest.parent === "string" ? byRef.get(a.manifest.parent) : undefined;
    return mergeCredits([a.manifest.credits ?? [], parent ? effective(parent, seen) : []]);
  };
  for (const a of assets) a.credits = effective(a);

  const compositions: IndexComposition[] = [];
  const compFolders = versionFolders(root, "compositions");
  for (const f of compFolders) {
    const dir = path.join(root, f.rel);
    const r = await validateFolder(dir, { root });
    const tomb = existsSync(path.join(dir, "tombstone.json")) && r.results.length === 0 && r.pass;
    const manifest = tomb ? null : readJson(path.join(dir, "composition.json"));
    const items: any[] = Array.isArray(manifest?.items) ? manifest.items : [];
    const pinned = items
      .map((i) =>
        typeof i?.asset === "string" && PINNED.test(i.asset) ? byRef.get(i.asset) : undefined,
      )
      .filter((a): a is IndexAsset => a !== undefined);
    compositions.push({
      preview: tomb ? null : `previews/compositions/${f.author}/${f.slug}/v${f.version}/scene.png`,
      id: `${f.author}/${f.slug}`,
      version: f.version,
      ref: `${f.author}/${f.slug}@${f.version}`,
      latest: f.version === latest(compFolders, f.author, f.slug),
      taken_down: tomb,
      pass: r.pass,
      path: f.rel,
      manifest,
      items,
      credits: manifest
        ? mergeCredits([manifest.credits ?? [], ...pinned.map((a) => a.credits)])
        : [],
      results: r.results,
    });
  }
  return { spec: SPEC_VERSION, built: buildDate(), assets, compositions };
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
