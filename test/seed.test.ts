// Milestone 10: the seed assets and composition pass validation, are reproducible from the seed
// script, appear in the gallery, and the composition loads in the viewer in a real browser.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSite, serveSite } from "@propcommons/site";
import { validateFolder } from "@propcommons/validator";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");
const SEEDS = ["apple-red", "cutting-board", "kitchen-knife", "lemon", "wooden-bowl"];
const BASE = "/propcommons/";
let out = "";
let url = "";
let close: () => void = () => {};

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "propcommons-seed-site-"));
  await buildSite({ root: REPO, outDir: out, base: BASE, previews: false });
  const server = await serveSite(out, BASE, 0);
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE}`;
  close = () => server.close();
}, 120_000);

afterAll(() => close());

describe("seed content", () => {
  // The maintainer's folder holds later assets too (the gate rehearsal's), so check the seeds are
  // all there rather than that they are all there is.
  it("has the five seed assets and the seed composition by the maintainer", () => {
    expect(readdirSync(path.join(REPO, "assets/mattashes"))).toEqual(expect.arrayContaining(SEEDS));
    expect(readdirSync(path.join(REPO, "compositions/mattashes"))).toContain("fruit-bowl");
  });

  it("every seed passes validation with no warnings", async () => {
    for (const dir of [
      ...SEEDS.map((s) => `assets/mattashes/${s}/v1`),
      "compositions/mattashes/fruit-bowl/v1",
    ]) {
      const r = await validateFolder(path.join(REPO, dir), { root: REPO });
      expect({
        dir,
        pass: r.pass,
        problems: r.results.filter((x) => x.level !== "info").map((x) => x.rule),
      }).toEqual({
        dir,
        pass: true,
        problems: [],
      });
    }
  });

  it("the composition uses all five assets", () => {
    const c = JSON.parse(
      readFileSync(
        path.join(REPO, "compositions/mattashes/fruit-bowl/v1/composition.json"),
        "utf8",
      ),
    );
    expect(
      [...new Set(c.items.map((i: { asset: string }) => i.asset.split("@")[0]))].sort(),
    ).toEqual(SEEDS.map((s) => `mattashes/${s}`));
  });

  it("the seed script reproduces the committed files exactly", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "propcommons-seed-"));
    execFileSync(process.execPath, [path.join(REPO, "tools/seed/build.ts")], {
      env: { ...process.env, SEED_OUT: scratch },
    });
    for (const s of SEEDS)
      for (const f of readdirSync(path.join(REPO, "assets/mattashes", s, "v1")))
        expect(
          readFileSync(path.join(scratch, "assets/mattashes", s, "v1", f)).equals(
            readFileSync(path.join(REPO, "assets/mattashes", s, "v1", f)),
          ),
          `${s}/${f}`,
        ).toBe(true);
    const comp = "compositions/mattashes/fruit-bowl/v1/composition.json";
    expect(readFileSync(path.join(scratch, comp), "utf8")).toBe(
      readFileSync(path.join(REPO, comp), "utf8"),
    );
  }, 60_000);
});

describe("seed content in the browser", () => {
  async function open(pagePath: string) {
    const browser = await chromium.launch({
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(url + pagePath);
    return { browser, page, errors };
  }

  it("the gallery shows all five seed assets", async () => {
    const { browser, page, errors } = await open("");
    const names = await page.locator("#gallery .cell a").allTextContents();
    expect(names).toEqual(
      expect.arrayContaining([
        "Apple, red",
        "Bowl, turned wood",
        "Cutting board, wooden",
        "Kitchen knife",
        "Lemon",
      ]),
    );
    expect(errors.filter((e) => !e.includes("404"))).toEqual([]); // previews are not rendered in this test
    await browser.close();
  }, 60_000);

  it("an asset page loads its model in model-viewer, under the content security policy", async () => {
    const { browser, page, errors } = await open("assets/mattashes/wooden-bowl/v1/");
    await page.waitForFunction(
      () =>
        (document.querySelector("model-viewer") as unknown as { loaded: boolean })?.loaded === true,
      null,
      { timeout: 30_000 },
    );
    expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
    await browser.close();
  }, 60_000);

  it("the composition loads in the viewer with every item resting where it should", async () => {
    const { browser, page, errors } = await open("compositions/mattashes/fruit-bowl/v1/");
    await page.waitForFunction(
      () => (window as unknown as { viewerReady?: boolean }).viewerReady === true,
      null,
      { timeout: 30_000 },
    );
    const items = (await page.evaluate(
      () =>
        (
          window as unknown as {
            compositionBounds: { asset: string; min: number[]; max: number[] }[];
          }
        ).compositionBounds,
    )) as {
      asset: string;
      min: number[];
      max: number[];
    }[];
    expect(items.map((i) => i.asset)).toEqual([
      "mattashes/cutting-board@1",
      "mattashes/wooden-bowl@1",
      "mattashes/apple-red@1",
      "mattashes/apple-red@1",
      "mattashes/lemon@1",
      "mattashes/kitchen-knife@1",
    ]);
    const [board, bowl, ...rest] = items;
    const boardTop = board?.max[1] as number;
    expect(board?.min[1]).toBeCloseTo(0, 3); // the scene rests on y = 0
    expect(bowl?.min[1]).toBeCloseTo(boardTop, 3); // the bowl sits on the board
    expect(rest.at(-1)?.min[1]).toBeCloseTo(boardTop, 3); // so does the knife
    for (const fruit of rest.slice(0, 3)) {
      // Fruit is inside the bowl's footprint and above its floor, below its rim.
      expect(fruit.min[1]).toBeGreaterThan((bowl?.min[1] as number) + 0.01);
      expect(fruit.min[0]).toBeGreaterThan(bowl?.min[0] as number);
      expect(fruit.max[0]).toBeLessThan(bowl?.max[0] as number);
      expect(fruit.min[2]).toBeGreaterThan(bowl?.min[2] as number);
      expect(fruit.max[2]).toBeLessThan(bowl?.max[2] as number);
    }
    expect(await page.locator("#status").textContent()).toContain("6 items from 5 assets");
    // Preview images aren't rendered in this test, so their requests 404; nothing else may fail.
    expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
    await browser.close();
  }, 60_000);
});
