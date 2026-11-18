// Milestone 9: the Blender export script. A messy scene exported with it passes validate with no
// edits. Runs when Blender is installed (or BLENDER is set) and is skipped otherwise; CI does not
// install Blender. The syntax check always runs.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initAsset, validateFolder } from "@propcommons/validator";
import { describe, expect, it } from "vitest";
import { findBlender } from "../tools/smoke/find.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const blender = findBlender();

const SCRIPT = path.resolve(import.meta.dirname, "../tools/blender/export_asset.py");

describe("Blender export script", () => {
  it("compiles as Python", () => {
    const r = spawnSync(
      "python3",
      ["-I", "-c", `import ast, sys; ast.parse(open(sys.argv[1]).read())`, SCRIPT],
      {
        encoding: "utf8",
      },
    );
    if (r.error) return; // no python3 on this machine: nothing to check
    expect(r.status, r.stderr).toBe(0);
  });

  it("states which Blender versions it was tested with", () => {
    expect(readFileSync(SCRIPT, "utf8")).toMatch(/^Tested with: .+/m);
  });

  it.skipIf(!blender)("exports a messy scene that passes validate with no edits", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "propcommons-blender-"));
    const scene = path.join(work, "scene.blend");
    const made = spawnSync(
      blender as string,
      [
        "--background",
        "--factory-startup",
        "--python",
        path.join(REPO, "tools/blender/make_test_scene.py"),
        "--",
        "--out",
        scene,
      ],
      { encoding: "utf8" },
    );
    expect(made.status, made.stderr).toBe(0);
    const repo = path.join(work, "repo");
    for (const f of ["template", "project.config.json"])
      cpSync(path.join(REPO, f), path.join(repo, f), { recursive: true });
    const folder = initAsset({ root: repo, id: "tester/mug", tags: ["kitchen"] });
    const before = readFileSync(scene);
    const exported = spawnSync(
      blender as string,
      ["--background", scene, "--python", SCRIPT, "--", "--collection", "Asset", "--out", folder],
      { encoding: "utf8" },
    );
    expect(exported.status, exported.stderr).toBe(0);
    const r = await validateFolder(folder, { root: repo });
    expect(
      r.results.filter((x) => x.level !== "info"),
      JSON.stringify(r.results),
    ).toEqual([]);
    expect(r.pass).toBe(true);
    // The mug is about 8 cm wide (with its handle), 9 cm tall, upright, and has a collision file.
    const [x, y] = (r.measured as { bounds_m: number[] }).bounds_m;
    expect(y).toBeCloseTo(0.09, 2);
    expect(x).toBeGreaterThan(0.08);
    expect(readFileSync(path.join(folder, "collision.glb")).length).toBeGreaterThan(0);
    // The contributor's scene is left untouched.
    expect(readFileSync(scene).equals(before)).toBe(true);
  });
});
