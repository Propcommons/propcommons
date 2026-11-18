#!/usr/bin/env node
// The propcommons command line: a thin wrapper over @propcommons/validator.
//   propcommons validate <folder...> [--json]
//   propcommons init <author/slug> [--name ...] [--size-class small|medium|large] [--tags a,b] [--ai-assisted] [--tools a,b]
//   propcommons preview <folder> [--out dir]
//   propcommons check-pr --base <dir> --head <dir> --changed <file> --author <login> --body-file <file> [--json]
//   propcommons build-index [--out index.json]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildIndex,
  CannotValidate,
  checkPullRequest,
  findRepoRoot,
  initAsset,
  parseNameStatus,
  type RuleResult,
  type SizeClass,
  UsageError,
  type ValidationResult,
  validateFolder,
} from "@propcommons/validator";

const HELP = `propcommons — tools for the Prop Commons asset library

Commands:
  validate <folder...>      Check version folders against the spec. --json prints the result object.
  init <author/slug>        Create assets/<author>/<slug>/v1 from the template.
                            Options: --name, --size-class, --tags a,b, --ai-assisted, --tools a,b
  preview <folder>          Render the four preview images (see packages/preview).
  check-pr                  Run the pull-request rules and validate the folders a pull request adds.
                            Options: --base <dir> --head <dir> --changed <file> --author <login>
                                     --body-file <file> [--json]
  build-index               Validate everything and write index.json. Option: --out <file>

Exit codes: 0 pass, 1 fail, 2 the tool could not run.`;

const LEVEL_WIDTH = 8;

function printResult(r: ValidationResult) {
  const errors = r.results.filter((x) => x.level === "error").length;
  const warnings = r.results.filter((x) => x.level === "warning").length;
  const summary = [
    errors && `${errors} error${errors > 1 ? "s" : ""}`,
    warnings && `${warnings} warning${warnings > 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(`${r.target}: ${r.pass ? "PASS" : "FAIL"}${summary ? ` (${summary})` : ""}`);
  for (const x of r.results) printRule(x);
}

function printRule(x: RuleResult) {
  console.log(`  ${x.level.padEnd(LEVEL_WIDTH)}${x.rule}  ${x.message}`);
  if (x.level !== "info") console.log(`  ${"".padEnd(LEVEL_WIDTH)}fix: ${x.hint}`);
}

async function cmdValidate(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  if (!positionals.length) throw new UsageError("validate needs at least one folder.");
  const results: ValidationResult[] = [];
  for (const folder of positionals)
    results.push(await validateFolder(folder, { root: findRepoRoot(folder) }));
  if (values.json)
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  else for (const r of results) printResult(r);
  return results.every((r) => r.pass) ? 0 : 1;
}

async function cmdInit(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      "size-class": { type: "string" },
      tags: { type: "string" },
      "ai-assisted": { type: "boolean" },
      tools: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const id = positionals[0];
  if (!id) throw new UsageError("init needs an ID, e.g. propcommons init alice/strawberry-whole");
  const sizeClass = values["size-class"];
  if (sizeClass && !["small", "medium", "large"].includes(sizeClass))
    throw new UsageError("--size-class must be small, medium or large.");
  const list = (s?: string) =>
    s
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  const root = findRepoRoot();
  const dir = initAsset({
    root,
    id,
    name: values.name,
    sizeClass: sizeClass as SizeClass | undefined,
    tags: list(values.tags),
    aiAssisted: values["ai-assisted"],
    tools: list(values.tools),
  });
  const rel = path.relative(process.cwd(), dir) || ".";
  if (values.json) console.log(JSON.stringify({ path: rel }));
  else {
    console.log(`Created ${rel}`);
    console.log("Replace model.glb with your model, edit asset.json, then run:");
    console.log(`  propcommons validate ${rel}`);
  }
  return 0;
}

async function cmdCheckPr(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: "string" },
      head: { type: "string" },
      changed: { type: "string" },
      author: { type: "string" },
      "body-file": { type: "string" },
      json: { type: "boolean" },
    },
  });
  for (const k of ["base", "head", "changed", "author", "body-file"] as const)
    if (!values[k]) throw new UsageError(`check-pr needs --${k}.`);
  const result = await checkPullRequest({
    baseRoot: path.resolve(values.base as string),
    headRoot: path.resolve(values.head as string),
    changed: parseNameStatus(readFileSync(values.changed as string, "utf8")),
    author: values.author as string,
    body: readFileSync(values["body-file"] as string, "utf8"),
  });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Pull request: ${result.pass ? "PASS" : "FAIL"} (${result.kind})`);
    if (result.problem) console.log(`  ${result.problem}`);
    for (const x of result.pr.results) printRule(x);
    for (const f of result.folders) printResult(f);
  }
  return result.pass ? 0 : 1;
}

async function cmdBuildIndex(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { out: { type: "string" } } });
  const root = findRepoRoot();
  const index = await buildIndex(root);
  const out = path.resolve(values.out ?? path.join(root, "index.json"));
  writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);
  const failed = [...index.assets, ...index.compositions].filter((e) => !e.pass);
  console.log(
    `Wrote ${path.relative(process.cwd(), out)}: ${index.assets.length} asset versions, ${index.compositions.length} composition versions.`,
  );
  for (const f of failed)
    console.log(
      `  FAIL ${f.path}: ${f.results
        .filter((r) => r.level === "error")
        .map((r) => r.rule)
        .join(", ")}`,
    );
  return failed.length ? 1 : 0;
}

async function cmdPreview(args: string[]): Promise<number> {
  const { renderPreviewsCli } = await import("@propcommons/preview");
  return renderPreviewsCli(args);
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "validate":
        return await cmdValidate(rest);
      case "init":
        return await cmdInit(rest);
      case "preview":
        return await cmdPreview(rest);
      case "check-pr":
        return await cmdCheckPr(rest);
      case "build-index":
        return await cmdBuildIndex(rest);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return command === undefined ? 2 : 0;
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (e) {
    if (
      e instanceof UsageError ||
      e instanceof CannotValidate ||
      (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`propcommons: ${(e as Error).message}`);
      if (e instanceof UsageError) console.error("Run `propcommons help` for usage.");
      return 2;
    }
    console.error(e);
    return 2;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
