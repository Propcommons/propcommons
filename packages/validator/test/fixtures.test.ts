// Milestone 3: every rule has a passing and a failing fixture, and each failing fixture fails with
// exactly its own rule ID.
//
// "Fails with exactly its own rule ID" is read as: for an error rule, the set of error-level rule
// IDs in the result is exactly {rule}; for a warning rule, there are no errors and the set of
// warnings is exactly {rule}. For TEX-DENSITY (info, which never fails), the "failing" fixture is
// one where density cannot be measured, so it reports null. See spec/DECISIONS.md.

import { beforeAll, describe, expect, it } from "vitest";
import { buildFixtures, type FixtureCase } from "../../../fixtures/build.ts";
import { RULES, rulesFile, type ValidationResult, validateFolder } from "../src/index.ts";

let cases: FixtureCase[] = [];
const results = new Map<string, ValidationResult>();

beforeAll(async () => {
  cases = await buildFixtures();
  for (const c of cases) results.set(c.name, await validateFolder(c.folder));
}, 120_000);

const ids = (r: ValidationResult, level: string) =>
  [...new Set(r.results.filter((x) => x.level === level).map((x) => x.rule))].sort();

/** The passing fixture that covers each rule that has no dedicated passing case. */
function passingCaseFor(ruleId: string): string {
  if (ruleId.startsWith("COL-")) return "COL-pass";
  if (ruleId.startsWith("CMP-")) return "CMP-pass";
  return "base";
}

describe("fixtures", () => {
  it("the base box passes with no errors or warnings", () => {
    const r = results.get("base");
    expect(r?.pass).toBe(true);
    expect(ids(r as ValidationResult, "error")).toEqual([]);
    expect(ids(r as ValidationResult, "warning")).toEqual([]);
    expect(r?.measured).toMatchObject({
      bounds_m: [0.1, 0.1, 0.1],
      triangles: 12,
      materials: 1,
      texel_density_px_per_m: 640,
      textures: [{ slot: "baseColor", width: 64, height: 64, format: "png" }],
    });
  });

  it("every passing case has no errors or warnings", () => {
    for (const c of cases.filter((c) => c.expect === "pass")) {
      const r = results.get(c.name) as ValidationResult;
      expect({ name: c.name, errors: ids(r, "error"), warnings: ids(r, "warning") }).toEqual({
        name: c.name,
        errors: [],
        warnings: [],
      });
    }
  });

  it("every failing case fails with exactly its own rule ID", () => {
    for (const c of cases.filter((c) => c.expect === "fail")) {
      const r = results.get(c.name) as ValidationResult;
      const level = RULES.get(c.rule)?.level;
      const got = { name: c.name, errors: ids(r, "error"), warnings: ids(r, "warning") };
      if (level === "error") {
        expect({ ...got, warnings: undefined, pass: r.pass }).toEqual({
          name: c.name,
          errors: [c.rule],
          warnings: undefined,
          pass: false,
        });
      } else if (level === "warning") {
        expect({ ...got, pass: r.pass }).toEqual({
          name: c.name,
          errors: [],
          warnings: [c.rule],
          pass: true,
        });
      } else {
        expect(got).toEqual({ name: c.name, errors: [], warnings: [] });
        expect(r.results.find((x) => x.rule === c.rule)?.measured, c.name).toBeNull();
      }
    }
  });

  it("every folder rule has a passing and a failing fixture", () => {
    for (const rule of rulesFile.rules.filter((r) => r.runner === "validate")) {
      const failing = cases.filter((c) => c.rule === rule.id && c.expect === "fail");
      expect(failing.length, `${rule.id} has no failing fixture`).toBeGreaterThan(0);
      const dedicated = cases.find((c) => c.rule === rule.id && c.expect === "pass");
      const pass = results.get(dedicated?.name ?? passingCaseFor(rule.id));
      expect(pass?.pass, `${rule.id} passing fixture`).toBe(true);
      expect(
        pass?.results.some((x) => x.rule === rule.id && x.level !== "info"),
        `${rule.id} passing fixture reports the rule`,
      ).toBe(false);
    }
  });

  it("a takedown folder passes and is skipped", () => {
    const r = results.get("tombstone");
    expect(r).toMatchObject({ pass: true, results: [], measured: {} });
  });

  it("an oversized file is rejected unread", () => {
    const r = results.get("FILE-SIZE-unread") as ValidationResult;
    expect(r.results.map((x) => x.rule)).toEqual(["FILE-SIZE"]);
    expect(r.measured).toMatchObject({ file_bytes: null, sha256: null });
  });

  it("results follow the spec's output format", () => {
    const r = results.get("GEO-TRIS") as ValidationResult;
    expect(Object.keys(r)).toEqual(["spec", "target", "pass", "results", "measured"]);
    expect(r.target).toBe("assets/fixture/box/v1");
    const tris = r.results.find((x) => x.rule === "GEO-TRIS");
    expect(tris).toEqual({
      rule: "GEO-TRIS",
      level: "error",
      message: "The model has 10,800 triangles; the budget for size class small is 5,000.",
      measured: 10800,
      limit: 5000,
      unit: "triangles",
      hint: "Reduce the mesh by about 54%, or move fine surface detail into the normal map.",
    });
    expect(Object.keys(r.measured)).toEqual([
      "bounds_m",
      "triangles",
      "materials",
      "textures",
      "texel_density_px_per_m",
      "file_bytes",
      "sha256",
    ]);
  });

  it("ORIGIN-Y reports the spec's example message and hint", () => {
    const r = results.get("ORIGIN-Y") as ValidationResult;
    const y = r.results.find((x) => x.rule === "ORIGIN-Y");
    expect(y?.message).toBe("The lowest point of the model is 0.041 m above the origin.");
    expect(y?.hint).toBe(
      "Move the mesh down by 0.041 m so its lowest point sits at y = 0, then apply the transform and export again.",
    );
    expect(y?.measured).toBe(0.041);
  });

  it("no message or hint has an unfilled placeholder", () => {
    for (const r of results.values())
      for (const x of r.results)
        expect(`${x.message} ${x.hint}`, x.rule).not.toMatch(/\{[a-z_]+\}/i);
  });
});
