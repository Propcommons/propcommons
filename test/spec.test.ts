// Milestone 2: the human-readable spec (SPEC.md) and the machine-readable files agree.
import { readFileSync } from "node:fs";
import {
  ASSET_SCHEMA,
  BUDGETS,
  RULES,
  rulesFile,
  schemaProblems,
  validateAssetManifest,
  validateCompositionManifest,
} from "@propcommons/validator";
import { describe, expect, it } from "vitest";

const specMd = readFileSync(new URL("../spec/SPEC.md", import.meta.url), "utf8");

/** Rows of every Markdown table whose header starts with the given cell text. */
function tableRows(header: string): string[][] {
  const rows: string[][] = [];
  const lines = specMd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^\\|\\s*${header}\\s*\\|`).test(lines[i] ?? "")) continue;
    for (let j = i + 2; j < lines.length && lines[j]?.startsWith("|"); j++) {
      rows.push(
        (lines[j] ?? "")
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim()),
      );
    }
  }
  return rows;
}

const jsonBlocks = [...specMd.matchAll(/```json\n([\s\S]*?)```/g)].map((m) =>
  JSON.parse(m[1] ?? ""),
);

describe("SPEC.md and rules.json", () => {
  const specRules = tableRows("Rule ID");
  const specIds = specRules.map((r) => r[0] ?? "");

  it("lists rule IDs that are unique", () => {
    expect(new Set(specIds).size).toBe(specIds.length);
    expect(new Set(rulesFile.rules.map((r) => r.id)).size).toBe(rulesFile.rules.length);
  });

  it("every rule ID in SPEC.md is in rules.json, and the reverse", () => {
    expect([...specIds].sort()).toEqual([...RULES.keys()].sort());
  });

  it("every rule has the same level in both", () => {
    for (const [id, , level] of specRules) {
      expect(RULES.get(id ?? "")?.level, id).toBe(level);
    }
  });

  it("every rule has a title, message and hint", () => {
    for (const r of rulesFile.rules) {
      expect(r.title.length, r.id).toBeGreaterThan(0);
      expect(r.message.length, r.id).toBeGreaterThan(0);
      expect(r.hint.length, r.id).toBeGreaterThan(0);
    }
  });
});

describe("SPEC.md and the schemas", () => {
  it("asset.schema.json is exactly the schema printed in SPEC.md", () => {
    const printed = jsonBlocks.find((b) => "$schema" in b);
    expect(ASSET_SCHEMA).toEqual(printed);
  });

  it("the manifest example in SPEC.md is valid", () => {
    const example = jsonBlocks.find((b) => b.size_class && !("$schema" in b));
    expect(schemaProblems(validateAssetManifest, example)).toEqual([]);
  });

  it("the composition example in SPEC.md is valid", () => {
    const example = jsonBlocks.find((b) => Array.isArray(b.items));
    expect(schemaProblems(validateCompositionManifest, example)).toEqual([]);
  });
});

describe("SPEC.md and budgets.json", () => {
  const rows = tableRows("Size class");
  const num = (s: string) => Number(s.replace(/[^0-9.]/g, ""));

  it("has the same three size classes", () => {
    expect(rows.map((r) => r[0]).sort()).toEqual(Object.keys(BUDGETS.sizeClasses).sort());
  });

  it("has the same limits for each class", () => {
    for (const [name, range, , tris, tex, mats, size] of rows) {
      const b = BUDGETS.sizeClasses[name as keyof typeof BUDGETS.sizeClasses];
      const [lo, hi] = (range ?? "").match(/[0-9.]+/g)?.map(Number) ?? [];
      expect(b.minLongestSide_m, name).toBe(lo);
      expect(b.maxLongestSide_m, name).toBe(hi);
      expect(b.maxTriangles, name).toBe(num(tris ?? ""));
      expect(b.maxTextureSide_px, name).toBe(num(tex ?? ""));
      expect(b.maxMaterials, name).toBe(num(mats ?? ""));
      expect(b.maxFileBytes, name).toBe(num(size ?? "") * 1_000_000);
    }
  });

  it("has the same extension allowlist", () => {
    const line = specMd.split("\n").find((l) => l.startsWith("**Extension allowlist"));
    const listed = [...(line ?? "").matchAll(/`(KHR_[a-z_]+)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...BUDGETS.extensionAllowlist].sort());
  });
});
