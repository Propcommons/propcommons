// Preview rendering: four 1024 × 1024 PNGs per asset (front three-quarter, side, top, and a "kit"
// view beside up to two existing assets of the same size class), rendered by headless Chromium
// from the reference scene in ../scene. Works without a GPU (SwiftShader), and is deterministic.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  findRepoRoot,
  isRealDir,
  parseVersionPath,
  readGlb,
  UsageError,
} from "@propcommons/validator";
import { chromium } from "playwright";

const SCENE_DIR = path.join(import.meta.dirname, "..", "scene");
const require = createRequire(import.meta.url);
export const THREE_DIR = path.dirname(path.dirname(require.resolve("three"))); // node_modules/three
export const PREVIEW_VIEWS = ["front", "side", "top", "kit"] as const;
const ORIGIN = "http://preview.invalid";

export interface Neighbour {
  ref: string;
  model: string;
}

interface Manifest {
  id?: string;
  size_class?: string;
  tags?: string[];
}

function readManifest(dir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "asset.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Up to two existing assets of the same size class, preferring those that share the most tags,
 * then by ID. Only the latest live version of each asset is used.
 */
export function pickNeighbours(root: string, self: Manifest, max = 2): Neighbour[] {
  const base = path.join(root, "assets");
  if (!isRealDir(base) || !self.size_class) return [];
  const candidates: { ref: string; model: string; shared: number }[] = [];
  for (const author of readdirSync(base).sort()) {
    if (!isRealDir(path.join(base, author))) continue;
    for (const slug of readdirSync(path.join(base, author)).sort()) {
      const id = `${author}/${slug}`;
      if (id === self.id || !isRealDir(path.join(base, author, slug))) continue;
      const versions = readdirSync(path.join(base, author, slug))
        .map((v) => /^v([1-9][0-9]*)$/.exec(v))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]))
        .sort((a, b) => b - a);
      const latest = versions[0];
      if (latest === undefined) continue;
      const dir = path.join(base, author, slug, `v${latest}`);
      if (existsSync(path.join(dir, "tombstone.json"))) continue;
      const m = readManifest(dir);
      if (!m || m.size_class !== self.size_class || !existsSync(path.join(dir, "model.glb")))
        continue;
      const shared = (m.tags ?? []).filter((t) => self.tags?.includes(t)).length;
      candidates.push({ ref: `${id}@${latest}`, model: path.join(dir, "model.glb"), shared });
    }
  }
  candidates.sort((a, b) => b.shared - a.shared || a.ref.localeCompare(b.ref, "en"));
  return candidates.slice(0, max).map(({ ref, model }) => ({ ref, model }));
}

export interface PreviewResult {
  /** The four review images, plus `thumb` (a close-up of the asset alone) and, for assets that
   *  use extensions, `fallback` (the close-up with every extension removed). */
  files: Record<(typeof PREVIEW_VIEWS)[number], string> & { thumb?: string; fallback?: string };
  neighbours: string[];
  bounds_m: [number, number, number];
}

/** Renders the four previews of one asset version folder into outDir. */
/** If a model uses glTF extensions, writes a copy with all of them removed and returns its path. */
async function withoutExtensions(model: string): Promise<string | null> {
  let used: string[] = [];
  try {
    used = readGlb(new Uint8Array(readFileSync(model))).json.extensionsUsed ?? [];
  } catch {
    return null;
  }
  if (!used.length) return null;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(readFileSync(model)));
  for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
  const out = path.join(mkdtempSync(path.join(tmpdir(), "propcommons-fallback-")), "model.glb");
  writeFileSync(out, await io.writeBinary(doc));
  return out;
}

export async function renderPreviews(
  folder: string,
  opts: { root?: string; outDir?: string; thumbnail?: boolean } = {},
): Promise<PreviewResult> {
  const dir = path.resolve(folder);
  const vp = parseVersionPath(dir);
  const root = path.resolve(opts.root ?? vp?.root ?? findRepoRoot(dir));
  const manifest = readManifest(dir);
  if (!manifest) throw new UsageError(`${folder} has no readable asset.json.`);
  const model = path.join(dir, "model.glb");
  if (!existsSync(model)) throw new UsageError(`${folder} has no model.glb.`);
  const outDir = path.resolve(
    opts.outDir ??
      path.join(
        root,
        "previews",
        vp ? `${vp.author}/${vp.slug}/v${vp.version}` : path.basename(dir),
      ),
  );
  const sizeClass = ["small", "medium", "large"].includes(manifest.size_class ?? "")
    ? manifest.size_class
    : "small";
  const neighbours = pickNeighbours(root, manifest);

  // An asset that uses extensions (the glass ones) also gets a "fallback" image: the same model
  // with every extension removed, as an engine that ignores them would show it.
  const fallbackModel = await withoutExtensions(model);
  const { browser, page, errors } = await openScenePage([
    ["/files/model.glb", model],
    ...(fallbackModel ? [["/files/fallback.glb", fallbackModel] as [string, string]] : []),
    ...neighbours.map((n, i): [string, string] => [`/files/neighbour-${i}.glb`, n.model]),
  ]);
  try {
    const shots = (await page.evaluate(
      (job) =>
        (
          window as unknown as { renderJob(j: unknown): Promise<Record<string, unknown>> }
        ).renderJob(job),
      {
        model: "/files/model.glb",
        sizeClass,
        neighbours: neighbours.map((_, i) => `/files/neighbour-${i}.glb`),
      },
    )) as Record<string, string> & { bounds: [number, number, number] };
    if (errors.length) throw new Error(`The preview page failed: ${errors.join("; ")}`);
    mkdirSync(outDir, { recursive: true });
    const files = {} as PreviewResult["files"];
    for (const view of PREVIEW_VIEWS) {
      const data = shots[view];
      if (typeof data !== "string" || !data.startsWith("data:image/png;base64,"))
        throw new Error(`No ${view} image was rendered.`);
      const file = path.join(outDir, `${view}.png`);
      writeFileSync(file, Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
      files[view] = file;
    }
    // A close-up of the asset alone (no scale cube), so small assets can be judged; the site
    // also uses it for gallery cards.
    if (typeof shots.thumb === "string") {
      const file = path.join(outDir, "thumb.png");
      writeFileSync(
        file,
        Buffer.from(shots.thumb.slice("data:image/png;base64,".length), "base64"),
      );
      files.thumb = file;
    }
    if (fallbackModel) {
      const data = (await page.evaluate(
        (job) =>
          (window as unknown as { renderThumb(j: unknown): Promise<string> }).renderThumb(job),
        { model: "/files/fallback.glb" },
      )) as string;
      const file = path.join(outDir, "fallback.png");
      writeFileSync(file, Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
      files.fallback = file;
    }
    return { files, neighbours: neighbours.map((n) => n.ref), bounds_m: shots.bounds };
  } finally {
    await browser.close();
  }
}

/**
 * Opens the reference scene page in headless Chromium. Only the scene, the pinned Three.js and
 * the given extra files are served; every other request is refused.
 */
async function openScenePage(extra: [string, string][]) {
  const served = new Map<string, string>([
    ["/scene/render.html", path.join(SCENE_DIR, "render.html")],
    ["/scene/render.js", path.join(SCENE_DIR, "render.js")],
    ["/scene/stage.js", path.join(SCENE_DIR, "stage.js")],
    ["/scene/studio.hdr", path.join(SCENE_DIR, "studio.hdr")],
    ...extra,
  ]);
  const contentType = (p: string) =>
    p.endsWith(".html")
      ? "text/html"
      : p.endsWith(".js")
        ? "text/javascript"
        : p.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/octet-stream";
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-gpu-driver-bug-workarounds",
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Executable doesn't exist|playwright install/i.test(msg))
      throw new UsageError(
        "Previews need a headless browser that isn't installed yet. Run this once (about 200 MB), then try again:\n  npx playwright install --only-shell chromium",
      );
    throw e;
  }
  const context = await browser.newContext({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    let file = served.get(url.pathname);
    if (!file && url.pathname.startsWith("/vendor/three/")) {
      const rel = url.pathname.slice("/vendor/three/".length);
      const candidate = rel.startsWith("addons/")
        ? path.join(THREE_DIR, "examples/jsm", rel.slice("addons/".length))
        : path.join(THREE_DIR, "build", rel);
      // Stay inside the three package.
      if (candidate.startsWith(THREE_DIR + path.sep) && existsSync(candidate)) file = candidate;
    }
    if (!file) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: contentType(file), body: readFileSync(file) });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${ORIGIN}/scene/render.html`);
    await page.waitForFunction(
      () => (window as unknown as { previewReady?: boolean }).previewReady === true,
      null,
      { timeout: 30_000 },
    );
  } catch (e) {
    await browser.close();
    throw e;
  }
  return { browser, page, errors };
}

export interface CompositionItem {
  /** Absolute path of the pinned asset's model.glb. */
  model: string;
  position: number[];
  rotation: number[];
  scale?: number;
}

/** Renders a composition in the reference scene to a PNG (three-quarter front view). */
export async function renderCompositionImage(
  items: CompositionItem[],
  outFile: string,
  size = { width: 1600, height: 1000 },
): Promise<string> {
  return (await loadCompositionInThree(items, outFile, size)).file;
}

export interface PlacedBounds {
  min: number[];
  max: number[];
}

/**
 * Loads a composition with Three.js's GLTFLoader, as a web page would, renders it to a PNG and
 * returns each placed item's world-space bounds in metres. Used by the v0 gate check.
 */
export async function loadCompositionInThree(
  items: CompositionItem[],
  outFile: string,
  size = { width: 1600, height: 1000 },
): Promise<{ file: string; items: PlacedBounds[] }> {
  const models = [...new Set(items.map((i) => path.resolve(i.model)))];
  const { browser, page, errors } = await openScenePage(
    models.map((m, i): [string, string] => [`/files/c${i}.glb`, m]),
  );
  try {
    const data = (await page.evaluate(
      (job) =>
        (window as unknown as { renderComposition(j: unknown): Promise<string> }).renderComposition(
          job,
        ),
      {
        ...size,
        items: items.map((i) => ({
          url: `/files/c${models.indexOf(path.resolve(i.model))}.glb`,
          position: i.position,
          rotation: i.rotation,
          scale: i.scale ?? 1,
        })),
      },
    )) as string;
    if (errors.length) throw new Error(`The preview page failed: ${errors.join("; ")}`);
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
    const bounds = (await page.evaluate(
      () => (window as unknown as { compositionBounds: PlacedBounds[] }).compositionBounds,
    )) as PlacedBounds[];
    return { file: outFile, items: bounds };
  } finally {
    await browser.close();
  }
}

/**
 * Loads each .glb with Three.js's GLTFLoader, as a game or web page would, and returns its size
 * in metres from world-space vertex positions. Used by the import smoke tests.
 */
export async function measureInThree(models: string[]): Promise<[number, number, number][]> {
  const { browser, page, errors } = await openScenePage(
    models.map((m, i): [string, string] => [`/files/m${i}.glb`, path.resolve(m)]),
  );
  try {
    const sizes = (await page.evaluate(
      (urls) =>
        (
          window as unknown as { measureBounds(u: string[]): Promise<[number, number, number][]> }
        ).measureBounds(urls),
      models.map((_, i) => `/files/m${i}.glb`),
    )) as [number, number, number][];
    if (errors.length) throw new Error(`The page failed: ${errors.join("; ")}`);
    return sizes;
  } finally {
    await browser.close();
  }
}

/** `propcommons preview <folder> [--out dir] [--json]` */
export interface CompositionPreview {
  file: string;
  /** Advice about the spec's frame (resting on y = 0, footprint centred, which the validator also
   *  checks as CMP-GROUND and CMP-CENTER) and items that may float or sink (advice only). */
  notes: string[];
}

/**
 * Renders a composition from the assets in the repository, and checks the parts of the spec's
 * Compositions "Frame" that need geometry: the scene rests on y = 0 and its footprint is centred.
 * It also flags items that look like they float (nothing under them) or go below the ground.
 */
export async function previewComposition(
  folder: string,
  opts: { root?: string; outDir?: string } = {},
): Promise<CompositionPreview> {
  const dir = path.resolve(folder);
  const vp = parseVersionPath(dir);
  const root = path.resolve(opts.root ?? vp?.root ?? findRepoRoot(dir));
  let comp: { items?: { asset: string; position: number[]; rotation: number[]; scale?: number }[] };
  try {
    comp = JSON.parse(readFileSync(path.join(dir, "composition.json"), "utf8"));
  } catch {
    throw new UsageError(`${folder} has no readable composition.json.`);
  }
  const items = comp.items ?? [];
  const modelOf = (ref: string) => {
    const [id, v] = ref.split("@");
    return path.join(root, "assets", id as string, `v${v}`, "model.glb");
  };
  const missing = items.filter((i) => !existsSync(modelOf(i.asset))).map((i) => i.asset);
  if (missing.length)
    throw new UsageError(
      `These assets aren't in this repository: ${[...new Set(missing)].join(", ")}.`,
    );
  const outDir = path.resolve(
    opts.outDir ??
      path.join(
        root,
        "previews",
        "compositions",
        vp ? `${vp.author}/${vp.slug}/v${vp.version}` : path.basename(dir),
      ),
  );
  const { file, items: bounds } = await loadCompositionInThree(
    items.map((i) => ({
      model: modelOf(i.asset),
      position: i.position,
      rotation: i.rotation,
      scale: i.scale,
    })),
    path.join(outDir, "scene.png"),
  );
  const notes: string[] = [];
  const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`;
  const tol = 0.001;
  const lowest = Math.min(...bounds.map((b) => b.min[1] as number));
  if (Math.abs(lowest) > tol)
    notes.push(
      `The scene's lowest point is ${mm(lowest)} from y = 0; move everything so it rests on y = 0.`,
    );
  const lo = [0, 2].map((a) => Math.min(...bounds.map((b) => b.min[a] as number)));
  const hi = [0, 2].map((a) => Math.max(...bounds.map((b) => b.max[a] as number)));
  const centre = [
    ((lo[0] as number) + (hi[0] as number)) / 2,
    ((lo[1] as number) + (hi[1] as number)) / 2,
  ];
  if (Math.hypot(centre[0] as number, centre[1] as number) > tol)
    notes.push(
      `The scene's footprint is centred at x = ${mm(centre[0] as number)}, z = ${mm(centre[1] as number)}; move everything so it is centred on the origin.`,
    );
  bounds.forEach((b, i) => {
    const label = `Item ${i + 1} (${items[i]?.asset})`;
    const bottom = b.min[1] as number;
    if (bottom < -tol) notes.push(`${label} goes ${mm(-bottom)} below the ground.`);
    if (bottom <= tol) return;
    // Something must be under it: another item whose box overlaps it from above.
    const supported = bounds.some(
      (o, j) =>
        j !== i &&
        (o.max[1] as number) >= bottom - tol &&
        (o.min[1] as number) < bottom &&
        (o.min[0] as number) < (b.max[0] as number) &&
        (o.max[0] as number) > (b.min[0] as number) &&
        (o.min[2] as number) < (b.max[2] as number) &&
        (o.max[2] as number) > (b.min[2] as number),
    );
    if (!supported)
      notes.push(
        `${label} may be floating: nothing is under it, and its lowest point is ${mm(bottom)} above the ground.`,
      );
  });
  return { file, notes };
}

export async function renderPreviewsCli(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: "string" }, json: { type: "boolean" } },
  });
  const folder = positionals[0];
  if (!folder)
    throw new UsageError(
      "preview needs an asset or composition folder, e.g. propcommons preview assets/alice/mug/v1",
    );
  if (existsSync(path.join(folder, "composition.json"))) {
    console.error("Rendering the composition (usually 10–60 seconds)…");
    const c = await previewComposition(folder, { outDir: values.out });
    if (values.json) console.log(JSON.stringify(c, null, 2));
    else {
      console.log(`scene  ${path.relative(process.cwd(), c.file)}`);
      if (c.notes.length) for (const n of c.notes) console.log(`  note  ${n}`);
      else
        console.log(
          "  Rests on y = 0, footprint centred, nothing obviously floating or below the ground.",
        );
      console.log("  These checks look at bounding boxes only; look at the picture too.");
    }
    return 0;
  }
  console.error("Rendering previews (usually 10–60 seconds)…");
  const r = await renderPreviews(folder, { outDir: values.out });
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const [view, file] of Object.entries(r.files))
      console.log(`${view.padEnd(6)} ${path.relative(process.cwd(), file)}`);
    if (r.neighbours.length) console.log(`kit view beside: ${r.neighbours.join(", ")}`);
  }
  return 0;
}
