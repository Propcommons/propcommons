#!/usr/bin/env node
// The propcommons command line: a thin wrapper over @propcommons/validator.
//   propcommons validate <folder...> [--json]
//   propcommons init <author/slug> [--name ...] [--size-class small|medium|large] [--tags a,b] [--ai-assisted] [--tools a,b]
//   propcommons improve <author/slug[@N]> --as <handle> [--slug ...] [--ai-assisted] --tools a,b
//   propcommons preview <folder> [--out dir]
//   propcommons check-pr --base <dir> --head <dir> --changed <file> --author <login> --body-file <file> [--json]
//   propcommons build-index [--out index.json]
//   propcommons settle <composition folder> [--dry-run] [--no-center] [--json]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildIndex,
  CannotValidate,
  checkPullRequest,
  findRepoRoot,
  improveAsset,
  initAsset,
  isPlaceholderModel,
  parseNameStatus,
  type RuleResult,
  SIGNOFF_STATEMENT,
  type SizeClass,
  UsageError,
  unchangedFrom,
  type ValidationResult,
  validateFolder,
} from "@propcommons/validator";
import { cmdSettle } from "./settle.ts";

const HELP = `propcommons — tools for the Prop Commons asset library

Commands:
  validate <folder...>      Check version folders against the spec. --json prints the result object.
  init <author/slug>        Create assets/<author>/<slug>/v1 from the template.
                            Options: --name, --size-class, --tags a,b, --ai-assisted, --tools a,b
  improve <author/slug[@N]> Start a better version of an existing asset from a copy of it: the
                            next version if it is yours, otherwise a new asset under your handle
                            that names the original as its parent.
                            Options: --as <your handle>, --slug, --ai-assisted, --tools a,b
  preview <folder>          Render the preview images (see packages/preview).
  check-pr --against [branch]
                            Check your committed work the way GitHub will, before you push.
                            The branch defaults to upstream/main (or origin/main).
  check-pr                  (CI) Run the pull-request rules and validate the folders it adds.
                            Options: --base <dir> --head <dir> --changed <file> --author <login>
                                     --body-file <file> [--json]
  settle <folder>           Drop each item of a composition straight down, in order, until it
                            rests on the ground or an earlier item, and centre the scene.
                            Options: --dry-run, --no-center, --json
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
  // Notes go to stderr with --json, so the JSON on stdout stays exactly the result object.
  const note = (line: string) => (values.json ? console.error : console.log)(`  note    ${line}`);
  if (values.json)
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  positionals.forEach((folder, i) => {
    if (!values.json) printResult(results[i] as ValidationResult);
    if (isPlaceholderModel(findRepoRoot(folder), folder))
      note(
        "model.glb is still the placeholder box from `propcommons init`. Replace it with your own model; a pull request with the placeholder is refused.",
      );
    const same = unchangedFrom(folder);
    if (same)
      note(
        `model.glb is still the same file as ${same}. Replace it with the better model; a pull request with an unchanged model is refused.`,
      );
  });
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
    console.log("Next:");
    console.log("  1. Replace model.glb with your model (it is a 10 cm placeholder box).");
    console.log(
      "  2. Check asset.json, especially ai_assisted (true if any AI tool helped) and tools.",
    );
    console.log(`  3. npx propcommons validate ${rel}`);
  }
  return 0;
}

async function cmdImprove(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      as: { type: "string" },
      slug: { type: "string" },
      "ai-assisted": { type: "boolean" },
      tools: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const from = positionals[0];
  if (!from)
    throw new UsageError(
      "improve needs the asset to start from, e.g. propcommons improve alice/mug",
    );
  const root = findRepoRoot();
  let author = values.as;
  if (!author) {
    try {
      author = execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" })
        .trim()
        .toLowerCase();
    } catch {
      throw new UsageError("Give your GitHub handle with --as, e.g. --as alice.");
    }
  }
  const tools = values.tools
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tools?.length)
    throw new UsageError(
      'List the software and AI models you use with --tools, e.g. --tools "Blender".',
    );
  const r = improveAsset({
    root,
    from,
    author,
    slug: values.slug,
    aiAssisted: values["ai-assisted"] ?? false,
    tools,
  });
  const rel = (p: string) => path.relative(process.cwd(), p) || ".";
  if (values.json)
    console.log(JSON.stringify({ path: rel(r.dir), from: r.source, from_path: rel(r.sourceDir) }));
  else {
    console.log(`Created ${rel(r.dir)}, starting from ${r.source}.`);
    console.log("Next:");
    console.log(`  1. Look at the original: npx propcommons preview ${rel(r.sourceDir)}`);
    console.log("  2. Replace model.glb with your better model, at about the same size.");
    console.log(`  3. npx propcommons validate ${rel(r.dir)}`);
  }
  return 0;
}

const git = (root: string, args: string[], input?: Buffer) =>
  execFileSync("git", ["-C", root, ...args], { input, maxBuffer: 1 << 30 });

/**
 * `check-pr --against <branch>`: runs the same pull-request check GitHub will, on the commits of
 * the current branch, against the main project's branch (default: upstream/main, else
 * origin/main). Nothing is pushed. Without --body-file the sign-off is assumed ticked, since
 * GitHub checks it against the real pull-request description.
 */
async function checkAgainst(against: string, author?: string, bodyFile?: string) {
  const root = findRepoRoot();
  let ref = against;
  if (!ref) {
    const has = (r: string) => {
      try {
        git(root, ["rev-parse", "--verify", "--quiet", r]);
        return true;
      } catch {
        return false;
      }
    };
    ref = ["upstream/main", "origin/main", "main"].find(has) ?? "main";
  }
  const changedText = git(root, [
    "diff",
    "--name-status",
    "--no-renames",
    `${ref}...HEAD`,
  ]).toString();
  const changed = parseNameStatus(changedText);
  if (!changed.length)
    throw new UsageError(`No committed changes compared with ${ref}. Commit your folder first.`);
  const base = mkdtempSync(path.join(tmpdir(), "propcommons-base-"));
  execFileSync("tar", ["-x", "-C", base], { input: git(root, ["archive", "--format=tar", ref]) });
  const handle =
    author ??
    changed
      .map((c) => c.path.split("/"))
      .find((p) => p[0] === "assets" || p[0] === "compositions")?.[1];
  if (!handle)
    throw new UsageError("Couldn't tell whose handle this is; pass --author <your-handle>.");
  let body: string;
  if (bodyFile) body = readFileSync(bodyFile, "utf8");
  else {
    console.error(
      "Note: the sign-off is assumed ticked here; on GitHub it is checked against your pull request's description.",
    );
    body = `- [x] ${SIGNOFF_STATEMENT}`;
  }
  console.error(`Checking your commits against ${ref} as ${handle}.`);
  return checkPullRequest({ baseRoot: base, headRoot: root, changed, author: handle, body });
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
      against: { type: "string" },
      json: { type: "boolean" },
    },
  });
  let result: Awaited<ReturnType<typeof checkPullRequest>>;
  if (values.against !== undefined) {
    result = await checkAgainst(values.against, values.author, values["body-file"]);
  } else {
    for (const k of ["base", "head", "changed", "author", "body-file"] as const)
      if (!values[k])
        throw new UsageError(
          `check-pr needs --${k}, or --against <branch> to check your own work.`,
        );
    result = await checkPullRequest({
      baseRoot: path.resolve(values.base as string),
      headRoot: path.resolve(values.head as string),
      changed: parseNameStatus(readFileSync(values.changed as string, "utf8")),
      author: values.author as string,
      body: readFileSync(values["body-file"] as string, "utf8"),
    });
  }
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
      case "improve":
        return await cmdImprove(rest);
      case "init":
        return await cmdInit(rest);
      case "preview":
        return await cmdPreview(rest);
      case "check-pr":
        return await cmdCheckPr(rest);
      case "build-index":
        return await cmdBuildIndex(rest);
      case "settle":
        return await cmdSettle(rest);
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
