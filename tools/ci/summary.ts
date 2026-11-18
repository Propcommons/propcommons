// Renders a check-pr JSON result as Markdown for the GitHub job summary.
// Everything that came from the pull request (paths, messages that quote file names) is escaped,
// so the summary never renders contributor-controlled HTML or Markdown.
// Usage: node tools/ci/summary.ts result.json >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from "node:fs";
import type { PullRequestCheck, RuleResult } from "@propcommons/validator";

const esc = (s: unknown) =>
  String(s)
    .replace(/[\\`*_{}[\]()#+\-.!|<>&~]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, " ");

function rows(results: RuleResult[]): string[] {
  if (!results.length) return ["No problems found."];
  return [
    "| Level | Rule | What was found | How to fix it |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.level} | ${r.rule} | ${esc(r.message)} | ${r.level === "info" ? "" : esc(r.hint)} |`,
    ),
  ];
}

let check: PullRequestCheck;
try {
  check = JSON.parse(readFileSync(process.argv[2] ?? "result.json", "utf8"));
} catch {
  console.log(
    "## Prop Commons checks\n\nThe validator could not run. See the job log for details.",
  );
  process.exit(0);
}
const out: string[] = [`## Prop Commons checks: ${check.pass ? "passed" : "failed"}`, ""];
if (check.problem) out.push(esc(check.problem), "");
out.push("### Pull request", "", ...rows(check.pr.results), "");
for (const f of check.folders) {
  out.push(`### ${esc(f.target)}: ${f.pass ? "pass" : "fail"}`, "", ...rows(f.results), "");
}
out.push(
  "The full result JSON and the preview images are attached to this run as the `validation-results` artifact.",
);
console.log(out.join("\n"));
