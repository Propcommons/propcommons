// Rules that need git and pull-request context: VER-NEXT, VER-FROZEN, PR-OWNER, PR-SIGNOFF.
// The caller supplies the changed-file list, the author's login, the pull-request body and a
// checkout of the base branch (read only to list which version folders are already merged).
import { readdirSync } from "node:fs";
import path from "node:path";
import { isRealDir } from "../paths.ts";
import { passes, type RuleResult, result } from "../result.ts";
import { rulesFile, SPEC_VERSION } from "../spec.ts";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
}

export interface PrInput {
  author: string;
  body: string;
  changed: ChangedFile[];
  /** A checkout of the base branch. */
  baseRoot: string;
  /** Maintainer handles, read from the base branch. */
  maintainers: string[];
}

export interface PrCheckResult {
  spec: string;
  target: "pull-request";
  /** "assets" when only assets/ and compositions/ change, "code" when nothing there changes. */
  kind: "assets" | "code" | "mixed";
  pass: boolean;
  results: RuleResult[];
  /** Version folders the pull request adds, relative to the repository root. */
  folders: string[];
}

const VERSION_FILE = /^(assets|compositions)\/([^/]+)\/([^/]+)\/v([1-9][0-9]*)\/[^/]+$/;

export const SIGNOFF_STATEMENT: string = (rulesFile as unknown as { signoffStatement: string })
  .signoffStatement;

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

export type SignoffState = "ticked" | "unticked" | "missing";

/**
 * Finds the sign-off statement in a pull-request description: a checkbox item ("- [x] ..." or
 * "- [ ] ...") whose text is the statement. Spaces and line breaks don't matter, so a statement an
 * editor wrapped onto several lines still counts.
 */
export function signoffState(body: string): SignoffState {
  const want = normalise(SIGNOFF_STATEMENT);
  const lines = body.split(/\r?\n/);
  let found: SignoffState = "missing";
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    let text = m[2] ?? "";
    // Continuation lines: everything up to a blank line or the next list item or heading.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? "";
      if (!next.trim() || /^\s*([-*]\s|#|\d+\.\s)/.test(next)) break;
      text += ` ${next}`;
    }
    if (normalise(text) !== want) continue;
    if (m[1] !== " ") return "ticked";
    found = "unticked";
  }
  return found;
}

/** True when the body carries the sign-off statement with its box ticked. */
export function hasSignoff(body: string): boolean {
  return signoffState(body) === "ticked";
}

export function classifyChanges(changed: ChangedFile[]): "assets" | "code" | "mixed" {
  const isAsset = (p: string) => p.startsWith("assets/") || p.startsWith("compositions/");
  const a = changed.some((c) => isAsset(c.path));
  const o = changed.some((c) => !isAsset(c.path));
  return a && o ? "mixed" : a ? "assets" : "code";
}

function mergedVersions(baseRoot: string, top: string, author: string, slug: string): number[] {
  const dir = path.join(baseRoot, top, author, slug);
  if (!isRealDir(dir)) return [];
  return readdirSync(dir)
    .map((n) => /^v([1-9][0-9]*)$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

export function checkPr(input: PrInput): PrCheckResult {
  const results: RuleResult[] = [];
  const author = input.author.toLowerCase();
  const isMaintainer = input.maintainers.map((m) => m.toLowerCase()).includes(author);
  const kind = classifyChanges(input.changed);

  const assetChanges = input.changed.filter(
    (c) => c.path.startsWith("assets/") || c.path.startsWith("compositions/"),
  );

  // PR-OWNER: every change under assets/ or compositions/ sits under the author's own handle.
  if (!isMaintainer) {
    const foreign = assetChanges
      .filter((c) => c.path.split("/")[1]?.toLowerCase() !== author || !VERSION_FILE.test(c.path))
      .map((c) => c.path);
    if (foreign.length) results.push(result("PR-OWNER", foreign, null, { author }));
  }

  // Group changes by version folder.
  const folders = new Map<string, { top: string; author: string; slug: string; version: number }>();
  for (const c of assetChanges) {
    const m = VERSION_FILE.exec(c.path);
    if (!m) continue;
    const [, top, a, slug, v] = m as unknown as [string, string, string, string, string];
    folders.set(`${top}/${a}/${slug}/v${v}`, { top, author: a, slug, version: Number(v) });
  }

  // VER-FROZEN: no change inside a version folder that already exists on the base branch.
  const added: string[] = [];
  for (const [rel, f] of folders) {
    if (isRealDir(path.join(input.baseRoot, rel))) {
      if (!isMaintainer) {
        const touched = assetChanges.filter((c) => c.path.startsWith(`${rel}/`)).map((c) => c.path);
        const latest = Math.max(...mergedVersions(input.baseRoot, f.top, f.author, f.slug));
        results.push(result("VER-FROZEN", touched, null, { next: latest + 1 }));
      }
    } else {
      added.push(rel);
    }
  }

  // VER-NEXT: each new version is 1, or exactly one higher than the latest merged version.
  for (const rel of added) {
    const f = folders.get(rel);
    if (!f) continue;
    const merged = mergedVersions(input.baseRoot, f.top, f.author, f.slug);
    const next = merged.length ? Math.max(...merged) + 1 : 1;
    if (f.version !== next) results.push(result("VER-NEXT", f.version, next, { target: rel }));
  }

  // PR-SIGNOFF: only pull requests that add or change assets need the statement.
  if (assetChanges.length) {
    const state = signoffState(input.body);
    if (state !== "ticked")
      results.push(
        result("PR-SIGNOFF", false, true, {
          detail:
            state === "unticked"
              ? "The sign-off statement is in the pull request description, but its box isn't ticked."
              : "The pull request description doesn't contain the sign-off statement from the template.",
        }),
      );
  }

  return {
    spec: SPEC_VERSION,
    target: "pull-request",
    kind,
    pass: passes(results),
    results,
    folders: added.sort(),
  };
}
