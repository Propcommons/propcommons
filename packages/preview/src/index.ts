// Preview rendering: four 1024 × 1024 PNGs per asset (front three-quarter, side, top, and a "kit"
// view beside up to two existing assets of the same size class), rendered by headless Chromium
// from the reference scene in ../scene. Works without a GPU (SwiftShader), and is deterministic.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { findRepoRoot, isRealDir, parseVersionPath, UsageError } from "@propcommons/validator";
import { chromium } from "playwright";

const SCENE_DIR = path.join(import.meta.dirname, "..", "scene");
const require = createRequire(import.meta.url);
const THREE_DIR = path.dirname(path.dirname(require.resolve("three"))); // node_modules/three
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
  files: Record<(typeof PREVIEW_VIEWS)[number], string>;
  neighbours: string[];
  bounds_m: [number, number, number];
}

/** Renders the four previews of one asset version folder into outDir. */
export async function renderPreviews(
  folder: string,
  opts: { root?: string; outDir?: string } = {},
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

  // Only these files are served to the page; every other request is refused.
  const served = new Map<string, string>([
    ["/scene/render.html", path.join(SCENE_DIR, "render.html")],
    ["/scene/render.js", path.join(SCENE_DIR, "render.js")],
    ["/scene/stage.js", path.join(SCENE_DIR, "stage.js")],
    ["/scene/studio.hdr", path.join(SCENE_DIR, "studio.hdr")],
    ["/files/model.glb", model],
    ...neighbours.map((n, i): [string, string] => [`/files/neighbour-${i}.glb`, n.model]),
  ]);
  const contentType = (p: string) =>
    p.endsWith(".html")
      ? "text/html"
      : p.endsWith(".js")
        ? "text/javascript"
        : p.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/octet-stream";

  const browser = await chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-driver-bug-workarounds",
    ],
  });
  try {
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
      return route.fulfill({
        status: 200,
        contentType: contentType(file),
        body: readFileSync(file),
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/scene/render.html`);
    await page.waitForFunction(
      () => (window as unknown as { previewReady?: boolean }).previewReady === true,
      null,
      {
        timeout: 30_000,
      },
    );
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
    return { files, neighbours: neighbours.map((n) => n.ref), bounds_m: shots.bounds };
  } finally {
    await browser.close();
  }
}

/** `propcommons preview <folder> [--out dir] [--json]` */
export async function renderPreviewsCli(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: "string" }, json: { type: "boolean" } },
  });
  const folder = positionals[0];
  if (!folder)
    throw new UsageError("preview needs a folder, e.g. propcommons preview assets/alice/mug/v1");
  const r = await renderPreviews(folder, { outDir: values.out });
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const [view, file] of Object.entries(r.files))
      console.log(`${view.padEnd(6)} ${path.relative(process.cwd(), file)}`);
    if (r.neighbours.length) console.log(`kit view beside: ${r.neighbours.join(", ")}`);
  }
  return 0;
}
