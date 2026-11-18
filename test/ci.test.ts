// Milestone 5: a pull request from a fork that adds an asset is checked with no secrets, by
// validator code from the base branch.
//
// GitHub itself can't be run here, so this test does two things:
// 1. Static checks on the workflow files (trigger, permissions, pinned actions, no secrets).
// 2. A simulation of a fork pull request with real git repositories, running
//    tools/ci/assets-pr.sh exactly as the workflow does.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SIGNOFF_STATEMENT } from "@propcommons/validator";
import { beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..");
/** A workflow or script with its comment lines removed, so checks look only at what runs. */
const read = (p: string) =>
  readFileSync(path.join(REPO, p), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#") || l.startsWith("#!"))
    .join("\n");
const assetsPr = read(".github/workflows/assets-pr.yml");
const codeCi = read(".github/workflows/code-ci.yml");
const deploy = (() => {
  try {
    return read(".github/workflows/deploy.yml");
  } catch {
    return "";
  }
})();

describe("workflow files", () => {
  it("assets-pr runs on pull_request, never pull_request_target, read-only", () => {
    expect(assetsPr).toMatch(/^on:\n {2}pull_request:/m);
    for (const wf of [assetsPr, codeCi, deploy]) expect(wf).not.toContain("pull_request_target");
    expect(assetsPr).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(codeCi).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(assetsPr).toContain("timeout-minutes: 10");
  });

  it("no workflow except deploy uses secrets or write permissions", () => {
    for (const wf of [assetsPr, codeCi]) {
      expect(wf).not.toMatch(/secrets\./);
      expect(wf).not.toMatch(/: write/);
    }
  });

  it("every third-party action is pinned to a commit SHA", () => {
    for (const wf of [assetsPr, codeCi, deploy]) {
      for (const m of wf.matchAll(/uses:\s*(\S+)/g))
        expect(m[1]).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("the validator comes from the base branch and the head is only data", () => {
    expect(assetsPr).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax, not a template.
      "ref: ${{ github.event.pull_request.base.sha }}\n          path: base",
    );
    expect(assetsPr).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax, not a template.
      "ref: ${{ github.event.pull_request.head.sha }}\n          path: head",
    );
    expect(assetsPr).toContain("run: bash base/tools/ci/assets-pr.sh");
    expect(assetsPr).toMatch(/working-directory: base\n\s+run: npm ci/);
    // Pull-request text reaches the shell only through environment variables.
    expect(assetsPr).not.toMatch(/run:.*\$\{\{\s*github\.event/);
    const script = read("tools/ci/assets-pr.sh");
    for (const m of script.matchAll(/^\s*node\s+"?(\S+)/gm)) expect(m[1]).toMatch(/^\$BASE_DIR\//);
    expect(script).not.toMatch(/npm (ci|install)/);
  });
});

// ---- Simulated fork pull request ----

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
    },
  ).trim();

let work = "";
let origin = "";
let base = "";
let baseSha = "";
let pr = 0;

/** Pushes a fork branch to origin as refs/pull/N/head, as GitHub does, and returns its SHA. */
function openPr(edit: (fork: string) => void): string {
  pr += 1;
  const fork = path.join(work, `fork-${pr}`);
  git(work, "clone", "--quiet", origin, fork);
  edit(fork);
  git(fork, "add", "-A");
  git(fork, "commit", "--quiet", "-m", `PR ${pr}`);
  git(fork, "push", "--quiet", "origin", `HEAD:refs/pull/${pr}/head`);
  return git(fork, "rev-parse", "HEAD");
}

function runCheck(headSha: string, author: string, body: string) {
  const head = path.join(work, `head-${pr}`);
  git(work, "clone", "--quiet", "--no-checkout", origin, head);
  git(head, "fetch", "--quiet", "origin", `refs/pull/${pr}/head`);
  git(head, "checkout", "--quiet", headSha);
  const out = path.join(work, `out-${pr}`);
  const r = spawnSync("bash", [path.join(base, "tools/ci/assets-pr.sh")], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BASE_DIR: base,
      HEAD_DIR: head,
      OUT_DIR: out,
      BASE_SHA: baseSha,
      HEAD_SHA: headSha,
      PR_AUTHOR: author,
      PR_BODY: body,
    },
  });
  return {
    code: r.status,
    stderr: r.stderr,
    result: JSON.parse(readFileSync(path.join(out, "result.json"), "utf8")),
    summary: readFileSync(path.join(out, "summary.md"), "utf8"),
  };
}

const signed = `## Sign-off\n\n- [x] ${SIGNOFF_STATEMENT}\n`;

function addAsset(fork: string, author: string, slug: string, manifestExtra: object = {}) {
  const dir = path.join(fork, "assets", author, slug, "v1");
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(fork, "template/model.glb"), path.join(dir, "model.glb"));
  const m = JSON.parse(readFileSync(path.join(fork, "template/asset.json"), "utf8"));
  Object.assign(m, {
    id: `${author}/${slug}`,
    credits: [{ github: author, roles: ["modeled"] }],
    ...manifestExtra,
  });
  writeFileSync(path.join(dir, "asset.json"), JSON.stringify(m, null, 2));
}

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), "propcommons-ci-"));
  // The "upstream" repository: the current working tree, committed.
  const seed = path.join(work, "seed");
  mkdirSync(seed);
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: REPO,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  for (const f of files) {
    try {
      cpSync(path.join(REPO, f), path.join(seed, f));
    } catch {
      // a file deleted in the working tree but still listed
    }
  }
  git(seed, "init", "--quiet");
  git(seed, "add", "-A");
  git(seed, "commit", "--quiet", "-m", "base");
  origin = path.join(work, "origin.git");
  git(work, "clone", "--quiet", "--bare", seed, origin);
  baseSha = git(seed, "rev-parse", "HEAD");
  // The base checkout. In CI this gets `npm ci`; here we borrow the installed node_modules.
  base = path.join(work, "base");
  git(work, "clone", "--quiet", origin, base);
  symlinkSync(path.join(REPO, "node_modules"), path.join(base, "node_modules"));
}, 120_000);

describe("simulated fork pull request", () => {
  it("passes a valid asset under the contributor's own handle", () => {
    const sha = openPr((fork) => addAsset(fork, "alice", "mug"));
    const r = runCheck(sha, "alice", signed);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result).toMatchObject({ pass: true, kind: "assets" });
    expect(r.result.folders.map((f: { target: string }) => f.target)).toEqual([
      "assets/alice/mug/v1",
    ]);
    expect(r.summary).toContain("Prop Commons checks: passed");
  });

  it("fails an asset that breaks a rule, with its rule ID", () => {
    const sha = openPr((fork) => addAsset(fork, "alice", "bowl", { size_class: "large" }));
    const r = runCheck(sha, "alice", signed);
    expect(r.code).toBe(1);
    expect(
      r.result.folders[0].results
        .filter((x: { level: string }) => x.level === "error")
        .map((x: { rule: string }) => x.rule),
    ).toEqual(["SIZE-CLASS"]);
  });

  it("ignores a validator edited in the pull request: the base validator runs", () => {
    const sha = openPr((fork) => {
      // A hostile contributor makes every folder pass in their copy of the validator...
      const v = path.join(fork, "packages/validator/src/result.ts");
      const src = readFileSync(v, "utf8");
      const tampered = src.replace(
        /(export function passes\([^)]*\): boolean \{)/,
        "$1\n  return true;",
      );
      expect(tampered).not.toBe(src);
      writeFileSync(v, tampered);
      // ...and adds an asset that should fail.
      addAsset(fork, "alice", "plate", { size_class: "large" });
    });
    const r = runCheck(sha, "alice", signed);
    expect(r.code).toBe(1);
    expect(r.result.kind).toBe("mixed");
    expect(r.result.problem).toContain("Please split it");
  });

  it("fails without the sign-off and outside the author's handle", () => {
    const sha = openPr((fork) => addAsset(fork, "bob", "cup"));
    const r = runCheck(sha, "mallory", "no sign-off");
    expect(r.code).toBe(1);
    expect(r.result.pr.results.map((x: { rule: string }) => x.rule).sort()).toEqual([
      "PR-OWNER",
      "PR-SIGNOFF",
    ]);
  });

  it("escapes contributor text in the job summary", () => {
    const sha = openPr((fork) => addAsset(fork, "alice", "spoon", { size_class: "large" }));
    const r = runCheck(sha, "alice", signed);
    expect(r.summary).not.toMatch(/<[a-z]/i);
    expect(r.summary).toContain(
      "assets/alice/spoon/v1".replace(/[/.-]/g, (c) => (c === "/" ? "/" : `\\${c}`)),
    );
  });
});
