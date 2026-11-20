// Milestone 7: the site builds from a repository and shows every asset and composition, with all
// manifest text escaped.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { improveAsset, initAsset } from "@propcommons/validator";
import { chromium } from "playwright";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSite } from "../src/index.ts";
import { serveSite } from "../src/serve.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
let repo = "";
let out = "";
const read = (rel: string) => readFileSync(path.join(out, rel), "utf8");

beforeAll(async () => {
  repo = mkdtempSync(path.join(tmpdir(), "propcommons-site-"));
  for (const f of ["template", "project.config.json", "MAINTAINERS", "wanted.json", "spec"])
    cpSync(path.join(REPO, f), path.join(repo, f), { recursive: true });
  initAsset({ root: repo, id: "alice/mug", name: "Mug", tags: ["kitchen"] });
  const evil = initAsset({
    root: repo,
    id: "mallory/box",
    name: 'Box <script>alert("x")</script>',
    tags: ["kitchen"],
  });
  const m = JSON.parse(readFileSync(path.join(evil, "asset.json"), "utf8"));
  m.source_url = "javascript:alert(1)";
  m.notes_url = "https://example.com/notes";
  writeFileSync(path.join(evil, "asset.json"), JSON.stringify(m));
  // A second version and a takedown of the first.
  const v2 = path.join(repo, "assets/alice/mug/v2");
  cpSync(path.join(repo, "assets/alice/mug/v1"), v2, { recursive: true });
  const m2 = JSON.parse(readFileSync(path.join(v2, "asset.json"), "utf8"));
  writeFileSync(path.join(v2, "asset.json"), JSON.stringify({ ...m2, version: 2 }));
  // Someone else's better version of the mug, which its page should link to.
  improveAsset({
    root: repo,
    from: "alice/mug",
    author: "bob",
    aiAssisted: true,
    tools: ["Claude"],
  });
  const comp = path.join(repo, "compositions/alice/pair/v1");
  mkdirSync(comp, { recursive: true });
  writeFileSync(
    path.join(comp, "composition.json"),
    JSON.stringify({
      spec: "0.1",
      id: "alice/pair",
      version: 1,
      name: "Pair & <b>more</b>",
      license: "CC0-1.0",
      credits: [{ github: "alice", roles: ["directed"] }],
      ai_assisted: false,
      tools: ["hand"],
      items: [
        { asset: "alice/mug@2", position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { asset: "mallory/box@1", position: [0.2, 0, 0], rotation: [0, 0, 0, 1] },
      ],
    }),
  );
  out = path.join(repo, "site-dist");
  await buildSite({ root: repo, outDir: out, base: "/propcommons/", previews: false });
}, 120_000);

/** The test hooks the Studio puts on window. */
interface StudioWindow {
  studioReady?: boolean;
  studioError?: string;
  studio: {
    place(ref: string, x: number, z: number): Promise<number[]>;
    open(ref: string): Promise<void>;
    build(reply: string): Promise<number>;
    items: unknown[];
  };
}

describe("site", () => {
  it("writes index.json with every version", () => {
    const index = JSON.parse(read("index.json"));
    expect(index.assets.map((a: { ref: string }) => a.ref)).toEqual([
      "alice/mug@1",
      "alice/mug@2",
      "bob/mug@1",
      "mallory/box@1",
    ]);
    expect(index.compositions.map((c: { ref: string }) => c.ref)).toEqual(["alice/pair@1"]);
  });

  it("has a page for every asset version and composition, and the files they load", () => {
    for (const p of ["assets/alice/mug/v1", "assets/alice/mug/v2", "assets/mallory/box/v1"]) {
      expect(existsSync(path.join(out, p, "index.html")), p).toBe(true);
      expect(existsSync(path.join(out, p, "model.glb")), p).toBe(true);
    }
    expect(existsSync(path.join(out, "compositions/alice/pair/v1/index.html"))).toBe(true);
    expect(existsSync(path.join(out, "compositions/alice/pair/v1/composition.json"))).toBe(true);
    for (const f of [
      "vendor/three/three.module.js",
      "vendor/three/three.core.js",
      "vendor/three/addons/loaders/GLTFLoader.js",
      "vendor/three/addons/controls/OrbitControls.js",
      "vendor/model-viewer/model-viewer.min.js",
      "scene/stage.js",
      "scene/studio.hdr",
      "static/composition.js",
      "llms.txt",
      "wanted/index.html",
      "spec/0.1/SPEC.md",
      "spec/0.1/INDEX.md",
    ])
      expect(existsSync(path.join(out, f)), f).toBe(true);
  });

  it("the gallery shows the latest version of every asset", () => {
    const g = read("index.html");
    expect(g).toContain('href="/propcommons/assets/alice/mug/v2/"');
    expect(g).not.toContain('href="/propcommons/assets/alice/mug/v1/"');
    expect(g).toContain('href="/propcommons/assets/mallory/box/v1/"');
  });

  it("asset pages offer Improve, starting from the newest version, and link better versions", () => {
    for (const v of ["v1", "v2"]) {
      const p = read(`assets/alice/mug/${v}/index.html`);
      expect(p).toContain('id="improve-open"');
      expect(p).toContain('data-ref="alice/mug@2"');
      expect(p).toContain("static/make.js");
    }
    const v2 = read("assets/alice/mug/v2/index.html");
    expect(v2).toContain("Better versions");
    expect(v2).toContain('href="/propcommons/assets/bob/mug/v1/"');
    expect(read("assets/bob/mug/v1/index.html")).toContain("Derived from");
    // The prompt's brief is about this asset, with its budget from spec/budgets.json.
    const brief = /data-brief="([^"]*)"/.exec(v2)?.[1] ?? "";
    expect(brief).toContain("Size class small: longest side 1 cm–30 cm; up to 5,000 triangles");
    expect(brief).toContain("of its budget");
    expect(brief).toMatch(/no textures|textures \d/);
    expect(v2).toContain('data-path="assets/alice/mug/v2"');
    const make = read("contribute/index.html");
    expect(make).toContain('class="maker" data-kind="new"');
    expect(make).toMatch(/data-brief="The library has \d+ props/);
    expect(existsSync(path.join(out, "static/make.js"))).toBe(true);
  });

  it("the compositions page lists the composition", () => {
    expect(read("compositions/index.html")).toContain(
      'href="/propcommons/compositions/alice/pair/v1/"',
    );
  });

  it("escapes manifest text and links only to https", () => {
    for (const p of [
      "index.html",
      "assets/mallory/box/v1/index.html",
      "compositions/alice/pair/v1/index.html",
      "assets/alice/mug/v2/index.html",
    ]) {
      const h = read(p);
      expect(h, p).not.toContain("<script>alert");
      expect(h, p).not.toContain("<b>more</b>");
      expect(h, p).not.toMatch(/href="(?!https:\/\/|\/propcommons\/|composition\.json|data:,"|#)/);
    }
    const box = read("assets/mallory/box/v1/index.html");
    expect(box).toContain("Box &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(box).toContain('href="https://example.com/notes"');
  });

  it("loads no third-party scripts and sets a content security policy", () => {
    for (const p of [
      "index.html",
      "assets/alice/mug/v2/index.html",
      "compositions/alice/pair/v1/index.html",
    ]) {
      const h = read(p);
      expect(h).toContain("Content-Security-Policy");
      for (const m of h.matchAll(/<script[^>]*src="([^"]+)"/g))
        expect(m[1]).toMatch(/^\/propcommons\//);
    }
  });

  it("builds the Studio, with every module it imports vendored", () => {
    const h = read("studio/index.html");
    expect(h).toContain("Content-Security-Policy");
    expect(h).toContain('<script type="importmap">');
    expect(h).toMatch(/src="\/propcommons\/static\/studio.js\?v=[0-9a-f]{10}"/);
    expect(h).toContain('id="viewport"');
    expect(read("index.html")).toContain('href="/propcommons/studio/"');
    expect(read("compositions/alice/pair/v1/index.html")).toContain(
      'href="/propcommons/studio/?scene=alice%2Fpair%401"',
    );
    const js = read("static/studio.js");
    for (const m of js.matchAll(/from\s+"([^"]+)"/g)) {
      const spec = m[1] as string;
      const rel = spec.startsWith("three/addons/")
        ? `vendor/three/addons/${spec.slice("three/addons/".length)}`
        : spec === "three"
          ? "vendor/three/three.module.js"
          : path.posix.join("static", spec);
      expect(existsSync(path.join(out, rel)), spec).toBe(true);
    }
  });

  it("in the Studio, a box placed over another lands on top of it", async () => {
    const server = await serveSite(out, "/propcommons/", 0);
    const { port } = server.address() as AddressInfo;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/propcommons/studio/`);
      await page.waitForFunction(
        () =>
          (window as unknown as StudioWindow).studioReady ||
          (window as unknown as StudioWindow).studioError,
        null,
        {
          timeout: 60_000,
        },
      );
      expect(
        await page.evaluate(() => (window as unknown as StudioWindow).studioError ?? null),
      ).toBeNull();
      // The 10 cm fixture box: one on the floor, one dropped over it lands on its top.
      const a = await page.evaluate(() =>
        (window as unknown as StudioWindow).studio.place("mallory/box@1", 0, 0),
      );
      const b = await page.evaluate(() =>
        (window as unknown as StudioWindow).studio.place("mallory/box@1", 0.03, 0),
      );
      const c = await page.evaluate(() =>
        (window as unknown as StudioWindow).studio.place("mallory/box@1", 0.5, 0),
      );
      expect(a[1]).toBeCloseTo(0, 4);
      expect(b[1]).toBeCloseTo(0.1, 3);
      expect(c[1]).toBeCloseTo(0, 4);
      // A plan from "Describe a scene", listed top first: built bottom first, each on the last.
      const plan = JSON.stringify({
        items: [
          { asset: "mallory/box@1", x: 1.02, z: 0, y: 0.1, turn: 0 },
          { asset: "mallory/box@1", x: 1, z: 0, y: 0, turn: 0 },
        ],
      });
      expect(
        await page.evaluate((p) => (window as unknown as StudioWindow).studio.build(p), plan),
      ).toBe(2);
      const ys = await page.evaluate(() =>
        ((window as unknown as StudioWindow).studio.items as { position: number[] }[]).map(
          (i) => i.position[1] as number,
        ),
      );
      expect(ys.map((y) => Math.round(y * 1000) + 0)).toEqual([0, 100]);
      // The library lists the latest versions, and a published scene opens.
      expect(await page.locator(".lib-item").count()).toBe(3);
      await page.evaluate(() => (window as unknown as StudioWindow).studio.open("alice/pair"));
      expect(
        await page.evaluate(() => (window as unknown as StudioWindow).studio.items.length),
      ).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.close();
    }
  }, 120_000);

  it("composition and asset credits are merged", () => {
    const index = JSON.parse(read("index.json"));
    expect(index.compositions[0].credits).toEqual([
      { github: "alice", roles: ["directed", "modeled"] },
      { github: "mallory", roles: ["modeled"] },
    ]);
  });

  it("writes llms.txt with the index address and path pattern", () => {
    const t = read("llms.txt");
    expect(t).toContain("index.json");
    expect(t).toContain("assets/<author>/<slug>/v<N>/model.glb");
  });
});
