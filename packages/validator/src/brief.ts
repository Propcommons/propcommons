// What the library knows about an asset, in words: its numbers against its budget, its kit, where
// it is used and where it falls short. The site's "Improve it" prompt and the MCP server's
// improve_asset both hand this to the person's AI, so the two say the same thing.
import type { Index, IndexAsset } from "./repo.ts";
import { BUDGETS } from "./spec.ts";

export const fmtBytes = (n: number | null | undefined) =>
  n == null ? "unknown" : n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} KB`;

/** Real-world size as "24 × 8 × 24 cm" (width × height × depth). */
export function dimensions(bounds: number[] | null | undefined): string {
  if (!bounds?.length) return "";
  const big = Math.max(...bounds) >= 1;
  return `${bounds.map((v) => (big ? v.toFixed(2) : (v * 100).toFixed(v < 0.1 ? 1 : 0))).join(" × ")} ${big ? "m" : "cm"}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Tags that name a kit, shown as quick filters in the gallery, in this order. */
export const KITS = [
  "kitchen",
  "workshop",
  "living-room",
  "bedroom",
  "garden",
  "office",
  "bathroom",
  "food",
  "furniture",
];

/** Size-class limits in words, from spec/budgets.json. */
export function budgetLine(cls: string): string {
  const b = BUDGETS.sizeClasses[cls as keyof typeof BUDGETS.sizeClasses];
  if (!b) return "";
  const side = (m: number) => (m < 1 ? `${Math.round(m * 100)} cm` : `${m} m`);
  return `${cls}: longest side ${side(b.minLongestSide_m)}–${side(b.maxLongestSide_m)}; up to ${b.maxTriangles.toLocaleString("en-US")} triangles, ${b.maxMaterials} materials, textures up to ${b.maxTextureSide_px} px a side, ${fmtBytes(b.maxFileBytes)} file`;
}

/** The kits an asset belongs to, with a few of the other props in each, for matching their look. */
export function kitLines(
  index: Index,
  tags: string[],
  except?: string,
  sizeClass?: string,
): string[] {
  const live = index.assets.filter((b) => b.latest && !b.taken_down && b.id !== except);
  return KITS.filter((k) => tags.includes(k)).map((k) => {
    // Props of the same size class first: they're the ones it will be compared with.
    const others = live
      .filter((b) => (b.manifest?.tags ?? []).includes(k))
      .sort(
        (x, y) =>
          Number(y.manifest?.size_class === sizeClass) -
          Number(x.manifest?.size_class === sizeClass),
      );
    const names = others.slice(0, 10).map((b) => b.id.split("/")[1]);
    return `${k} (${others.length} props${names.length ? `: ${names.join(", ")}${others.length > names.length ? ", …" : ""}` : ""})`;
  });
}

/**
 * What the Improve prompt tells the person's AI about this asset: its numbers against its
 * budget, its kit, where it's used, and where it falls short. Everything comes from the index
 * and spec/budgets.json, so the prompt fits this prop rather than saying "make it better".
 */
export function improveBrief(index: Index, a: IndexAsset): string {
  const m = a.manifest ?? {};
  const meas = (a.measured ?? {}) as {
    bounds_m?: number[];
    triangles?: number;
    materials?: number;
    textures?: { width: number; height: number }[];
    file_bytes?: number;
  };
  const b = BUDGETS.sizeClasses[m.size_class as keyof typeof BUDGETS.sizeClasses];
  const textures = meas.textures ?? [];
  const share =
    b && meas.triangles != null ? Math.round((meas.triangles / b.maxTriangles) * 100) : null;
  const scenes = index.compositions.filter(
    (c) => c.latest && !c.taken_down && c.items.some((i) => i?.asset?.startsWith(`${a.id}@`)),
  );
  const kits = kitLines(index, m.tags ?? [], a.id, m.size_class);
  const notes = a.results.filter((r) => r.level !== "info");
  const facts = [
    `Size class ${budgetLine(m.size_class)}. It measures ${dimensions(meas.bounds_m)} (width × height × depth); keep about that, and keep clear of the class's edges.`,
    `It uses ${meas.triangles?.toLocaleString("en-US")} triangles${share != null ? ` (${share}% of its budget)` : ""}, ${meas.materials} material${meas.materials === 1 ? "" : "s"}, ${textures.length ? `${plural(textures.length, "texture")} (${[...new Set(textures.map((t) => `${t.width}×${t.height}`))].join(", ")})` : "no textures"}, ${fmtBytes(meas.file_bytes)}.`,
    `Tags: ${(m.tags ?? []).join(", ") || "none"}.`,
    ...kits.map(
      (k) =>
        `It belongs to the ${k.replace(" (", " kit (")}. Look at a few of their previews so it matches their scale and finish.`,
    ),
    scenes.length
      ? `It's in ${scenes.length} scene${scenes.length === 1 ? "" : "s"} (${scenes.map((c) => c.manifest?.name).join(", ")}). Keep its footprint and resting height close, so a scene can switch to the new version.`
      : "",
    a.files?.collision
      ? "It has a collision.glb, which improve copies: rebuild it for the new shape or delete it."
      : "",
    notes.length
      ? `The validator has notes on it: ${notes.map((r) => `${r.rule}: ${r.message}`).join(" ")}`
      : "",
  ].filter(Boolean);
  const gaps = [
    textures.length
      ? ""
      : "It has no textures. Flat colours are the main thing that makes a prop look generated: give it texture maps (base colour, roughness, normal) that show what it's made of.",
    share != null && share < 30
      ? `It uses only ${share}% of its triangle budget. Spend more on the silhouette, rounded edges and the parts a real one has.`
      : "",
  ].filter(Boolean);
  const limits = [
    share != null && share > 85
      ? `It's at ${share}% of its triangle budget, so a better one needs smarter triangles, not more: put them where the outline shows them and move small detail into normal maps.`
      : "",
    b && (meas.materials ?? 0) >= b.maxMaterials
      ? "It already has as many materials as its class allows: share materials between parts with a texture atlas rather than adding more."
      : "",
  ].filter(Boolean);
  return [
    "What the library knows about it:",
    ...facts.map((f) => `- ${f}`),
    ...(gaps.length ? ["", "Where it falls short:", ...gaps.map((g) => `- ${g}`)] : []),
    ...(limits.length ? ["", "Limits to work within:", ...limits.map((g) => `- ${g}`)] : []),
  ].join("\n");
}
