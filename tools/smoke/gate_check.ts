// The v0 gate check: loads one composition in Three.js, Godot and Blender, the way each engine's
// users would, and checks that every item lands in the same place in all three (within 1 mm),
// that the scene rests on y = 0, and that every pinned asset and the composition pass validation.
// Saves a picture from each engine and a Markdown report.
//
//   node tools/smoke/gate_check.ts --library <repository root> --composition <folder> --out <dir>
//
// Godot opens a window briefly (it renders). Blender and Godot are found as in find.ts.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCompositionInThree, type PlacedBounds } from "../../packages/preview/src/index.ts";
import { validateFolder } from "../../packages/validator/src/index.ts";
import { findBlender, findGodot } from "./find.ts";

const TOLERANCE_M = 0.001;
const HERE = import.meta.dirname;

const { values } = parseArgs({
  options: {
    library: { type: "string" },
    composition: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.library || !values.composition || !values.out) {
  console.error(
    "Usage: node tools/smoke/gate_check.ts --library <root> --composition <folder> --out <dir>",
  );
  process.exit(2);
}
const library = path.resolve(values.library);
const compDir = path.resolve(values.composition);
const out = path.resolve(values.out);
mkdirSync(out, { recursive: true });
const composition = JSON.parse(readFileSync(path.join(compDir, "composition.json"), "utf8"));
const items: { asset: string; position: number[]; rotation: number[]; scale?: number }[] =
  composition.items;
const modelPath = (ref: string) => {
  const [id, v] = ref.split("@");
  return path.join(library, "assets", id as string, `v${v}`, "model.glb");
};

const report: string[] = [`# v0 gate check: ${composition.id}@${composition.version}`, ""];
let ok = true;
const fail = (msg: string) => {
  ok = false;
  report.push(`- **Fail:** ${msg}`);
};

// 1. Validation of the composition and every asset it pins.
report.push("## Validation", "");
const comp = await validateFolder(compDir, { root: library });
report.push(`- ${comp.target}: ${comp.pass ? "pass" : "FAIL"}`);
if (!comp.pass)
  fail(
    `the composition fails ${comp.results
      .filter((r) => r.level === "error")
      .map((r) => r.rule)
      .join(", ")}`,
  );
const refs = [...new Set(items.map((i) => i.asset))];
for (const ref of refs) {
  const r = await validateFolder(path.dirname(modelPath(ref)), { root: library });
  report.push(`- ${ref}: ${r.pass ? "pass" : "FAIL"}`);
  if (!r.pass) fail(`${ref} fails validation`);
}
report.push("");

// 2. Three engines.
const engines: Record<string, PlacedBounds[] | null> = {
  "Three.js": null,
  Godot: null,
  Blender: null,
};
const notes: string[] = [];

const three = await loadCompositionInThree(
  items.map((i) => ({
    model: modelPath(i.asset),
    position: i.position,
    rotation: i.rotation,
    scale: i.scale,
  })),
  path.join(out, "threejs.png"),
);
engines["Three.js"] = three.items;

const godot = findGodot();
if (godot) {
  const r = spawnSync(
    "bash",
    [path.join(HERE, "godot_runtime.sh"), "render", compDir, path.join(out, "godot.png"), library],
    {
      encoding: "utf8",
      env: { ...process.env, GODOT: godot },
    },
  );
  const line = r.stdout.split("\n").find((l) => l.startsWith("RENDER_JSON "));
  if (line) engines.Godot = JSON.parse(line.slice("RENDER_JSON ".length)).items;
  else notes.push(`Godot did not report: ${r.stderr.slice(-500)}`);
} else notes.push("Godot is not installed; skipped.");

const blender = findBlender();
if (blender) {
  const r = spawnSync(
    blender,
    [
      "--background",
      "--factory-startup",
      "--python",
      path.join(HERE, "blender_composition.py"),
      "--",
      library,
      path.join(compDir, "composition.json"),
      path.join(out, "blender.png"),
    ],
    { encoding: "utf8" },
  );
  const line = r.stdout.split("\n").find((l) => l.startsWith("COMPOSITION_JSON "));
  if (line) engines.Blender = JSON.parse(line.slice("COMPOSITION_JSON ".length));
  else notes.push(`Blender did not report: ${r.stderr.slice(-500)}`);
} else notes.push("Blender is not installed; skipped.");

// 3. Compare every item across engines, and check the scene rests on the ground.
report.push(
  "## Where each item lands",
  "",
  "Bounds in metres (min y → max y). Differences are the largest gap from Three.js on any edge.",
  "",
);
report.push("| # | Asset | Three.js y | Godot | Blender |", "| --- | --- | --- | --- | --- |");
const fmt = (n: number) => n.toFixed(4);
items.forEach((item, i) => {
  const t = engines["Three.js"]?.[i];
  const cells = [
    `${i + 1}`,
    item.asset,
    t ? `${fmt(t.min[1] as number)} → ${fmt(t.max[1] as number)}` : "n/a",
  ];
  for (const name of ["Godot", "Blender"]) {
    const e = engines[name]?.[i];
    if (!t || !e) {
      cells.push(engines[name] ? "missing" : "skipped");
      continue;
    }
    const diff = Math.max(
      ...[0, 1, 2].flatMap((a) => [
        Math.abs((e.min[a] as number) - (t.min[a] as number)),
        Math.abs((e.max[a] as number) - (t.max[a] as number)),
      ]),
    );
    cells.push(
      diff <= TOLERANCE_M
        ? `same (${(diff * 1000).toFixed(2)} mm)`
        : `**off by ${(diff * 1000).toFixed(1)} mm**`,
    );
    if (diff > TOLERANCE_M)
      fail(
        `${name} places item ${i + 1} (${item.asset}) ${(diff * 1000).toFixed(1)} mm away from Three.js`,
      );
  }
  report.push(`| ${cells.join(" | ")} |`);
});
report.push("");
const t = engines["Three.js"] ?? [];
const floor = Math.min(...t.map((b) => b.min[1] as number));
if (Math.abs(floor) > TOLERANCE_M) fail(`the scene's lowest point is at y = ${fmt(floor)}, not 0`);
const below = t.findIndex((b) => (b.min[1] as number) < -TOLERANCE_M);
if (below >= 0) fail(`item ${below + 1} goes below the ground`);
report.push(`Lowest point of the scene: y = ${fmt(floor)} m.`, "");
for (const name of Object.keys(engines)) if (!engines[name]) ok = false;
if (notes.length) report.push("## Notes", "", ...notes.map((n) => `- ${n}`), "");
report.push(
  `## Result: ${ok ? "PASS" : "FAIL"}`,
  "",
  "Pictures: threejs.png, godot.png, blender.png in this folder.",
);
writeFileSync(path.join(out, "GATE.md"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
process.exit(ok ? 0 : 1);
