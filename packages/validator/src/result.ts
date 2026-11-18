// The validator's output format, as defined in the spec's "Validator output" section.
import { type Level, rule } from "./spec.ts";

export interface RuleResult {
  rule: string;
  level: Level;
  message: string;
  measured: unknown;
  limit: unknown;
  unit: string | null;
  hint: string;
}

export interface TextureMeasure {
  slot: string;
  width: number | null;
  height: number | null;
  format: string;
}

export interface AssetMeasured {
  bounds_m: [number, number, number] | null;
  triangles: number | null;
  materials: number | null;
  textures: TextureMeasure[];
  texel_density_px_per_m: number | null;
  file_bytes: number | null;
  sha256: string | null;
}

export interface CompositionMeasured {
  items: number | null;
  file_bytes: number | null;
  sha256: string | null;
}

export interface ValidationResult {
  spec: string;
  target: string;
  pass: boolean;
  results: RuleResult[];
  measured: AssetMeasured | CompositionMeasured | Record<string, never>;
}

/** Values used to fill a rule's message and hint templates. */
export type TemplateVars = Record<string, string | number | null | undefined>;

export function formatValue(v: unknown): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return String(Number(v.toFixed(4)));
  }
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (v === null || v === undefined) return "none";
  return String(v);
}

export function fill(template: string, vars: TemplateVars): string {
  return template.replace(/\{([a-z_]+)\}/gi, (whole, key: string) =>
    key in vars ? formatValue(vars[key]) : whole,
  );
}

/**
 * Builds one result entry. `measured` and `limit` are the raw values; `vars` can add or
 * override template values (for example a preformatted detail string).
 */
export function result(
  id: string,
  measured: unknown,
  limit: unknown,
  vars: TemplateVars = {},
): RuleResult {
  const def = rule(id);
  const all: TemplateVars = {
    measured: Array.isArray(measured) ? measured.join(", ") : (measured as TemplateVars[string]),
    limit: Array.isArray(limit) ? limit.join(", ") : (limit as TemplateVars[string]),
    ...vars,
  };
  return {
    rule: id,
    level: def.level,
    message: fill(def.message, all),
    measured: measured ?? null,
    limit: limit ?? null,
    unit: def.unit ?? null,
    hint: fill(def.hint, all),
  };
}

export function passes(results: RuleResult[]): boolean {
  return !results.some((r) => r.level === "error");
}
