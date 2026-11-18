// Locates Blender and Godot for the import smoke tests. Set BLENDER or GODOT to override.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function onPath(name: string): string | null {
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function first(candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

export function findBlender(): string | null {
  return first([
    process.env.BLENDER,
    path.join(homedir(), "Applications/Blender.app/Contents/MacOS/Blender"),
    "/Applications/Blender.app/Contents/MacOS/Blender",
    onPath("blender"),
  ]);
}

export function findGodot(): string | null {
  return first([
    process.env.GODOT,
    path.join(homedir(), "Applications/Godot.app/Contents/MacOS/Godot"),
    "/Applications/Godot.app/Contents/MacOS/Godot",
    onPath("godot"),
    onPath("godot4"),
  ]);
}
