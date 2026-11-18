// `propcommons settle`: items drop straight down, bottom of the pile first, onto the ground or
// what is under them, and the scene's footprint is centred. Uses the fixture box (10 cm cube).
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateFolder } from "@propcommons/validator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFixtures } from "../../../fixtures/build.ts";
import { settleComposition } from "../src/settle.ts";

let root = "";
let folder = "";

const write = (items: unknown[]) =>
  writeFileSync(
    path.join(folder, "composition.json"),
    JSON.stringify({
      spec: "0.1",
      id: "fixture/scene",
      version: 1,
      name: "Test scene",
      license: "CC0-1.0",
      credits: [{ github: "fixture", roles: ["directed"] }],
      ai_assisted: false,
      tools: ["glTF-Transform"],
      items,
    }),
  );
const box = (position: number[], rotation = [0, 0, 0, 1]) => ({
  asset: "fixture/box@1",
  position,
  rotation,
});
const turn45 = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];

beforeAll(async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "propcommons-settle-"));
  await buildFixtures(path.join(tmp, "fixtures"));
  root = path.join(tmp, "repo");
  cpSync(path.join(tmp, "fixtures/CMP-pass"), root, { recursive: true });
  folder = path.join(root, "compositions/fixture/scene/v1");
}, 120_000);

describe("settle", () => {
  it("drops a box onto another and a third onto the ground, then centres the scene", async () => {
    write([box([0.5, 0.2, 0]), box([0.02, 0.5, 0], turn45), box([0, 0.3, 0])]);
    const r = await settleComposition(folder, { root });
    expect(r.items.map((s) => [s.to, s.restsOn])).toEqual([
      [0, "ground"],
      [0.1, 3], // on the box below it, though listed before it
      [0, "ground"],
    ]);
    // Footprint x from -0.05071 (a corner of the turned box) to 0.55.
    expect(r.shift).toEqual([-0.24964, 0]);
    const written = JSON.parse(readFileSync(path.join(folder, "composition.json"), "utf8"));
    expect(written.items.map((i: { position: number[] }) => i.position)).toEqual([
      [0.25036, 0, 0],
      [-0.22964, 0.1, 0],
      [-0.24964, 0, 0],
    ]);
    const v = await validateFolder(folder, { root });
    expect(v.results.filter((x) => x.level !== "info")).toEqual([]);
  });

  it("leaves the file alone with dryRun, and can skip centring", async () => {
    write([box([0.3, 0.2, 0]), box([0.3, 0.5, 0])]);
    const before = readFileSync(path.join(folder, "composition.json"), "utf8");
    const r = await settleComposition(folder, { root, dryRun: true, center: false });
    expect(r.shift).toEqual([0, 0]);
    expect(r.items.map((s) => s.to)).toEqual([0, 0.1]);
    expect(readFileSync(path.join(folder, "composition.json"), "utf8")).toBe(before);
  });

  it("refuses an item that pins a missing asset", async () => {
    write([box([0, 0, 0]), { ...box([0, 0, 0]), asset: "fixture/box@9" }]);
    await expect(settleComposition(folder, { root })).rejects.toThrow(
      /fixture\/box@9 has no model/,
    );
  });
});
