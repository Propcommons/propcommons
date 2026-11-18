// Milestone 9: the Blender export script. Blender is not available in CI or on the machine this was
// written on, so the script itself is untested (its header says so). This checks that it is valid
// Python and that its header states its tested status honestly.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
});
