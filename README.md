# Prop Commons

An open, community-run library of free game props where every asset follows one contract, so parts
made by different people fit together without rework.

**Browse the library:** https://propcommons.github.io/propcommons/

**Build a scene in your browser:** https://propcommons.github.io/propcommons/studio/ — pick props,
click to place them (they land on whatever is under them: the floor, a table, a shelf), then
download the whole scene as one `.glb` for Godot, Unity, Blender or a web game. "Describe…" writes a
prompt for any AI assistant to lay a scene out from a sentence.

A strawberry from one person, a bowl from another and a cutting board from a third load together
as one fruit bowl, at the right scale and resting correctly, with no manual fixes. That works
because every asset is a plain glTF file in metres, standing on the ground, centred, and checked
by the same validator.

## Use the assets

- **Everything is CC0 1.0.** Use any asset for anything, commercial or not, with no credit
  required. Credit is recorded anyway, on each asset's page.
- **Download** a model from its page on the site, or take it straight from this repository:
  `assets/<author>/<slug>/v<N>/model.glb`.
- **Pin a version.** IDs look like `alice/strawberry-whole@3`. A published version never changes;
  improvements become a new version.
- **In Godot 4:** drop a `model.glb` into your project and Godot's importer handles it. For clear
  glass to import as see-through, also copy [`tools/godot/addons/prop_commons`](tools/godot/addons/prop_commons)
  into your project's `addons/` folder and enable "Prop Commons" in Project Settings > Plugins. To load
  assets or whole compositions while a game is running (for example from a downloaded copy of the
  library), copy [`tools/godot/prop_commons.gd`](tools/godot/prop_commons.gd) into your project and
  call `PropCommons.load_asset_file(path)` or `PropCommons.load_composition_file(json, library)`.
  It also shows clear glass as see-through, which Godot's importer doesn't. Tested with Godot 4.7.2.
- **For tools and agents:** [`index.json`](https://propcommons.github.io/propcommons/index.json)
  lists every asset with its measured size, triangle count, textures, credits and file paths. Its
  shape is documented in [`spec/INDEX.md`](spec/INDEX.md). [`llms.txt`](https://propcommons.github.io/propcommons/llms.txt)
  is a short guide for language models.

## Contribute an asset

Read [CONTRIBUTING.md](CONTRIBUTING.md). It has two paths, one with a coding agent and one by
hand, and goes step by step from a fresh clone to an open pull request. The site's
[Wanted page](https://propcommons.github.io/propcommons/wanted/) lists what the kit needs.

The rules are in the spec: [`spec/SPEC.md`](spec/SPEC.md). The validator checks almost all of them
and tells you exactly what to fix. Inside your clone, after `npm ci`:

```bash
npx propcommons validate assets/mattashes/lemon/v1
```

## What's in this repository

| Path                            | What it is                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `spec/`                         | The asset spec, its schemas, rule list and size budgets, and the decisions made while building |
| `assets/`, `compositions/`      | The library itself, one folder per version                                                     |
| `packages/validator`            | The validator library that everything else uses                                                |
| `packages/cli`                  | The `propcommons` command line: `validate`, `init`, `preview`, `check-pr`, `build-index`       |
| `packages/mcp`                  | A local MCP server so coding agents can use the same tools                                     |
| `tools/npm`                     | The `propcommons` package on npm: one command that connects an agent and sets everything up    |
| `packages/preview`              | The reference scene and preview renderer                                                       |
| `packages/site`                 | The static website                                                                             |
| `tools/blender/export_asset.py` | A Blender script that exports a collection as a valid asset                                    |
| `template/`                     | The starting folder that `propcommons init` copies                                             |
| `.github/workflows/`            | The checks that run on pull requests, and the site deploy                                      |

## Status

This is v0. The spec is a draft (0.1): any rule may change until three independent contributors
have built one composition with it. The size budgets are proposed starting values.

## Project

- [GOVERNANCE.md](GOVERNANCE.md): who decides and how
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant 3.0
- [CONTENT_POLICY.md](CONTENT_POLICY.md): what assets may and may not contain, and takedowns
- [SECURITY.md](SECURITY.md): how to report a security problem
- [AGENTS.md](AGENTS.md): for coding agents and the people driving them

## Licenses

Code is [MIT](LICENSE). Assets and compositions are
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The spec text is
[CC BY 4.0](spec/LICENSE). The code of conduct is adapted from the Contributor Covenant 3.0
(CC BY-SA 4.0).
