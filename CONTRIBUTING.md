# Contributing to Prop Commons

This guide takes you from nothing to an open pull request that adds one asset. There are two paths:
**with a coding agent** (Claude Code or any agent that speaks MCP) and **by hand**. Both use the
same validator, and both end with you, a person, signing off.

Everything you contribute is released under **CC0 1.0** (public domain). Read the
[content policy](CONTENT_POLICY.md) before you start: no real brands, logos, recognisable
characters or likenesses of real people, and you must have the right to release every part of the
asset, textures and AI output included.

## 1. What you need

- A **GitHub account**.
- **git**: `git --version` should print a version. On macOS, running it the first time offers to
  install it.
- **Node.js 26** from https://nodejs.org (the LTS download). `node --version` should print v26 or
  later.
- **Blender** if you model in Blender (optional; any tool that exports glTF works). The export
  script is tested with Blender 5.3; older versions may work.

## 2. Get the tools

1. Open https://github.com/Propcommons/propcommons and click **Fork**, then **Create fork**. This
   makes your own copy on GitHub that you can push to.
2. Clone your fork. Replace `YOUR-HANDLE` with your GitHub username:

   ```bash
   git clone https://github.com/YOUR-HANDLE/propcommons.git
   ```

   ```bash
   cd propcommons
   ```

3. Install the tools (this takes a minute):

   ```bash
   npm ci
   ```

4. Optional, for preview images: install the headless browser the renderer uses (about 200 MB).

   ```bash
   npx playwright install --only-shell chromium
   ```

5. Check it works:

   ```bash
   npx propcommons help
   ```

## 3. Pick something to make

- The [Wanted page](https://propcommons.github.io/propcommons/wanted/) lists what the kit needs.
- Check the [library](https://propcommons.github.io/propcommons/) so you don't duplicate an asset.
  To improve an existing one, see [New versions](#new-versions-and-derived-assets) below.
- Keep to the spec's scope: one static, realistic object between about 1 cm and 4 m, at real-world
  size.

Choose an **ID**: your GitHub handle in lower case, a slash, and a short name using lower-case
letters, digits and hyphens, for example `alice/wooden-spoon`.

Choose a **size class** from the object's longest side:

| Size class | Longest side        | Max triangles | Max texture size | Max materials | Max file size |
| ---------- | ------------------- | ------------- | ---------------- | ------------- | ------------- |
| `small`    | 1 cm to 30 cm       | 5,000         | 1024 px          | 2             | 5 MB          |
| `medium`   | over 30 cm to 1.2 m | 15,000        | 2048 px          | 3             | 10 MB         |
| `large`    | over 1.2 m to 4 m   | 40,000        | 2048 px          | 4             | 10 MB         |

Fine surface detail belongs in the normal map, not in extra triangles.

## 4a. With a coding agent

The repository includes a local MCP server with six tools: `get_spec`, `init_asset`, `validate`,
`render_preview`, `search_assets` and `submit`. [AGENTS.md](AGENTS.md) has the setup for any
client. With Claude Code, run this once in the `propcommons` folder:

```bash
claude mcp add propcommons -- node packages/mcp/src/main.ts
```

Then ask your agent something like:

> Using the propcommons MCP tools, make a small asset `YOUR-HANDLE/wooden-spoon`: a plain
> wooden spoon about 30 cm long. Read the spec first, validate until it passes, show me the
> previews, then show me the sign-off statement before you submit.

What to expect:

- The agent reads the spec, creates the folder, makes or exports the model, and runs `validate`
  until it passes. Each failure names a rule and says how to fix it.
- It renders previews. **Look at them yourself**: is it the right size next to the scale cube, is
  it resting the way it would on a table, and does it sit well beside its neighbours?
- Before `submit`, the agent must show you the sign-off statement word for word. Confirm it only if
  it is true. `submit` uses your own `gh` login (install the GitHub CLI from
  https://cli.github.com and run `gh auth login`). Without `gh`, it gives you the manual steps,
  which are steps 6 and 7 below.

## 4b. By hand

### Create the folder

```bash
npx propcommons init YOUR-HANDLE/wooden-spoon --name "Wooden spoon" --size-class small --tags kitchen,utensil,wood
```

This creates `assets/YOUR-HANDLE/wooden-spoon/v1/` with an `asset.json` and a placeholder
`model.glb` (a 10 cm box). You replace the model next.

### Make the model

Whatever tool you use, the result must be:

- **In metres, at real-world size.** A 30 cm spoon is 0.3 units long.
- **+Y up, front facing +Z** (the glTF standard; exporters do this conversion for you).
- **Standing on the ground**: its lowest point at height 0, and its footprint centred on the origin.
- **One object**: one root node, with every transform applied (no scale other than 1).
- **Triangles with normals**, UVs on anything textured, and **no vertex colours**.
- **PNG or JPEG textures** whose sides are powers of two (256, 512, 1024...), embedded in the file.
- **Plain glTF**: no Draco or Meshopt compression, no KTX2 or WebP textures. The only extensions
  allowed are the three glass ones: `KHR_materials_transmission`, `KHR_materials_volume` and
  `KHR_materials_ior`.
- **Static**: no cameras, lights, animation, armatures or shape keys.

### Export from Blender

Put the object (or the parts that make it up) in a collection named `Asset`. Optionally, put up to
8 simple convex shapes of at most 64 vertices each in a collection named `collision`. Save the
.blend file, then run, from the `propcommons` folder:

```bash
blender --background path/to/your.blend --python tools/blender/export_asset.py -- --collection Asset --out assets/YOUR-HANDLE/wooden-spoon/v1
```

The script works on copies and never changes or saves your .blend. It applies modifiers and
transforms, joins and triangulates the parts, puts the lowest point on the ground and centres the
footprint, removes vertex colours, and writes `model.glb` (and `collision.glb` if you made one).
On macOS, `blender` is usually `/Applications/Blender.app/Contents/MacOS/Blender`.

**Other tools:** export a binary glTF (`.glb`) to `assets/YOUR-HANDLE/wooden-spoon/v1/model.glb`
with compression off, textures embedded, and no cameras, lights or animation.

### Fill in asset.json

Open `assets/YOUR-HANDLE/wooden-spoon/v1/asset.json` in a text editor and check every field:

| Field                   | What to put                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                  | Display name in English, up to 80 characters                                                                                                                                               |
| `size_class`            | `small`, `medium` or `large`                                                                                                                                                               |
| `tags`                  | 1 to 10 lower-case tags, e.g. `["kitchen", "utensil"]`                                                                                                                                     |
| `credits`               | Everyone who worked on it: `{ "github": "handle", "roles": [...] }` or `{ "name": "Full Name", "roles": [...] }`. Roles: `directed`, `modeled`, `sculpted`, `textured`, `coded`, `scanned` |
| `ai_assisted`           | `true` if any AI tool made or changed any part of it, otherwise `false`                                                                                                                    |
| `tools`                 | Software and AI models used, e.g. `["Blender", "Substance Painter"]`                                                                                                                       |
| `source_url` (optional) | A link to your source files or generator                                                                                                                                                   |
| `notes_url` (optional)  | A link to a write-up of how you made it                                                                                                                                                    |
| `wikidata` (optional)   | The Wikidata ID of the kind of object: `Q` and digits, e.g. `Q89` for apple                                                                                                                |

Leave `spec`, `id`, `version` and `license` as `init` wrote them.

## 5. Validate and look at it

```bash
npx propcommons validate assets/YOUR-HANDLE/wooden-spoon/v1
```

It prints `PASS` or `FAIL`. Every problem has a rule ID, what was measured, the limit, and a
`fix:` line saying what to do. Fix them and run it again until it passes. Warnings don't block a
pull request, but a reviewer will ask about them. Add `--json` to get the full result as JSON.

Then render the previews a reviewer will see (needs the browser from step 2.4):

```bash
npx propcommons preview assets/YOUR-HANDLE/wooden-spoon/v1
```

The four images land in `previews/YOUR-HANDLE/wooden-spoon/v1/`: front, side and top beside a
scale cube (10 cm for small assets, 1 m otherwise), and `kit.png` beside up to two existing assets
of the same size class. Check the things the validator can't:

1. **Proportions**: is it the right size next to the cube?
2. **Pose and facing**: does it rest the way it would on a table, front towards you?
3. **Normal map**: bumps should look like bumps, not dents.
4. **Fit with the kit**: does it look at home beside its neighbours?

## 6. Commit only your folder

```bash
git checkout -b add-wooden-spoon
```

```bash
git add assets/YOUR-HANDLE/wooden-spoon/v1
```

```bash
git commit -m "Add YOUR-HANDLE/wooden-spoon@1"
```

```bash
git push -u origin add-wooden-spoon
```

One pull request adds one or more asset or composition folders and **nothing else**. A pull request
that also changes other files fails and asks you to split it. Don't commit `previews/`; it is
ignored on purpose.

## 7. Open the pull request

1. Open your fork on GitHub. A banner offers **Compare & pull request**; click it. (Or go to
   https://github.com/Propcommons/propcommons/pulls, click **New pull request**, then
   **compare across forks**, and choose your fork and branch.)
2. Check the base is `Propcommons/propcommons`, branch `main`.
3. Fill in the template: one line per asset, and how you made it.
4. **Sign off.** Read the statement at the bottom. If it is true, tick its box yourself. Don't
   change its wording; the check compares it word for word. An agent may prepare a pull request but
   must never tick this box for you.
5. Click **Create pull request**.

## 8. What happens next

- **The checks run.** On your first pull request a maintainer approves the run first. The check
  uses the validator from the main branch, never the copy in your pull request.
- **Read the result** under the pull request's **Checks** tab, in the run's summary. The full
  result and the preview images are attached to the run as `validation-results`. If it fails, fix
  the folder, commit and push again; the check reruns. If you only forgot the sign-off, editing the
  description reruns it too.
- **A maintainer reviews** the previews for the four points in step 5 and the content policy, then
  merges.
- **It goes live.** After the merge the site rebuilds, and your asset appears on it within a few
  minutes, with your credit.

## New versions and derived assets

- **A merged version never changes.** To improve your asset, copy its latest folder to the next
  number (`v2`), edit that copy, and set `"version": 2` in its `asset.json`. Version numbers go up
  by one; don't skip.
- **You can only add folders under your own handle.** To build on someone else's asset, make it
  under your own ID and set `"parent": "theirhandle/their-asset@1"` in your `asset.json`. Their
  credit stays in the chain.

## Compositions

A composition places pinned asset versions in one scene; it holds no geometry of its own. Put a
`composition.json` in `compositions/YOUR-HANDLE/<slug>/v1/`; the spec's Compositions section has a
full example. Each item gives an `asset` (like `mattashes/apple-red@1`), a `position` in metres, a
`rotation` as a quaternion `[x, y, z, w]`, and an optional `scale` (keep it between 0.5 and 2). The
whole scene rests on y = 0 with its footprint centred. Validate it the same way:

```bash
npx propcommons validate compositions/YOUR-HANDLE/<slug>/v1
```

See `compositions/mattashes/fruit-bowl/v1/composition.json` for a working one.

## Rules that can't be broken

- CC0 1.0 only, and the sign-off is made by a person.
- Nothing from the content policy's list.
- Only your own handle's folders, and never a change to a merged version.
- Assets are data: a `.glb` and a JSON file. Never add scripts, Blender files or add-ons. Link
  your source files with `source_url` instead.

## Changing the tools or the spec

Code changes go in their own pull request, separate from assets. Run `npm run check` (lint,
typecheck and every test) before you open it; [AGENTS.md](AGENTS.md) explains how the code is
organised. To propose a change to a rule or a budget, open an issue first; see
[GOVERNANCE.md](GOVERNANCE.md).

## Getting help

Open an issue: **Request an asset** to suggest something for the Wanted list, or **Report a
problem** for anything that looks wrong. For security or conduct problems, use private reporting as
described in [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
