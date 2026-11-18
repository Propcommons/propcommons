// Regenerates template/model.glb: a 10 cm placeholder box with a checker texture, resting on
// y = 0 and centred on the origin. `propcommons init` copies it into each new asset folder.
// Run: node tools/template/build.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { boxGlb } from "../../fixtures/build.ts";
import { readGlb, writeGlb } from "../../packages/validator/src/glb.ts";

const out = path.join(import.meta.dirname, "..", "..", "template", "model.glb");
// Name the default scene, as importers expect (Godot warns without it).
const glb = readGlb(await boxGlb());
glb.json.scene = 0;
writeFileSync(out, writeGlb(glb));
console.log(`Wrote ${out}`);
