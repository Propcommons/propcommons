// Milestone 4: `init` followed by `validate` passes, and `--json` output matches the spec's result
// format (checked against spec/result.schema.json). Runs the real command line as a child process.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SIGNOFF_STATEMENT } from "@propcommons/validator";
import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFixtures, type FixtureCase } from "../../../fixtures/build.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const MAIN = path.join(REPO, "packages/cli/src/main.ts");
const resultSchema = JSON.parse(readFileSync(path.join(REPO, "spec/result.schema.json"), "utf8"));
const checkResult = new Ajv2020({ allErrors: true, strict: false }).compile(resultSchema);

function cli(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [MAIN, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

let repo = "";
let cases: FixtureCase[] = [];

beforeAll(async () => {
  repo = mkdtempSync(path.join(tmpdir(), "propcommons-cli-"));
  for (const f of ["template", "project.config.json", "MAINTAINERS"])
    cpSync(path.join(REPO, f), path.join(repo, f), { recursive: true });
  cases = await buildFixtures(path.join(repo, "fixtures"));
}, 120_000);

describe("command line", () => {
  it("init followed by validate passes", () => {
    const init = cli(
      ["init", "alice/strawberry-whole", "--name", "Strawberry, whole", "--tags", "food,fruit"],
      repo,
    );
    expect(init.code, init.stderr).toBe(0);
    const v = cli(["validate", "assets/alice/strawberry-whole/v1"], repo);
    expect(v.code, v.stdout).toBe(0);
    expect(v.stdout).toContain("assets/alice/strawberry-whole/v1: PASS");
    const manifest = JSON.parse(
      readFileSync(path.join(repo, "assets/alice/strawberry-whole/v1/asset.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      id: "alice/strawberry-whole",
      version: 1,
      name: "Strawberry, whole",
      tags: ["food", "fruit"],
    });
  });

  it("init refuses an existing asset and a bad ID", () => {
    expect(cli(["init", "alice/strawberry-whole"], repo).code).toBe(2);
    expect(cli(["init", "Alice/Strawberry"], repo).code).toBe(2);
  });

  it("--json output matches the result schema, for every fixture", () => {
    for (const c of cases) {
      const r = cli(["validate", "--json", c.folder], repo);
      const json = JSON.parse(r.stdout);
      expect(checkResult(json), `${c.name}: ${JSON.stringify(checkResult.errors)}`).toBe(true);
      expect(r.code, c.name).toBe(json.pass ? 0 : 1);
    }
  });

  it("exit code 2 when the folder can't be read", () => {
    const r = cli(["validate", "does/not/exist"], repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Cannot read the folder");
  });

  it("check-pr validates an asset pull request", () => {
    const work = mkdtempSync(path.join(tmpdir(), "propcommons-pr-"));
    const base = path.join(work, "base");
    const head = path.join(work, "head");
    mkdirSync(base);
    writeFileSync(path.join(base, "MAINTAINERS"), "mattashes\n");
    cpSync(path.join(repo, "assets"), path.join(head, "assets"), { recursive: true });
    writeFileSync(
      path.join(work, "changed.txt"),
      "A\tassets/alice/strawberry-whole/v1/asset.json\nA\tassets/alice/strawberry-whole/v1/model.glb\n",
    );
    writeFileSync(path.join(work, "body.md"), `- [x] ${SIGNOFF_STATEMENT}\n`);
    const args = [
      "check-pr",
      "--base",
      base,
      "--head",
      head,
      "--changed",
      path.join(work, "changed.txt"),
      "--body-file",
      path.join(work, "body.md"),
      "--json",
    ];
    const ok = cli([...args, "--author", "alice"], repo);
    expect(ok.code, ok.stdout).toBe(0);
    const okJson = JSON.parse(ok.stdout);
    expect(okJson).toMatchObject({ pass: true, kind: "assets" });
    expect(checkResult(okJson.folders[0])).toBe(true);
    const bad = cli([...args, "--author", "mallory"], repo);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).pr.results.map((r: { rule: string }) => r.rule)).toEqual([
      "PR-OWNER",
    ]);
  });

  it("build-index writes every version with effective credits", () => {
    const comp = path.join(repo, "compositions/alice/pair/v1");
    mkdirSync(comp, { recursive: true });
    writeFileSync(
      path.join(comp, "composition.json"),
      JSON.stringify({
        spec: "0.1",
        id: "alice/pair",
        version: 1,
        name: "Pair",
        license: "CC0-1.0",
        credits: [{ name: "Someone", roles: ["directed"] }],
        ai_assisted: false,
        tools: ["hand"],
        items: [
          { asset: "alice/strawberry-whole@1", position: [-0.1, 0, 0], rotation: [0, 0, 0, 1] },
          { asset: "alice/strawberry-whole@1", position: [0.1, 0, 0], rotation: [0, 0, 0, 1] },
        ],
      }),
    );
    const out = path.join(repo, "index.json");
    const r = cli(["build-index", "--out", out], repo);
    expect(r.code, r.stdout).toBe(0);
    const index = JSON.parse(readFileSync(out, "utf8"));
    expect(index.assets).toHaveLength(1);
    expect(index.assets[0]).toMatchObject({
      ref: "alice/strawberry-whole@1",
      latest: true,
      taken_down: false,
      pass: true,
    });
    expect(index.compositions[0].credits).toEqual([
      { name: "Someone", roles: ["directed"] },
      { github: "alice", roles: ["modeled"] },
    ]);
  });

  it("is runnable through npm as `propcommons`", () => {
    const out = execFileSync("npm", ["run", "--silent", "propcommons", "--", "help"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(out).toContain("propcommons — tools for the Prop Commons asset library");
  });

  it("check-pr --against checks your own commits before you push", () => {
    const work = mkdtempSync(path.join(tmpdir(), "propcommons-against-"));
    const g = (...a: string[]) =>
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", ...a], {
        cwd: work,
      });
    for (const f of ["template", "project.config.json", "MAINTAINERS"])
      cpSync(path.join(REPO, f), path.join(work, f), { recursive: true });
    g("init", "-q", "-b", "main");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("checkout", "-q", "-b", "add-cup");
    expect(cli(["init", "dana/cup", "--name", "Cup"], work).code).toBe(0);
    g("add", "assets");
    g("commit", "-q", "-m", "Add dana/cup@1");
    // Still init's placeholder model: refused, as GitHub would.
    const placeholder = cli(["check-pr", "--against", "main"], work);
    expect(placeholder.code).toBe(1);
    expect(placeholder.stdout).toContain("placeholder box");
    cpSync(
      path.join(REPO, "assets/mattashes/lemon/v1/model.glb"),
      path.join(work, "assets/dana/cup/v1/model.glb"),
    );
    g("commit", "-q", "-am", "Real model");
    const ok = cli(["check-pr", "--against", "main"], work);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("Pull request: PASS (assets)");
  });

  it("improve starts a better version, and check-pr refuses it until the model changes", () => {
    const work = mkdtempSync(path.join(tmpdir(), "propcommons-improve-"));
    const g = (...a: string[]) =>
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", ...a], {
        cwd: work,
      });
    for (const f of ["template", "project.config.json", "MAINTAINERS"])
      cpSync(path.join(REPO, f), path.join(work, f), { recursive: true });
    cpSync(
      path.join(REPO, "assets/mattashes/lemon/v1"),
      path.join(work, "assets/mattashes/lemon/v1"),
      {
        recursive: true,
      },
    );
    g("init", "-q", "-b", "main");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    g("checkout", "-q", "-b", "better-lemon");
    const made = cli(
      [
        "improve",
        "mattashes/lemon",
        "--as",
        "dana",
        "--ai-assisted",
        "--tools",
        "Claude Opus 5.5",
        "--json",
      ],
      work,
    );
    expect(made.code, made.stderr).toBe(0);
    expect(JSON.parse(made.stdout)).toMatchObject({
      path: "assets/dana/lemon/v1",
      from: "mattashes/lemon@1",
    });
    const manifest = JSON.parse(
      readFileSync(path.join(work, "assets/dana/lemon/v1/asset.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ id: "dana/lemon", version: 1, parent: "mattashes/lemon@1" });
    expect(manifest).not.toHaveProperty("source_url");
    expect(manifest).not.toHaveProperty("notes_url");
    const v = cli(["validate", "assets/dana/lemon/v1"], work);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("same file as mattashes/lemon@1");
    const vj = cli(["validate", "assets/dana/lemon/v1", "--json"], work);
    expect(JSON.parse(vj.stdout)).toMatchObject({ pass: true });
    expect(vj.stderr).toContain("same file as mattashes/lemon@1");
    g("add", "assets");
    g("commit", "-q", "-m", "Add dana/lemon@1");
    const copy = cli(["check-pr", "--against", "main"], work);
    expect(copy.code).toBe(1);
    expect(copy.stdout).toContain("has not changed");
    cpSync(
      path.join(REPO, "assets/mattashes/orange/v1/model.glb"),
      path.join(work, "assets/dana/lemon/v1/model.glb"),
    );
    g("commit", "-q", "-am", "Better model");
    const ok = cli(["check-pr", "--against", "main"], work);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    // The author's own asset: the next version of it.
    const own = cli(
      ["improve", "dana/lemon", "--as", "dana", "--tools", "Blender", "--json"],
      work,
    );
    expect(JSON.parse(own.stdout).path).toBe("assets/dana/lemon/v2");
  });
});
