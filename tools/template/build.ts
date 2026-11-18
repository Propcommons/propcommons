// Regenerates template/model.glb: a 10 cm placeholder box with a checker texture, resting on
// y = 0 and centred on the origin. `propcommons init` copies it into each new asset folder.
// Run: node tools/template/build.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { boxGlb } from "../../fixtures/build.ts";

const out = path.join(import.meta.dirname, "..", "..", "template", "model.glb");
writeFileSync(out, await boxGlb());
console.log(`Wrote ${out}`);
