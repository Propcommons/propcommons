// Milestone 6: four PNGs per asset, pixel-identical across two runs on the same machine.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFixtures } from "../../../fixtures/build.ts";
import { PREVIEW_VIEWS, type PreviewResult, renderPreviews } from "../src/index.ts";

/** Decodes a PNG's IHDR and its raw (inflated) pixel stream, so runs compare by pixels. */
function decodePng(file: string) {
  const buf = readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return { width, height, pixels: inflateSync(Buffer.concat(idat)) };
}

let a: PreviewResult;
let b: PreviewResult;

beforeAll(async () => {
  const cases = await buildFixtures(mkdtempSync(path.join(tmpdir(), "propcommons-preview-fx-")));
  const folder = cases.find((c) => c.name === "base")?.folder as string;
  const out = mkdtempSync(path.join(tmpdir(), "propcommons-preview-"));
  a = await renderPreviews(folder, { outDir: path.join(out, "a") });
  b = await renderPreviews(folder, { outDir: path.join(out, "b") });
}, 180_000);

describe("previews", () => {
  it("renders four 1024 × 1024 PNGs", () => {
    expect(Object.keys(a.files).sort()).toEqual([...PREVIEW_VIEWS].sort());
    for (const view of PREVIEW_VIEWS) {
      const png = decodePng(a.files[view]);
      expect([png.width, png.height], view).toEqual([1024, 1024]);
    }
  });

  it("is pixel-identical across two runs", () => {
    for (const view of PREVIEW_VIEWS) {
      const pa = decodePng(a.files[view]).pixels;
      const pb = decodePng(b.files[view]).pixels;
      expect(pa.equals(pb), view).toBe(true);
    }
  });

  it("measures the same bounds as the validator, within 1 mm", () => {
    for (const [i, v] of a.bounds_m.entries())
      expect(Math.abs(v - 0.1), `axis ${i}`).toBeLessThan(0.001);
  });

  it("is not a blank image", () => {
    const px = decodePng(a.files.front).pixels;
    const distinct = new Set<number>();
    for (let i = 0; i < px.length; i += 997) distinct.add(px[i] as number);
    expect(distinct.size).toBeGreaterThan(20);
  });
});
