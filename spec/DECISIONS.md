# Decisions made while building

The spec (SPEC.md) is normative. Where it left something open or ambiguous, the builder took the
simplest reading and recorded it here. Each entry names the rule or section it affects. These are
build choices, not spec changes: any of them can be reversed by the maintainer.

## Spec files

- **Megabytes are decimal.** The size budgets say "5 MB" and "10 MB"; `budgets.json` uses
  1 MB = 1,000,000 bytes.
- **Size class edges.** small is 0.01 m to 0.3 m inclusive; medium is over 0.3 m up to and
  including 1.2 m; large is over 1.2 m up to and including 4 m. A longest side under 0.01 m or over
  4 m fits no class and fails SIZE-CLASS.
- **Compositions may carry tags.** `composition.schema.json` allows an optional `tags` list (same
  rules as asset tags) plus `source_url`, `notes_url` and `x-` keys. It does not limit the number of
  items, because CMP-COUNT does that, so a too-short composition fails with exactly CMP-COUNT.
- **Ajv strictness.** The asset schema is copied from SPEC.md unchanged. Ajv's optional
  `strictRequired` lint is turned off because the schema's `anyOf` of `required` clauses is valid
  JSON Schema but trips that lint.
- **Message templates.** `rules.json` holds a message template as well as the hint template for
  each rule, so no human-readable text is hard-coded in rule functions.
- **License files.** `spec/LICENSE` and `assets/LICENSE` state the license and link to the official
  legal text rather than copying it in full.
