// Renders previews for every folder a pull request adds, for the CI artifact. Runs from the base
// checkout; the head tree is only read as data (its GLB files are loaded by the sandboxed browser).
// Usage: node tools/ci/previews.ts <result.json> <head dir> <out dir>
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderPreviews } from "@propcommons/preview";
import type { PullRequestCheck } from "@propcommons/validator";

const [resultFile, headDir, outDir] = process.argv.slice(2);
if (!resultFile || !headDir || !outDir) {
  console.error("Usage: node tools/ci/previews.ts <result.json> <head dir> <out dir>");
  process.exit(2);
}
const check: PullRequestCheck = JSON.parse(readFileSync(resultFile, "utf8"));
for (const f of check.folders) {
  if (!f.target.startsWith("assets/")) continue;
  // Only render models the validator could read.
  if (
    f.results.some((r) =>
      ["FOLDER-FILES", "FILE-SIZE", "FILE-VALID", "FILE-EMBEDDED"].includes(r.rule),
    )
  ) {
    console.log(`skip ${f.target}: the model can't be rendered until its file errors are fixed`);
    continue;
  }
  try {
    const r = await renderPreviews(path.join(headDir, f.target), {
      root: headDir,
      outDir: path.join(outDir, f.target.replace(/^assets\//, "")),
    });
    console.log(
      `rendered ${f.target}${r.neighbours.length ? ` (kit: ${r.neighbours.join(", ")})` : ""}`,
    );
  } catch (e) {
    console.log(`could not render ${f.target}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
