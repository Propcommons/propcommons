// Milestone 7: the site builds from a repository and shows every asset and composition, with all
// manifest text escaped.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initAsset } from "@propcommons/validator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSite } from "../src/index.ts";

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

describe("site", () => {
  it("writes index.json with every version", () => {
    const index = JSON.parse(read("index.json"));
    expect(index.assets.map((a: { ref: string }) => a.ref)).toEqual([
      "alice/mug@1",
      "alice/mug@2",
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
