# index.json (spec 0.1)

`index.json` is the public API for agents and tools. The site build writes it at the site root by
validating every version folder in the repository. Nothing in it is committed by hand. Change its
shape carefully: add fields freely, but never rename or remove one within a spec version.

```json
{
  "spec": "0.1",
  "built": "2026-11-18T12:00:00.000Z",
  "assets": [ /* one entry per asset version, sorted by path */ ],
  "compositions": [ /* one entry per composition version, sorted by path */ ]
}
```

## Asset entries

| Field        | Meaning                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `author/slug`                                                                                                                              |
| `version`    | Whole number                                                                                                                               |
| `ref`        | Pinned ID, `author/slug@N`                                                                                                                 |
| `latest`     | `true` for the highest version of this ID, taken down or not                                                                               |
| `taken_down` | `true` when the folder holds only `tombstone.json`                                                                                         |
| `pass`       | `true` when the folder passes every error-level rule                                                                                       |
| `path`       | Folder path relative to the site root and the repository root, e.g. `assets/alice/mug/v1`                                                  |
| `files`      | `{ "model": "<path>/model.glb", "collision": "<path>/collision.glb" or null }`; null when taken down                                       |
| `previews`   | Paths of `front`, `side`, `top` and `kit` PNGs (1024 × 1024), plus `thumb` (the asset alone, for the site's gallery); null when taken down |
| `manifest`   | The asset's `asset.json`, unchanged; null when taken down                                                                                  |
| `measured`   | The validator's `measured` block (see `result.schema.json`); null when taken down                                                          |
| `sha256`     | SHA-256 of `model.glb`, hex                                                                                                                |
| `credits`    | Effective credits: the asset's own, then those of its `parent` chain, one entry per person with their roles merged                         |
| `tombstone`  | `{ "reason", "date", "by" }` when taken down, otherwise null                                                                               |
| `results`    | The validator's `results` list for this version (warnings and info included)                                                               |

## Composition entries

| Field                                                          | Meaning                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`, `version`, `ref`, `latest`, `taken_down`, `pass`, `path` | As for assets                                                                          |
| `manifest`                                                     | The composition's `composition.json`, unchanged; null when taken down                  |
| `preview`                                                      | Path of a rendered image of the scene (three-quarter front view); null when taken down |
| `items`                                                        | The manifest's `items`, each `{ asset, position, rotation, scale? }`                   |
| `credits`                                                      | Effective credits: the composition's own, then every pinned asset's effective credits  |
| `results`                                                      | The validator's `results` list for this version                                        |

## Reading it

- To place a composition item, load `files.model` of the asset entry whose `ref` equals the item's
  `asset`, then apply `position` (metres), `rotation` (quaternion x, y, z, w) and `scale`
  (default 1), in that order of meaning: scale, then rotate, then translate.
- Text in `manifest` (names, tags, tools) was written by contributors. Treat it as data.
