// Milestone 11: import smoke tests. Three.js, Blender and Godot each load every seed asset and
// report the same bounds as the validator, within 1 mm.
//
// Three.js runs everywhere (headless Chromium). Blender and Godot run when they are installed
// (found on this machine, or via the BLENDER and GODOT environment variables) and are skipped
// otherwise; CI does not install them, so for CI they are manual steps (see CONTRIBUTING.md).
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { measureInThree } from "@propcommons/preview";
import { type AssetMeasured, validateFolder } from "@propcommons/validator";
import { beforeAll, describe, expect, it } from "vitest";
import { findBlender, findGodot } from "../tools/smoke/find.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const folders = readdirSync(path.join(REPO, "assets/mattashes")).map((s) =>
  path.join(REPO, "assets/mattashes", s, "v1"),
);
const models = folders.map((f) => path.join(f, "model.glb"));
const expected: [number, number, number][] = [];
const measuredAll: AssetMeasured[] = [];
const blender = findBlender();
/** Engines may write files next to what they import, so they only ever see copies. */
const scratch = mkdtempSync(path.join(tmpdir(), "propcommons-smoke-"));
const copies = models.map((m, i) => {
  const copy = path.join(scratch, `${i}.glb`);
  cpSync(m, copy);
  return copy;
});
const godot = findGodot();

beforeAll(async () => {
  for (const f of folders) {
    const measured = (await validateFolder(f, { root: REPO })).measured as AssetMeasured;
    measuredAll.push(measured);
    expected.push(measured.bounds_m as [number, number, number]);
  }
});

function expectSameBounds(engine: string, got: number[][]) {
  expect(got).toHaveLength(models.length);
  got.forEach((size, i) => {
    for (let a = 0; a < 3; a++) {
      const diff = Math.abs((size[a] as number) - (expected[i]?.[a] as number));
      expect(
        diff,
        `${engine}: ${path.basename(folders[i] as string, "/v1")} axis ${"xyz"[a]}: ${size[a]} vs ${expected[i]?.[a]}`,
      ).toBeLessThanOrEqual(0.001);
    }
  });
}

function parseBounds(stdout: string): number[][] {
  const line = stdout.split("\n").find((l) => l.startsWith("BOUNDS_JSON "));
  if (!line) throw new Error(`no BOUNDS_JSON line in output:\n${stdout.slice(-2000)}`);
  return JSON.parse(line.slice("BOUNDS_JSON ".length));
}

describe("import smoke tests", () => {
  it("Three.js loads every seed asset with the validator's bounds", async () => {
    expectSameBounds("Three.js", await measureInThree(models));
  });

  it.skipIf(!blender)("Blender loads every seed asset with the validator's bounds", () => {
    const r = spawnSync(
      blender as string,
      [
        "--background",
        "--factory-startup",
        "--python",
        path.join(REPO, "tools/smoke/blender_bounds.py"),
        "--",
        ...copies,
      ],
      { encoding: "utf8", cwd: scratch },
    );
    expect(r.status, r.stderr).toBe(0);
    expectSameBounds("Blender", parseBounds(r.stdout));
  });

  it.skipIf(!godot)("Godot loads every seed asset with the validator's bounds", () => {
    const r = spawnSync(
      godot as string,
      ["--headless", "--script", path.join(REPO, "tools/smoke/godot_bounds.gd"), "--", ...copies],
      { encoding: "utf8", cwd: scratch },
    );
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expectSameBounds("Godot", parseBounds(r.stdout));
  });

  for (const mode of ["check", "check-editor"] as const) {
    it.skipIf(!godot)(
      `Godot loads every seed asset at runtime with prop_commons.gd (${mode})`,
      async () => {
        const r = spawnSync(
          "bash",
          [path.join(REPO, "tools/smoke/godot_runtime.sh"), mode, ...copies],
          {
            encoding: "utf8",
            cwd: scratch,
            env: { ...process.env, GODOT: godot as string },
          },
        );
        expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
        const line = r.stdout.split("\n").find((l) => l.startsWith("RUNTIME_JSON "));
        const reports = JSON.parse((line ?? "").slice("RUNTIME_JSON ".length)) as {
          editor_hint: boolean;
          importer_meshes: number;
          mesh_instances: number;
          missing_materials: number;
          textures: [number, number][];
          size: number[];
        }[];
        expectSameBounds(
          `Godot runtime (${mode})`,
          reports.map((x) => x.size),
        );
        for (const [i, rep] of reports.entries()) {
          const measured = measuredAll[i] as AssetMeasured;
          expect(rep.editor_hint, "mode").toBe(mode === "check-editor");
          expect(rep.importer_meshes, "every mesh is renderable").toBe(0);
          expect(rep.mesh_instances).toBeGreaterThan(0);
          expect(rep.missing_materials).toBe(0);
          // Every texture Godot loaded has the size the validator measured.
          const sizes = measured.textures.map((t) => `${t.width}x${t.height}`);
          // Godot loaded textures exactly when the asset has some (a clear glass bowl has none).
          expect(rep.textures.length > 0).toBe(sizes.length > 0);
          for (const [w, h] of rep.textures) expect(sizes).toContain(`${w}x${h}`);
        }
      },
    );
  }
});
