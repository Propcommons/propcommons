// Folder layout: assets/<author>/<slug>/v<N>/ and compositions/<author>/<slug>/v<N>/.
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

export const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PINNED =
  /^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9]+(?:-[a-z0-9]+)*)@([1-9][0-9]*)$/;

export interface VersionPath {
  kind: "asset" | "composition";
  author: string;
  slug: string;
  version: number;
  /** The repository root: the directory holding assets/ and compositions/. */
  root: string;
  /** Path relative to the root, with forward slashes, e.g. assets/alice/mug/v1. */
  rel: string;
}

/** Parses an absolute or relative folder path. Returns null when it is not in the layout. */
export function parseVersionPath(folder: string): VersionPath | null {
  const abs = path.resolve(folder);
  const parts = abs.split(path.sep);
  const n = parts.length;
  const [top, author, slug, v] = parts.slice(n - 4);
  if (!top || !author || !slug || !v) return null;
  if (top !== "assets" && top !== "compositions") return null;
  const m = /^v([1-9][0-9]*)$/.exec(v);
  if (!m || !HANDLE.test(author) || !SLUG.test(slug)) return null;
  return {
    kind: top === "assets" ? "asset" : "composition",
    author,
    slug,
    version: Number(m[1]),
    root: parts.slice(0, n - 4).join(path.sep) || path.sep,
    rel: `${top}/${author}/${slug}/${v}`,
  };
}

export type VersionState = "live" | "taken-down" | "missing";

/** Whether assets/<author>/<slug>/v<N> exists in a tree and is not a tombstone. */
export function assetVersionState(root: string, pinned: string): VersionState {
  const m = PINNED.exec(pinned);
  if (!m) return "missing";
  const dir = path.join(root, "assets", m[1] as string, m[2] as string, `v${m[3]}`);
  if (!isRealDir(dir)) return "missing";
  if (existsSync(path.join(dir, "tombstone.json"))) return "taken-down";
  return existsSync(path.join(dir, "asset.json")) ? "live" : "missing";
}

export function isRealDir(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Posix-style path relative to a root, for messages and output. */
export function relPosix(root: string, p: string): string {
  return path.relative(root, p).split(path.sep).join("/");
}
