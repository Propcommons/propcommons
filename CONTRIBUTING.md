# Contributing to Prop Commons

This guide takes you from nothing to an open pull request that adds one asset. There are two paths:
**with a coding agent** (Claude Code or any agent that speaks MCP) and **by hand**. Both use the
same validator, and both end with you, a person, confirming the sign-off.

Everything you contribute is released under **CC0 1.0** (public domain). Read the
[content policy](CONTENT_POLICY.md) before you start: no real brands, logos, recognisable
characters or likenesses of real people, and you must have the right to release every part of the
asset, textures and AI output included.

Plan on an hour or two for your first one, most of it installing tools. After that, an asset takes
as long as the modelling does.

## 1. Set up your computer (once)

You need four things. Each step says how to check it worked.

1. **A GitHub account**: sign up at https://github.com if you don't have one.
2. **git**: run `git --version` in a terminal. On macOS, if it isn't installed, that command offers
   to install Apple's Command Line Tools, a large download that can take 10–30 minutes. Say yes and
   let it finish.
3. **Node.js 26.13 or later**: install the LTS version from https://nodejs.org, then check that
   `node --version` prints v26.13.0 or higher.
4. **The GitHub CLI** (`gh`), which signs git in to GitHub for you: install it from
   https://cli.github.com, then run:

   ```bash
   gh auth login
   ```

   Choose **GitHub.com**, then **HTTPS**, answer **Yes** to "Authenticate Git with your GitHub
   credentials", and sign in with your browser. GitHub no longer accepts your password for pushing
   code, so this step matters.

Then tell git your name and email, once. Use the private "noreply" address GitHub gives you, so
your real email doesn't become public: find it at https://github.com/settings/emails (it looks like
`12345678+yourname@users.noreply.github.com`).

```bash
git config --global user.name "Your Name"
```

```bash
git config --global user.email "12345678+yourname@users.noreply.github.com"
```

If you model in **Blender**, install it from https://www.blender.org. The export script is tested
with Blender 5.3; older versions may work.

## 2. Get your own copy of the project

1. Make your own copy (a "fork") on GitHub and download it, in one command:

   ```bash
   gh repo fork Propcommons/propcommons --clone
   ```

   ```bash
   cd propcommons
   ```

   Your fork is where you push your work. The original project is set up as `upstream`.

2. Install the project's tools (about a minute):

   ```bash
   npm ci
   ```

   It may print warnings about "install scripts" or funding. Ignore them, and **don't** run any
   `npm audit fix` command it suggests: that changes project files, and your pull request would
   then be refused.

3. Optional, for preview images: install the headless browser the renderer uses (about 200 MB).

   ```bash
   npx playwright install --only-shell chromium
   ```

4. Check it works:

   ```bash
   npx propcommons help
   ```

   `npx propcommons` works inside this `propcommons` folder (and its subfolders), after `npm ci`.

## 3. Pick something to make

- The [Wanted page](https://propcommons.github.io/propcommons/wanted/) lists what the kit needs.
  Each entry has a **Claim it** link: use it, so two people don't make the same thing, and check
  **See who's on it** first.
- Check the [library](https://propcommons.github.io/propcommons/) so you don't duplicate an asset.
  To improve an existing one, see [New versions](#new-versions-and-derived-assets) below.
- Something not on the list is welcome too. Open a **Request an asset** issue first if you'd like
  to let others know you're making it.
- Keep to the spec's scope: one static, realistic object between about 1 cm and 4 m, at real-world
  size.

Choose an **ID**: your GitHub handle in lower case, a slash, and a short name using lower-case
letters, digits and hyphens, for example `yourname/wooden-spoon`. A Wanted entry's ID
(`wooden-spoon`) is the part after the slash.

Choose a **size class** from the object's longest side:

| Size class | Longest side        | Max triangles | Max texture size | Max materials | Max file size |
| ---------- | ------------------- | ------------- | ---------------- | ------------- | ------------- |
| `small`    | 1 cm to 30 cm       | 5,000         | 1024 px          | 2             | 5 MB          |
| `medium`   | over 30 cm to 1.2 m | 15,000        | 2048 px          | 3             | 10 MB         |
| `large`    | over 1.2 m to 4 m   | 40,000        | 2048 px          | 4             | 10 MB         |

The limits are strict. An object right on a boundary (a 30 cm spoon) can come out a few
millimetres over once it is modelled; keep a little margin, or use the larger class. Fine surface
detail belongs in the normal map, not in extra triangles.

## 4a. With a coding agent

The repository includes a local MCP server with six tools: `get_spec`, `init_asset`, `validate`,
`render_preview`, `search_assets` and `submit`. [AGENTS.md](AGENTS.md) has the setup for any
client. With Claude Code, run this once in the `propcommons` folder:

```bash
claude mcp add propcommons -- node packages/mcp/src/main.ts
```

Then ask your agent something like:

> Using the propcommons MCP tools, make a small asset `yourname/wooden-spoon`: a plain wooden
> spoon about 28 cm long. Read the spec first, validate until it passes, show me the previews,
> then show me the sign-off statement before you submit.

What to expect:

- **The agent reads the spec and creates the folder.** Because an AI is making it, the manifest
  must say so: `ai_assisted: true`, with the agent listed in `tools`. `init_asset` asks for both.
- **It makes the model.** If you have Blender, it can build the object there and export it with
  `tools/blender/export_asset.py`. Without Blender, it can write a small script that builds the
  mesh with the `@gltf-transform/core` library that `npm ci` installed, as
  `tools/seed/build.ts` does for the seed assets. The script doesn't go in your pull request; if you
  want to share it, publish it somewhere (a GitHub gist works) and put the link in `source_url`.
- **It runs `validate` until it passes.** Each failure names a rule and says how to fix it.
- **It renders previews. Look at them yourself:** they are saved in
  `previews/yourname/<asset>/v1/`. Is it the right size next to the scale cube, is it resting the
  way it would on a table, are the colours right, and does it sit well beside its neighbours?
- **The sign-off.** Before `submit`, the agent must show you the sign-off statement word for word.
  If it is true and you say yes, that yes is your sign-off: `submit` ticks the box in the pull
  request for you. If it isn't true, say no.
- **`submit`** opens the pull request with your `gh` login (step 1.4). It only accepts folders
  under your own handle. Without `gh`, it prints the same steps as sections 6 and 7 below.

## 4b. By hand

### Create the folder

```bash
npx propcommons init yourname/wooden-spoon --name "Wooden spoon" --size-class small --tags kitchen,utensil,wood
```

This creates `assets/yourname/wooden-spoon/v1/` with an `asset.json` and a **placeholder**
`model.glb` (a 10 cm box). You replace the model next. If an AI tool helped, add `--ai-assisted`;
to list your tools, add `--tools "Blender,Substance Painter"`. You can also edit both in
`asset.json` later.

### Make the model

Whatever tool you use, the result must be:

- **In metres, at real-world size.** A 28 cm spoon is 0.28 units long.
- **+Y up, front facing +Z** (the glTF standard; exporters convert for you). For a long object
  with no obvious front (a spoon, a knife), lay it along the X axis.
- **Standing on the ground**: its lowest point at height 0, and its footprint centred on the origin.
- **One object**: one root node, with every transform applied (no scale other than 1).
- **Triangles with normals**, UVs on anything textured, and **no vertex colours**.
- **Colours from image textures or plain values.** PNG or JPEG textures whose sides are powers of
  two (256, 512, 1024...), embedded in the file. Colours built from texture nodes (noise, colour
  ramps, procedural wood) **don't export**: bake them to an image first, or use a plain colour.
- **A plain material.** In Blender's Principled BSDF, leave Coat, Sheen, Anisotropic, Thin Film and
  Specular at their defaults, and Emission Strength at 1 or below: those settings export as glTF
  extensions this spec doesn't allow. For a shiny glaze, lower Roughness instead of adding Coat.
- **Plain glTF**: no Draco or Meshopt compression, no KTX2 or WebP textures. The only extensions
  allowed are the three glass ones: `KHR_materials_transmission`, `KHR_materials_volume` and
  `KHR_materials_ior`.
- **Static**: no cameras, lights, animation, armatures or shape keys.
- **Resting naturally.** It should lie the way it would on a table. If it rests on two or more
  points (a spoon on its bowl and the end of its handle), rotate it onto them; moving the lowest
  point down isn't enough.

#### Glass

The three allowed extensions exist so glass can look like glass. In Blender, use the Principled
BSDF's Transmission Weight (1 for clear glass) and IOR (about 1.5); give the glass real wall
thickness, keep Alpha at 1 (don't use transparency or "Blend"), keep Roughness low, and set Base
Color to the glass's tint. In an engine without glass support, that Base Color is what people
see, so a pale tint (not pure white) still reads as a bowl or bottle. The previews include a
`fallback.png` showing exactly that. Godot's own importer is one such engine; the runtime loader
`tools/godot/prop_commons.gd` approximates the glass with transparency instead.

### Export from Blender

1. **Put your object in a collection named `Asset`.** In Blender's Outliner (top right),
   right-click the scene collection, choose **New Collection**, double-click it and rename it to
   `Asset`. Select your object (or all the parts that make it up), press **M** in the 3D view and
   choose `Asset`.
2. **Optional collision shapes:** up to 8 simple convex shapes of at most 64 vertices each, in a
   collection named `collision`. Leave them out if 8 hulls can't follow the shape closely (a deep
   bowl, for example).
3. **Save the .blend file.**
4. **Run the export script from the `propcommons` folder.** On macOS, Blender's command is inside
   the app. Type the start of the command below, then drag Blender.app from Finder into the
   terminal and add `/Contents/MacOS/Blender` to get its full path:

   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender --background path/to/your.blend --python tools/blender/export_asset.py -- --collection Asset --out assets/yourname/wooden-spoon/v1
   ```

   On Windows and Linux, `blender` is usually enough as the first word. The lone `--` matters: it
   tells Blender that the options after it are for the script.

The script works on copies and never changes or saves your .blend. It applies modifiers and
transforms, joins and triangulates the parts, puts the lowest point on the ground and centres the
footprint, removes vertex colours, and writes `model.glb` (and `collision.glb` if you made one). It
warns, and lists again at the end, any material setting that won't export as it looks
(node-based colours, Coat, Sheen and the like). Fix those in Blender and export again. Lines like "Draco is available"
are Blender saying what it could do; the script doesn't use compression.

**Other tools:** export a binary glTF (`.glb`) to `assets/yourname/wooden-spoon/v1/model.glb`
with compression off, textures embedded, and no cameras, lights or animation.

### Fill in asset.json

Open `assets/yourname/wooden-spoon/v1/asset.json` in a text editor and check every field:

| Field                   | What to put                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | Display name in English, up to 80 characters                                                                                                                    |
| `size_class`            | `small`, `medium` or `large`                                                                                                                                    |
| `tags`                  | 1 to 10 lower-case tags, e.g. `["kitchen", "utensil"]`                                                                                                          |
| `credits`               | Everyone who worked on it: `{ "github": "handle", "roles": [...] }` or `{ "name": "Full Name", "roles": [...] }`. Roles are listed below                        |
| `ai_assisted`           | `true` if any AI tool made or changed any part of it, otherwise `false`                                                                                         |
| `tools`                 | Software and AI models used, e.g. `["Blender", "Substance Painter"]`                                                                                            |
| `source_url` (optional) | A link to your source files or generator script, if you published them                                                                                          |
| `notes_url` (optional)  | A link to a write-up of how you made it                                                                                                                         |
| `wikidata` (optional)   | The Wikidata ID of the kind of object: search https://www.wikidata.org and copy the `Q` number from the item page, e.g. `Q89` for apple. Leave it out if unsure |

Credit roles: `directed` (decided what to make and guided it, including directing an AI),
`modeled` (built the mesh), `sculpted` (sculpted high detail), `textured` (made the textures),
`coded` (wrote a script that generates it), `scanned` (captured it with photogrammetry or a
scanner). List every role that applies. If an AI made it under your direction, you `directed` it; `coded`
is for writing a generator script yourself.

Leave `spec`, `id`, `version` and `license` as `init` wrote them.

## 5. Validate and look at it

```bash
npx propcommons validate assets/yourname/wooden-spoon/v1
```

It prints `PASS` or `FAIL`. `PASS` means the file is well-formed, not that it looks right; the
previews below are the real check. Every problem has a rule ID, what was measured, the limit, and a
`fix:` line saying what to do. Fix them and run it again until it passes. Warnings don't block a
pull request, but a reviewer will ask about them. If it says the model is still the placeholder
box, your export went somewhere else. Add `--json` to get the full result as JSON.

Then render the previews a reviewer will see (needs the browser from step 2.3):

```bash
npx propcommons preview assets/yourname/wooden-spoon/v1
```

The images land in `previews/yourname/wooden-spoon/v1/`: front, side and top beside a scale
cube (10 cm for small assets, 1 m otherwise), `kit.png` beside up to two existing assets of the same size class, and `thumb.png`, a
close-up of the asset alone for checking small details. If you used the glass extensions,
`fallback.png` shows how it looks in an engine that doesn't support them. Check the things the validator can't:

1. **Proportions**: is it the right size next to the cube?
2. **Pose and facing**: does it rest the way it would on a table, front towards you?
3. **Colours and normal map**: are the colours right (not plain white or grey), and do bumps look
   like bumps, not dents?
4. **Graceful fallback**: if you used a glass extension, would it still be recognisable without it?
5. **Fit with the kit**: does it look at home beside its neighbours?

## 6. Commit only your folder

```bash
git checkout -b add-wooden-spoon
```

```bash
git add assets/yourname/wooden-spoon/v1
```

```bash
git commit -m "Add yourname/wooden-spoon@1"
```

```bash
git push -u origin add-wooden-spoon
```

Before you push, you can run the same check GitHub will on your commits (the sign-off is assumed
ticked here; GitHub checks your real description):

```bash
npx propcommons check-pr --against upstream/main
```

One pull request adds one or more asset or composition folders and **nothing else**. If you
changed any other file by accident, the check lists it and tells you how to put it back. Don't
commit `previews/`; it is ignored on purpose. If `git commit` asks who you are, or `git push` asks
for a password, go back to step 1.

## 7. Open the pull request

1. Open your fork on GitHub. A banner offers **Compare & pull request**; click it. (Or run
   `gh pr create --web` in the terminal, which opens the same page.)
2. Check the base is `Propcommons/propcommons`, branch `main`.
3. Fill in the template: one line per asset, and how you made it.
4. **Sign off.** At the bottom is the sign-off statement. On this page it is plain text starting
   with `- [ ]`. If the statement is true, **type an `x` between the brackets** so it reads
   `- [x]`. Don't change any other words. (You can also create the pull request first and then
   click the box on the pull request's page.)
5. Click **Create pull request**.

## 8. What happens next

- **The checks run.** On your first pull request a maintainer approves the run first. The check
  uses the validator from the main branch, never the copy in your pull request.
- **Read the result** under the pull request's **Checks** tab, in the run's summary. To see the
  preview images, download `validation-results` from the run's summary page (you need to be signed
  in) and unzip it. If it fails, fix the folder, commit and push again; the check reruns. If you
  only forgot the sign-off, ticking the box reruns it too.
- **A maintainer reviews** the previews for the five points in step 5 and the content policy, then
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
`composition.json` in `compositions/yourname/<slug>/v1/`; the spec's Compositions section has a
full example. Each item gives an `asset` (like `mattashes/apple-red@1`), a `position` in metres, a
`rotation` as a quaternion `[x, y, z, w]`, and an optional `scale` (keep it between 0.5 and 2). The
whole scene rests on y = 0 with its footprint centred: the validator places every item and checks
both (CMP-GROUND, CMP-CENTER), and tells you how far to move everything if not. Validate it the
same way:

```bash
npx propcommons validate compositions/yourname/<slug>/v1
```

See `compositions/mattashes/fruit-bowl/v1/composition.json` for a working one.

**Placing things so they rest.** An asset's origin is the centre of its footprint at ground level,
so an item standing on a surface at height `h` gets `position[1] = h`. For anything stacked, in a
bowl or in a heap, let the tool find the heights: choose each item's x, z and rotation, give it a
rough height (higher for what should end up on top), and run

```bash
npx propcommons settle compositions/yourname/<slug>/v1
```

It drops every item straight down, bottom of the pile first, until it rests on the ground or on
what's under it, centres the scene, and rewrites `composition.json` (`--dry-run` only shows what
would change). It takes seconds and needs no physics, but nothing rolls or slides: an item stays
where you put it in x and z, at the rotation you gave it. For a natural tumbled heap, run a physics
drop in Blender instead and copy the settled positions and rotations. For a drop: use the
models' real shapes for hollow things (a bowl), give the falling items their own pivot at their
centre (an asset's origin is at its base, not its centre of mass), and expect small objects to need
a smaller collision margin than Blender's default. Running `settle` afterwards closes the small
gap the collision margin leaves. A `scale` between about 0.85 and 1.1 is fine for
natural variation (no two strawberries are the same size).

**Check it before you push:**

```bash
npx propcommons preview compositions/yourname/<slug>/v1
```

It renders the scene to `previews/compositions/…/scene.png` and warns if something looks like it's
floating or sunk into what's under it. The validator only checks the scene as a whole, not how the
items sit on each other, so look at the picture too.

**Orientation of the parts:** most assets face +Z; long objects with no front lie along X. When it
matters which end is which, look at the asset's previews or its measured size in `index.json`.

## Rules that can't be broken

- CC0 1.0 only, and the sign-off is confirmed by a person.
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
