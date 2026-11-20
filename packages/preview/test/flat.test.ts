// The flat pictures the site draws rulers and dimension lines over: their scale has to be exact.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLAT_VIEWS,
  type FlatViews,
  renderFlatViews,
  renderPlainViews,
  renderRow,
} from "../src/index.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const model = (slug: string) => path.join(REPO, "assets/mattashes", slug, "v1/model.glb");
describe("flat views", () => {
  it("renders front, side and top at one known scale", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "propcommons-flat-"));
    const [flat] = (await renderFlatViews([{ model: model("lemon"), outDir: out }], {
      longest: 320,
      pad: 8,
    })) as [FlatViews];
    for (const v of FLAT_VIEWS) expect(existsSync(path.join(out, `flat-${v}.webp`)), v).toBe(true);
    expect(JSON.parse(readFileSync(path.join(out, "flat.json"), "utf8"))).toEqual(flat);
    const [w, h, d] = flat.size;
    // The longest side is 320 pixels, and every picture is its two dimensions at that scale
    // plus the padding.
    expect(Math.max(w, h, d) * flat.pxPerMetre).toBeCloseTo(320, 3);
    const px = (m: number) => Math.round(m * flat.pxPerMetre + 16);
    expect([flat.front.width, flat.front.height]).toEqual([px(w), px(h)]);
    expect([flat.side.width, flat.side.height]).toEqual([px(d), px(h)]);
    expect([flat.top.width, flat.top.height]).toEqual([px(w), px(d)]);
  }, 120_000);

  it("renders a plain close-up of a glass prop, large and card-sized", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "propcommons-plain-"));
    await renderPlainViews([{ model: model("drinking-glass"), outDir: out }]);
    const size = (f: string) => readFileSync(path.join(out, f)).length;
    // Both are real pictures, and the card is the smaller file.
    expect(size("plain-card.webp")).toBeGreaterThan(1000);
    expect(size("plain.webp")).toBeGreaterThan(size("plain-card.webp"));
  }, 120_000);

  it("lays a row out left to right at one scale, with smaller props on top", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "propcommons-row-")), "row.webp");
    const row = await renderRow(
      [
        {
          id: "board",
          model: model("cutting-board"),
          on: [{ id: "lemon", model: model("lemon"), dx: 0 }],
        },
        { id: "apple", model: model("apple-red") },
      ],
      out,
      { width: 800, gap: 0.1 },
    );
    expect(existsSync(out)).toBe(true);
    expect(row.width).toBe(800);
    const [board, lemon, apple] = row.items as [
      (typeof row.items)[number],
      (typeof row.items)[number],
      (typeof row.items)[number],
    ];
    expect(row.items.map((i) => [i.id, i.on])).toEqual([
      ["board", null],
      ["lemon", "board"],
      ["apple", null],
    ]);
    // Widths in pixels are widths in metres times the scale, and the gap is the one asked for.
    expect(board.x1 - board.x0).toBeCloseTo(board.size[0] * row.pxPerMetre, 3);
    expect(apple.x0 - board.x1).toBeCloseTo(0.1 * row.pxPerMetre, 3);
    expect(row.gapPx).toBeCloseTo(0.1 * row.pxPerMetre, 6);
    // The lemon stands on the board: its top is higher up the picture than the board's.
    expect(lemon.top).toBeLessThan(board.top);
    expect(board.x0).toBeCloseTo(row.originX, 3);
  }, 120_000);
});
