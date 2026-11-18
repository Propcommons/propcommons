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

## Validator

- **Results list only what needs attention.** `results` holds every failed error or warning, plus
  the info-level TEX-DENSITY measurement. Rules that pass are not listed. Every entry has all seven
  keys (`rule`, `level`, `message`, `measured`, `limit`, `unit`, `hint`); a key with nothing to say
  is `null`.
- **`measured` when the model can't be read.** It is always present. Values that could not be
  measured (for example after FILE-VALID fails) are `null`, and `textures` is empty.
- **A composition's `measured`** is `{ items, file_bytes, sha256 }`, and a takedown's is `{}`.
- **The result's shape is pinned by `spec/result.schema.json`**, which the tests check the command
  line's `--json` output against.
- **FILE-SIZE runs twice.** Before anything is parsed, `asset.json` and `composition.json` must be at
  most 64 KB and any `.glb` at most 10 MB (the largest class budget); larger files are rejected
  unread. Once the manifest gives the size class, `model.glb` and `collision.glb` are each checked
  against that class's budget.
- **FOLDER-FILES rejects sub-folders, symlinks and hidden files** such as `.DS_Store`, and never reads
  them. A composition folder may hold only `composition.json`.
- **MAN-PATH applies to compositions too**: `id` and `version` must match
  `compositions/author/slug/vN`.
- **Exit code 2** is used only when the folder itself can't be read (missing, not a folder). A
  missing `model.glb` inside a folder is a FOLDER-FILES error (exit code 1).
- **FILE-EMBEDDED and FILE-EXT run on the raw JSON** before glTF-Transform reads the file, so an
  external URI is never followed and an unknown required extension is reported as FILE-EXT, not
  FILE-VALID. `data:` URIs count as embedded. The Khronos validator is given a resource loader
  that always refuses, and its load error for a URI already reported by FILE-EMBEDDED is dropped.
- **Triangles count triangle lists only.** Other primitive modes fail GEO-MODE and add nothing to
  GEO-TRIS. Each node that uses a mesh counts it again.
- **Materials** is the number of materials in the file.
- **SIZE-CLASS edges get the 1 mm length tolerance**, in favour of the declared class.
- **ORIGIN-XZ and ORIGIN-CENTER** both use the footprint; ORIGIN-CENTER measures the straight-line
  distance from the origin to the footprint's centre in the XZ plane. An origin outside the
  footprint always triggers both.
- **Texel density** is measured on each primitive's base colour texture (or, without one, its first
  texture), and is `null` when nothing is textured.
- **TEX-FORMAT checks the bytes and the declared type**: an image passes only when it really is PNG
  or JPEG and its MIME type says the same.
- **Collision.** Each primitive in `collision.glb` is one hull. Vertices within 1 micrometre are
  welded; a hull is closed when every edge is shared by exactly two triangles, and convex when no
  vertex lies more than 0.5 mm in front of any face, with faces facing outward by their winding
  (counter-clockwise, as glTF defines). COL-CLEAN also fails a `collision.glb` that the Khronos
  validator rejects, or that has samplers, cameras, animations, skins or external files.
  COL-BOUNDS allows 5% of the model's extent on each axis, plus 1 mm.
- **Fixtures.** "Each failing fixture fails with exactly its own rule ID" is checked as: for an
  error rule, the set of error-level IDs is exactly that rule; for a warning rule, there are no
  errors and the set of warnings is exactly that rule. TEX-DENSITY is info and never fails; its
  "failing" fixture is an untextured box whose density is `null`. The valid base box is the
  passing fixture for every rule that has no dedicated passing case.

## Pull-request rules

- **VER-FROZEN covers deletions as well as edits**, and counts any version folder that exists on
  the base branch (taken-down versions included) as merged. Maintainers are exempt.
- **VER-NEXT** compares each new version folder with the highest version on the base branch,
  taken-down versions included, so a version number is never reused. A pull request that adds two
  new versions of one asset fails for the second. Maintainers are not exempt.
- **PR-OWNER** also fails any file under `assets/` or `compositions/` that is not inside a version
  folder (for example `assets/LICENSE`), unless the author is a maintainer.
- **PR-SIGNOFF** looks for a ticked checkbox line (`- [x] ...`) whose text is the statement from the
  spec, ignoring differences in spaces and line breaks. The statement lives in `spec/rules.json`
  as `signoffStatement`. Code-only pull requests don't need it.
