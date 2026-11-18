// The pull-request rules (VER-NEXT, VER-FROZEN, PR-OWNER, PR-SIGNOFF): a passing and a failing
// scenario for each. A scenario is a base-branch tree plus a changed-file list, author and body.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type ChangedFile, checkPr, hasSignoff, SIGNOFF_STATEMENT } from "../src/index.ts";

let base = "";
const signed = `## Sign-off\n\n- [x] ${SIGNOFF_STATEMENT}\n`;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "propcommons-base-"));
  for (const rel of ["assets/alice/mug/v1", "assets/alice/mug/v2", "assets/bob/bowl/v1"]) {
    mkdirSync(path.join(base, rel), { recursive: true });
    writeFileSync(path.join(base, rel, "asset.json"), "{}");
  }
});

const added = (...paths: string[]): ChangedFile[] =>
  paths.map((p) => ({ path: p, status: "added" }));
const run = (author: string, changed: ChangedFile[], body = signed, maintainers = ["maint"]) =>
  checkPr({ author, body, changed, baseRoot: base, maintainers });
const ruleIds = (r: ReturnType<typeof checkPr>) =>
  [...new Set(r.results.map((x) => x.rule))].sort();

describe("check-pr rules", () => {
  it("passes a new first version under the author's own handle", () => {
    const r = run(
      "carol",
      added("assets/carol/spoon/v1/asset.json", "assets/carol/spoon/v1/model.glb"),
    );
    expect(r).toMatchObject({ pass: true, kind: "assets", folders: ["assets/carol/spoon/v1"] });
  });

  it("passes the next version of an existing asset", () => {
    expect(run("alice", added("assets/alice/mug/v3/asset.json")).pass).toBe(true);
  });

  it("VER-NEXT fails a version that skips a number", () => {
    const r = run("alice", added("assets/alice/mug/v5/asset.json"));
    expect(ruleIds(r)).toEqual(["VER-NEXT"]);
    expect(r.results[0]).toMatchObject({ measured: 5, limit: 3 });
  });

  it("VER-NEXT fails a first version that is not 1", () => {
    expect(ruleIds(run("carol", added("assets/carol/spoon/v2/model.glb")))).toEqual(["VER-NEXT"]);
  });

  it("VER-FROZEN fails a change inside a merged version", () => {
    const r = run("alice", [{ path: "assets/alice/mug/v1/model.glb", status: "modified" }]);
    expect(ruleIds(r)).toEqual(["VER-FROZEN"]);
  });

  it("VER-FROZEN exempts maintainers (takedowns)", () => {
    const r = run("maint", [
      { path: "assets/bob/bowl/v1/asset.json", status: "deleted" },
      { path: "assets/bob/bowl/v1/tombstone.json", status: "added" },
    ]);
    expect(r.pass).toBe(true);
  });

  it("PR-OWNER fails files under someone else's handle", () => {
    expect(ruleIds(run("carol", added("assets/bob/plate/v1/asset.json")))).toEqual(["PR-OWNER"]);
  });

  it("PR-OWNER exempts maintainers", () => {
    expect(run("maint", added("assets/bob/plate/v1/asset.json")).pass).toBe(true);
  });

  it("PR-SIGNOFF fails without the ticked statement", () => {
    const unticked = signed.replace("[x]", "[ ]");
    expect(ruleIds(run("carol", added("assets/carol/spoon/v1/asset.json"), unticked))).toEqual([
      "PR-SIGNOFF",
    ]);
    expect(
      ruleIds(run("carol", added("assets/carol/spoon/v1/asset.json"), "no statement")),
    ).toEqual(["PR-SIGNOFF"]);
  });

  it("accepts the statement with different line wrapping", () => {
    const wrapped = `- [X] ${SIGNOFF_STATEMENT.replace(/\. /g, ".  ")}`;
    expect(hasSignoff(wrapped)).toBe(true);
    expect(hasSignoff(`- [x] ${SIGNOFF_STATEMENT.replace("CC0 1.0", "CC BY")}`)).toBe(false);
  });

  it("classifies code and mixed pull requests", () => {
    expect(run("carol", added("README.md")).kind).toBe("code");
    expect(run("carol", added("README.md", "assets/carol/spoon/v1/asset.json")).kind).toBe("mixed");
  });
});
