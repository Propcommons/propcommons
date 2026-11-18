// JSON Schema validation for manifests (MAN-SCHEMA, CMP-SCHEMA), using Ajv's draft 2020-12 build.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { ASSET_SCHEMA, COMPOSITION_SCHEMA } from "./spec.ts";

// ajv-formats is CommonJS; under Node ESM its default export may arrive wrapped.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => Ajv2020;

// strictRequired is off because the normative schema uses `anyOf: [{required: ["github"]}, ...]`,
// which is valid JSON Schema but trips Ajv's extra lint. Every other strict check stays on.
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});
addFormats(ajv);

export const validateAssetManifest = ajv.compile(ASSET_SCHEMA);
export const validateCompositionManifest = ajv.compile(COMPOSITION_SCHEMA);

export interface SchemaProblem {
  path: string;
  message: string;
}

export function schemaProblems(
  validate: typeof validateAssetManifest,
  data: unknown,
): SchemaProblem[] {
  if (validate(data)) return [];
  return (validate.errors ?? []).map((e) => ({
    path: e.instancePath || "(top level)",
    message:
      e.keyword === "additionalProperties"
        ? `has an unknown field "${String((e.params as { additionalProperty?: string }).additionalProperty)}"`
        : (e.message ?? "is invalid"),
  }));
}
