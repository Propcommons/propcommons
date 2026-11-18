// Loads the spec's machine-readable files (rules, budgets, schemas) from spec/.
// These files are the single source of truth: no limit or message is hard-coded elsewhere.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SPEC_DIR = fileURLToPath(new URL("../../../spec/", import.meta.url));

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../spec/${name}`, import.meta.url), "utf8")) as T;
}

export type Level = "error" | "warning" | "info";
export type RuleTarget = "asset" | "composition";

export interface RuleDef {
  id: string;
  level: Level;
  applies: RuleTarget[];
  runner: "validate" | "check-pr";
  title: string;
  message: string;
  hint: string;
  unit?: string;
}

export type SizeClass = "small" | "medium" | "large";

export interface SizeClassBudget {
  minLongestSide_m: number;
  maxLongestSide_m: number;
  minInclusive: boolean;
  maxTriangles: number;
  maxTextureSide_px: number;
  maxMaterials: number;
  maxFileBytes: number;
}

export interface Budgets {
  spec: string;
  sizeClasses: Record<SizeClass, SizeClassBudget>;
  files: { maxManifestBytes: number; maxAnyFileBytes: number };
  extensionAllowlist: string[];
  imageMimeTypes: string[];
  origin: { centerFraction: number };
  collision: {
    maxHulls: number;
    maxHullVertices: number;
    boundsTolerance: number;
    convexTolerance_m: number;
  };
  composition: { minItems: number; maxItems: number; minScale: number; maxScale: number };
  tolerances: { length_m: number; scale: number; quaternionLength: number };
}

export const rulesFile = readJson<{ spec: string; rules: RuleDef[] }>("rules.json");
export const RULES: ReadonlyMap<string, RuleDef> = new Map(rulesFile.rules.map((r) => [r.id, r]));
export const BUDGETS = readJson<Budgets>("budgets.json");
export const ASSET_SCHEMA = readJson<Record<string, unknown>>("asset.schema.json");
export const COMPOSITION_SCHEMA = readJson<Record<string, unknown>>("composition.schema.json");
export const SPEC_VERSION = rulesFile.spec;

export function rule(id: string): RuleDef {
  const r = RULES.get(id);
  if (!r) throw new Error(`Unknown rule ID ${id}; add it to spec/rules.json`);
  return r;
}
