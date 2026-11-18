# Prop Commons Asset Spec v0.1 (draft)

Version 0.1, draft · 18 November 2026 · Licensed [CC BY 4.0](LICENSE)

A conforming asset is one folder that holds a plain glTF binary and a short manifest, and passes every error-level rule below. This draft covers static, realistic props at real-world scale and nothing else.

## Status and scope

This is version 0.1, a draft: any rule may change until three independent contributors have built one composition with it, and breaking changes are allowed until 1.0.

- **In scope:** static props between about 1 cm and 4 m, realistic style, real-world scale, one object per asset.
- **Out of scope for 0.1:** characters, animation, stylized work, buildings and terrain, sockets, states, behaviours, shared materials, detail levels and compressed web builds.
- **Rule levels:** an error blocks the pull request, a warning is shown to the contributor and reviewer, and info is a measurement with no limit yet.
- **Every rule has a stable ID.** IDs are never reused or renamed, so tools and agents can rely on them across spec versions.
- **Anything the validator can't test is guidance,** listed in its own section and judged by the reviewer.

## Folder layout and IDs

An asset version is one folder with fixed file names, so nothing about the layout is a choice.

```text
assets/
  alice/                      author: GitHub handle, lower case
    strawberry-whole/         slug: lower case letters, digits, hyphens
      v3/                     version: whole number, starts at 1
        asset.json            manifest, written by the author
        model.glb             the visual model
        collision.glb         optional collision shapes
compositions/
  alice/
    fruit-bowl/
      v1/
        composition.json
```

- **ID:** `author/slug`, as in `alice/strawberry-whole`. A pinned reference adds the version: `alice/strawberry-whole@3`.
- **Ownership:** only the author named in the path, or a maintainer, may add a version under it. Anyone else publishes under their own handle and records the original in `parent`.
- **Immutability:** a merged version folder never changes. An improvement is a new folder, `v4`, and old versions stay so compositions that pin them keep working.
- **Takedown:** a maintainer replaces the folder's contents with a `tombstone.json` that gives the reason and date. The ID and version are never reused.
- **Generated data:** bounds, triangle counts, file sizes, SHA-256 hashes and preview images are produced by the validator when the site is built and published in one `index.json`. None of it is committed by hand.

## Model rules

The model is plain glTF 2.0 with nothing a mainstream importer can't read: units are metres, +Y is up and the front of the asset faces +Z, as glTF itself defines. Budgets are in the next section.

| Rule ID       | Requirement                                                                                             | Level   |
| ------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| FILE-VALID    | `model.glb` is a glTF 2.0 binary that passes the Khronos glTF Validator with no errors                  | error   |
| FILE-EMBEDDED | All buffers and images are embedded; there are no external URIs                                         | error   |
| FILE-EXT      | `extensionsRequired` is empty, and `extensionsUsed` holds only extensions on the allowlist below        | error   |
| FILE-SIZE     | The file is within the size budget for its size class                                                   | error   |
| SCENE-ROOT    | There is one scene with one root node, and the root has no translation, rotation or scale               | error   |
| SCENE-SCALE   | No node has a scale other than 1, so transforms are applied and nothing is mirrored                     | error   |
| SCENE-STATIC  | There are no cameras, lights, animations, skins or morph targets                                        | error   |
| SIZE-CLASS    | The longest side of the bounding box falls inside the range of the declared size class                  | error   |
| ORIGIN-Y      | The lowest point of the model is at y = 0, within 1 mm                                                  | error   |
| ORIGIN-XZ     | Seen from above, the origin lies inside the model's bounding box                                        | error   |
| ORIGIN-CENTER | The origin is within 25% of the footprint's width from the footprint's centre                           | warning |
| GEO-MODE      | Every primitive is a triangle list                                                                      | error   |
| GEO-TRIS      | The total triangle count is within budget                                                               | error   |
| GEO-ATTRS     | Every primitive has positions and normals, and texture coordinates wherever its material uses a texture | error   |
| GEO-COLOR     | There are no vertex colours, because importers apply them differently                                   | error   |
| MAT-COUNT     | The number of materials is within budget                                                                | error   |
| MAT-BLEND     | Alpha mode is opaque or mask; blend is flagged because engines sort it differently                      | warning |
| TEX-FORMAT    | Every image is PNG or JPEG                                                                              | error   |
| TEX-SIZE      | Image width and height are powers of two and no larger than the budget                                  | error   |
| TEX-ORM       | If both an occlusion texture and a metallic-roughness texture exist, they are the same image            | warning |
| TEX-DENSITY   | Texel density, in pixels per metre, is measured and reported                                            | info    |
| COL-CLEAN     | `collision.glb`, when present, holds only meshes: no materials, textures or extensions                  | error   |
| COL-CONVEX    | Each collision mesh is a convex hull of at most 64 vertices, and there are at most 8 of them            | error   |
| COL-BOUNDS    | Collision meshes share the model's coordinate frame and stay inside its bounding box, with 5% tolerance | error   |

**Extension allowlist for 0.1:** `KHR_materials_transmission`, `KHR_materials_volume` and `KHR_materials_ior`. They are there so glass can be glass. Compression extensions (Draco, Meshopt, KTX2, WebP) are not on the list: the committed file is uncompressed, and smaller web builds can be generated from it later.

**Why collision is a separate file:** a collision mesh inside `model.glb` shows up as visible geometry in most importers. Several small convex hulls also let a bowl stay hollow, where a single hull would seal it shut.

## Size classes and budgets

The author declares one of three size classes and the validator checks the model against it; every number here is a proposed starting value, not a settled one.

| Size class | Longest side      | Examples                        | Max triangles | Max texture side (px) | Max materials | Max file size |
| ---------- | ----------------- | ------------------------------- | ------------- | --------------------- | ------------- | ------------- |
| small      | 0.01 to 0.3 m     | strawberry, mug, knife, bowl    | 5,000         | 1024                  | 2             | 5 MB          |
| medium     | over 0.3 to 1.2 m | cutting board, pot, stool, lamp | 15,000        | 2048                  | 3             | 10 MB         |
| large      | over 1.2 to 4 m   | table, shelf, fridge            | 40,000        | 2048                  | 4             | 10 MB         |

- **The class is declared, not derived, on purpose.** A model exported in centimetres instead of metres is 100 times too big or too small, so it always lands outside its declared class and fails SIZE-CLASS.
- **Budgets are for one game-ready model.** A hero version with more detail lives with the source, outside this spec.
- **Texel density is only measured in 0.1.** Once the first kit exists, its numbers set a target range per class and TEX-DENSITY becomes a warning.

## Manifest

`asset.json` holds only what a machine can't work out from the model: who made it, under what terms, and what it is. Ten fields are required.

| Field         | Required | Value                                                                    |
| ------------- | -------- | ------------------------------------------------------------------------ |
| `spec`        | yes      | `"0.1"`                                                                  |
| `id`          | yes      | `author/slug`, matching the folder path                                  |
| `version`     | yes      | Whole number, matching the folder                                        |
| `name`        | yes      | Display name in English, up to 80 characters                             |
| `license`     | yes      | `"CC0-1.0"`                                                              |
| `size_class`  | yes      | `small`, `medium` or `large`                                             |
| `tags`        | yes      | 1 to 10 lower-case tags                                                  |
| `credits`     | yes      | One or more people, each with a GitHub handle or a name, and their roles |
| `ai_assisted` | yes      | `true` or `false`                                                        |
| `tools`       | yes      | Software and AI models used, as free text                                |
| `wikidata`    | no       | A Wikidata ID: Q followed by digits                                      |
| `parent`      | no       | Pinned ID of the asset this one derives from                             |
| `source_url`  | no       | Link to the generator or source files                                    |
| `notes_url`   | no       | Link to a write-up of the process                                        |
| `x-...`       | no       | Any key that starts with `x-` is allowed and ignored                     |

```json
{
  "spec": "0.1",
  "id": "alice/strawberry-whole",
  "version": 3,
  "name": "Strawberry, whole",
  "license": "CC0-1.0",
  "size_class": "small",
  "tags": ["food", "fruit"],
  "credits": [{ "github": "alice", "roles": ["directed", "modeled"] }],
  "ai_assisted": true,
  "tools": ["Blender", "Claude"],
  "parent": "alice/strawberry-whole@2"
}
```

The schema below is the normative form. Its `$id` is a placeholder until the site has its final address.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.org/spec/0.1/asset.schema.json",
  "title": "Asset manifest 0.1",
  "type": "object",
  "required": [
    "spec",
    "id",
    "version",
    "name",
    "license",
    "size_class",
    "tags",
    "credits",
    "ai_assisted",
    "tools"
  ],
  "additionalProperties": false,
  "patternProperties": { "^x-": {} },
  "properties": {
    "spec": { "const": "0.1" },
    "id": { "$ref": "#/$defs/id" },
    "version": { "type": "integer", "minimum": 1 },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "license": { "const": "CC0-1.0" },
    "size_class": { "enum": ["small", "medium", "large"] },
    "tags": {
      "type": "array",
      "minItems": 1,
      "maxItems": 10,
      "uniqueItems": true,
      "items": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" }
    },
    "credits": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/credit" }
    },
    "ai_assisted": { "type": "boolean" },
    "tools": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "string", "minLength": 1, "maxLength": 80 }
    },
    "wikidata": { "type": ["string", "null"], "pattern": "^Q[1-9][0-9]*$" },
    "parent": {
      "type": ["string", "null"],
      "pattern": "^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?/[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$"
    },
    "source_url": { "type": ["string", "null"], "format": "uri" },
    "notes_url": { "type": ["string", "null"], "format": "uri" }
  },
  "$defs": {
    "id": {
      "type": "string",
      "maxLength": 104,
      "pattern": "^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?/[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "credit": {
      "type": "object",
      "additionalProperties": false,
      "required": ["roles"],
      "anyOf": [{ "required": ["github"] }, { "required": ["name"] }],
      "properties": {
        "github": { "type": "string", "pattern": "^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$" },
        "name": { "type": "string", "minLength": 1, "maxLength": 80 },
        "roles": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "enum": ["directed", "modeled", "sculpted", "textured", "coded", "scanned"] }
        }
      }
    }
  }
}
```

Eight more rules cover what the schema can't see: the folder, the history and the pull request. Maintainers are exempt from VER-FROZEN and PR-OWNER so they can process takedowns.

| Rule ID      | Requirement                                                                                      | Level |
| ------------ | ------------------------------------------------------------------------------------------------ | ----- |
| FOLDER-FILES | The version folder holds `asset.json`, `model.glb`, optionally `collision.glb`, and nothing else | error |
| MAN-SCHEMA   | `asset.json` validates against the schema                                                        | error |
| MAN-PATH     | `id` and `version` match the folder path                                                         | error |
| MAN-PARENT   | `parent`, when set, names a version that exists and is not taken down                            | error |
| VER-NEXT     | A new version is 1, or exactly one higher than the latest merged version                         | error |
| VER-FROZEN   | The pull request changes no file inside a version folder that is already merged                  | error |
| PR-OWNER     | The pull request adds files only under the contributor's own handle                              | error |
| PR-SIGNOFF   | The pull request carries the sign-off statement, with its box ticked                             | error |

## Compositions

A composition is a list of pinned assets with a placement for each, and it contains no geometry of its own. It carries the same identity and credit fields as an asset manifest, plus `items`.

```json
{
  "spec": "0.1",
  "id": "alice/fruit-bowl",
  "version": 1,
  "name": "Fruit bowl",
  "license": "CC0-1.0",
  "credits": [{ "github": "alice", "roles": ["directed"] }],
  "ai_assisted": true,
  "tools": ["Blender"],
  "items": [
    { "asset": "bob/glass-bowl@1", "position": [0, 0, 0], "rotation": [0, 0, 0, 1] },
    {
      "asset": "alice/strawberry-whole@3",
      "position": [0.021, 0.034, -0.012],
      "rotation": [0.131, 0, 0.052, 0.99]
    },
    {
      "asset": "alice/strawberry-whole@3",
      "position": [-0.03, 0.031, 0.018],
      "rotation": [0, 0.383, 0, 0.924],
      "scale": 0.9
    }
  ]
}
```

- **Placement:** `position` is in metres, `rotation` is a quaternion in glTF order (x, y, z, w), and `scale` is one optional number that defaults to 1.
- **Frame:** the composition follows the same conventions as an asset: +Y up, resting on y = 0, origin at the centre of its footprint.
- **Where positions come from:** a physics drop in the authoring tool or hand placement. The file stores the result, so loading it needs no physics.
- **Flat in 0.1:** items point at assets only, never at other compositions.

| Rule ID    | Requirement                                                                   | Level   |
| ---------- | ----------------------------------------------------------------------------- | ------- |
| CMP-SCHEMA | `composition.json` validates against its schema                               | error   |
| CMP-REFS   | Every item pins an asset version that exists and is not taken down            | error   |
| CMP-ROT    | Every rotation is a unit quaternion, within 0.001                             | error   |
| CMP-COUNT  | There are between 2 and 200 items                                             | error   |
| CMP-SCALE  | Every scale is between 0.5 and 2, since assets are already at real-world size | warning |

The effective credit list of a composition is its own credits plus those of every asset it pins, and the validator writes that list to the index.

## Validator output

The validator returns one JSON result per folder, and every failure names its rule, what was measured, the limit and how to fix it, so an agent can correct the asset and run again without reading this document.

```json
{
  "spec": "0.1",
  "target": "assets/alice/strawberry-whole/v3",
  "pass": false,
  "results": [
    {
      "rule": "ORIGIN-Y",
      "level": "error",
      "message": "The lowest point of the model is 0.041 m above the origin.",
      "measured": 0.041,
      "limit": 0.001,
      "unit": "m",
      "hint": "Move the mesh down by 0.041 m so its lowest point sits at y = 0, then apply the transform and export again."
    },
    {
      "rule": "GEO-TRIS",
      "level": "error",
      "message": "The model has 7,420 triangles; the budget for size class small is 5,000.",
      "measured": 7420,
      "limit": 5000,
      "unit": "triangles",
      "hint": "Reduce the mesh by about 33%, or move fine surface detail into the normal map."
    }
  ],
  "measured": {
    "bounds_m": [0.028, 0.034, 0.028],
    "triangles": 7420,
    "materials": 1,
    "textures": [{ "slot": "baseColor", "width": 1024, "height": 1024, "format": "png" }],
    "texel_density_px_per_m": 9800,
    "file_bytes": 3120044,
    "sha256": "..."
  }
}
```

- **`pass`** is true when there are no error-level results. Warnings and info never fail a run.
- **`measured`** is always present, pass or fail. It is the same data the site publishes in `index.json`.
- **Exit codes:** 0 for a pass, 1 for a fail, 2 when the validator could not run, for example on a missing file.
- **One code path:** the command line, the MCP `validate` tool and CI all return this exact structure.
- **Fixtures define the rules.** Each rule ID has at least one example file that must pass and one that must fail, kept in the validator's test suite.

## License and sign-off

Every asset and composition is released under CC0 1.0, and every pull request carries the statement below, made by a person. PR-SIGNOFF checks that it is present.

> I made this asset, or I have the right to release every part of it, including its textures, scans and any AI tool output. I release it under CC0 1.0. It contains no real brands, logos, recognisable characters or likenesses of real people.

- **A person signs.** An agent may prepare the pull request, but the contributor confirms the statement themselves.
- **Content rules:** no real brands or logos, no recognisable characters from existing works, no likenesses of real people, nothing sexual or hateful. A reviewer enforces these; no check can.
- **Source files are separate.** Generators and add-ons are linked through `source_url`, keep their own license, and are not hosted or run by the project.
- **Credit is recorded even though CC0 doesn't require it.** The `credits` list is how contributors are named on the site and in exported credit files.
- **This wording is a draft.** Have someone with legal training read it before the first outside contribution is merged.

## Guidance the validator can't check

These five points are judged by the reviewer from the preview images, which show the asset from fixed angles beside a scale reference (a 10 cm cube for small assets, a 1 m cube otherwise) and its nearest neighbours in the kit.

1. **Real-world proportions.** SIZE-CLASS catches a unit mistake, not a strawberry the size of an apple.
2. **Resting pose and facing.** The asset sits the way it would on a table, and anything with a front faces +Z.
3. **Normal map direction.** glTF uses the OpenGL convention (green points up); a flipped map shows as inverted bumps in the preview.
4. **Graceful fallback.** An asset that uses an allowlisted extension should still be recognisable in an engine that ignores it.
5. **Fit with the kit.** Colour, wear and level of detail should sit comfortably beside existing assets of the same size class.

## Open decisions

The first two are settled: the project is Prop Commons and its code is MIT licensed. The other eight stand as proposed values to build with, and are revisited once the first kit has tested them against real assets.

- Settled: Project name: Prop Commons
- Settled: Code license: MIT
- Budget numbers: triangles, texture side, materials and file size per class
- Size class boundaries at 0.3 m and 1.2 m
- Extension allowlist: the three glass extensions, or none at first
- Image formats: PNG and JPEG, or PNG only
- Vertex colours banned outright, or allowed with a warning
- Collision limits of 8 hulls and 64 vertices each
- The list of credit roles
- Sign-off wording, after a legal read
