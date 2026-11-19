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

## CI

- **The assets workflow's logic lives in `tools/ci/assets-pr.sh`**, run from the base checkout, so
  the same steps can be tested locally (`test/ci.test.ts` simulates a fork pull request with real
  git repositories, including one that edits the validator to always pass).
- **The changed-file list comes from git** (`git diff --name-status` between the base commit and
  the head), not from the GitHub API, so the job needs no token beyond read-only checkout.
- **Mixed pull requests** trigger both workflows: assets-pr fails with a message asking for a split,
  and code CI runs the tests. A code-only pull request does not trigger assets-pr.
- **Code CI runs a code pull request's own tests.** That is unavoidable for code review; the job
  has no secrets and a read-only token. GitHub's "Require approval for all outside collaborators"
  setting should be on so a maintainer approves each run from a new contributor.
- **assets-pr also runs when the description is edited**, so ticking the sign-off box re-runs it.
- **Symbolic links anywhere in a pull request fail the asset check.** They are never followed.

## Previews

- **The HDRI is generated, not downloaded.** `tools/hdri/build.ts` writes a 256 × 128 studio
  environment (soft dome, one key light, one fill, darker ground). It is CC0 because the project
  made it, and its source is that script (`packages/preview/scene/SOURCES.md`).
- **Views.** All three are perspective (30° field of view) and framed to the bounding sphere of the
  asset plus the scale cube, with a 1.2 margin: three-quarter front (35° round from the front, 22°
  up), side (from +X, 6° up) and top (straight down, front at the bottom). The scale cube sits to
  the camera's right of the asset in each view.
- **Kit view.** Up to two other assets with the same size class, using each one's latest live
  version, chosen by most shared tags and then by ID, are placed in a row with the new asset in the
  middle, viewed from the three-quarter front.
- **Rendering.** Headless Chromium with SwiftShader (no GPU), 1024 × 1024, pixel ratio 1,
  antialiasing on, neutral tone mapping. Images are read from the canvas, so window chrome never
  appears. The page loads only files the renderer serves it; every other request is refused.
- **In CI**, previews are rendered for each added asset whose file passes the file checks, and are
  uploaded with the results. A rendering failure is logged but does not fail the check; the rules
  decide pass or fail.

## Site

- **Pages are built as static HTML** by `packages/site/src/build.ts`, with every manifest value
  escaped. Links from manifests (`source_url`, `notes_url`) are rendered only when they start with
  `https://`; anything else is shown as plain text.
- **Content security policy** on every page: scripts only from the site itself, plus the Three.js
  import map allowed by its hash. No analytics, fonts or other third-party requests.
- **Vendored viewers.** `<model-viewer>` is the pinned package's standalone bundle (it carries its
  own Three.js). The composition viewer uses the same pinned Three.js as the preview renderer and
  the same `stage.js`, so a composition looks like its previews.
- **The gallery shows the latest live version of each asset.** Every version, including taken-down
  ones, has its own page.
- **Previews are cached locally** under `previews/` (ignored by git) with a key over the model hash,
  its tags and the hashes of same-class assets, since the kit view depends on its neighbours. In CI
  they are rendered fresh on every deploy.
- **The base path** comes from `project.config.json` (`site.basePath`), and can be overridden with
  `--base` or `SITE_BASE`.
- **Deploy runs only on pushes to `main`** (no manual trigger), and only its deploy job has write
  permission.

## Seed content

- **Five seed assets instead of three.** The maintainer asked for five (cutting board, bowl, apple,
  lemon, kitchen knife) and one composition that combines all of them. They are generated by
  `tools/seed/build.ts`, which is deterministic; a test regenerates them and compares bytes.
- **Seed credits** name the maintainer with the roles `directed` and `coded`, `ai_assisted` is
  `true` (the generator was written with an AI model), and `source_url` points at the generator.
- **Resting positions in the composition are computed**, not guessed: each fruit is lowered until
  its mesh first touches the bowl's inner surface (plus 0.3 mm), which is what a physics drop
  would give for a first contact.
- **Repository tooling never reformats contributed content.** Biome ignores `assets/` and
  `compositions/`.

## Import smoke tests

- **Three.js runs in CI; Blender and Godot run where installed.** `test/smoke.test.ts` loads every
  seed asset in all three and compares sizes with the validator's within 1 mm. Blender and Godot
  are found on the machine (or through `BLENDER` and `GODOT`) and skipped when absent; CI does not
  install them, so for CI they are manual steps. Last run with all three: Blender 5.3.0 and
  Godot 4.7.2 on macOS, 18 November 2026.
- **Godot reads geometry from its glTF importer state**, not from a generated scene, and skips
  textures: headless Godot has no real renderer, keeps no mesh data and can crash on textures.
- **Engines only ever see copies** of the models, in a scratch folder, because importers may write
  extracted textures next to the file they import.
- **The Blender export script is tested** by building a messy scene with
  `tools/blender/make_test_scene.py` (unapplied scale and rotation, off-centre and floating,
  live modifiers, vertex colours, a texture, a collision hull, a camera and a light), exporting it,
  and validating the result with no edits.

## Takedowns and the site

- **A takedown never blocks a deploy.** The site build publishes merged content that no longer
  passes (for example a composition pinning a taken-down asset) with `pass: false` in
  `index.json` and lists it in the build log; `propcommons build-index` on its own still exits 1.
  The composition viewer leaves taken-down items out and says how many.
- **The Godot composition check is manual.** `tools/smoke/godot_composition.sh` copies the
  assets into a throwaway Godot project, lets Godot's own importer import them (the way game
  developers use glTF files), then loads a composition, renders it with textures and prints each
  item's bounds. It needs a window, so it is not in CI. Last run: Godot 4.7.2 on macOS,
  18 November 2026, fruit-bowl composition; every item's bounds matched the web viewer's.
  Loading `.glb` files at runtime with `GLTFDocument` from a bare script returned unfinished
  `ImporterMeshInstance3D` nodes and crashed when extracting textures, so the check uses the
  editor's import path instead.
- **Runtime loading in Godot uses `tools/godot/prop_commons.gd`.** It loads `.glb` files with
  `GLTFDocument`, keeps textures in memory (`HANDLE_BINARY_EMBED_AS_UNCOMPRESSED`; the default
  extraction only works inside the editor's import pipeline), and converts any
  `ImporterMeshInstance3D` nodes to `MeshInstance3D`, which `GLTFDocument` returns when the editor
  hint is set (tool scripts, editor plugins, `godot --script` outside a project). It also places
  compositions. `tools/smoke/godot_runtime.sh` tests it from a real game run (`check`), from editor
  mode (`check-editor`), and renders a composition (`render`); the first two run in
  `test/smoke.test.ts` wherever Godot is installed.

## Contributor experience (after the first newcomer test, 18 November 2026)

- **The sign-off can be confirmed through an agent.** The brief's `submit` design treats the
  person's explicit yes in chat as the sign-off, with the template and the reviewer as backstop.
  The docs now say the same: tick it yourself, or confirm it to your agent, which ticks it for you.
- **PR-SIGNOFF ignores line wrapping** and says whether the statement is missing or only
  unticked. Its message became a template (`{detail}`); the rule ID and level are unchanged.
- **init's placeholder model is caught without a new rule.** Adding a rule ID is a spec change, so
  instead `propcommons validate` prints a note, the MCP `validate` adds a second message (its JSON
  stays identical to the CLI's), `submit` refuses, and `check-pr` fails the pull request with a
  problem message when a model's SHA-256 matches `template/model.glb`. A future spec version could
  make this a rule.
- **A mixed pull request names the files** outside `assets/` and `compositions/` and says how to
  put them back.
- **SIZE-CLASS adds a hint when the model is within 5% of the edge** of its declared class.
- **MCP `init_asset` requires `ai_assisted` and `tools`**, so agent-made assets declare it.
- **`submit` refuses a folder under a handle other than the `gh` login**, fills in "How it was
  made" from the manifest, and pushes with gh's credentials for that one command instead of
  changing the user's global git configuration.
- **The MCP server finds its own clone** from its file location, so clients that start servers
  from another folder work; `--root` and `PROPCOMMONS_ROOT` still override it.
- **`.npmrc` turns off npm's audit and funding messages and enforces the Node version** from
  `package.json`, so `npm ci` doesn't suggest `npm audit fix` and an old Node fails with a clear
  message.
- **Gallery cards use a fifth, site-only preview image** (`thumb.png`, the asset alone). The four
  review images keep the scale cube the spec asks for; CI still renders only those four.
- **Claiming a Wanted entry is a GitHub issue** from the "Claim a wanted asset" form, labelled
  `claim`. The site links to it and to a search for the entry's ID; it makes no requests to GitHub
  itself.
- **The spec page is rendered from SPEC.md** with `marked` (pinned) at build time; the raw `.md`
  stays alongside for agents.

## Site design (18 November 2026)

- **Compositions get a rendered image** (`previews/compositions/<author>/<slug>/vN/scene.png`,
  listed as `preview` in index.json), made with the same reference scene as asset previews. It is
  the home page's hero image and each composition's card.
- **Composition images and the 3D viewer frame the scene's corners**, not its bounding sphere, so
  wide, flat scenes fill the frame. Asset review previews keep the spec's framing.
- **The home page leads with the promise and the proof**: the headline, the featured composition
  image, three "how it works" points, then the library, compositions and the next Wanted items.
- **Asset pages put download and facts in a side panel** and add "Use it" snippets for Godot,
  Three.js and Blender, with copy buttons. Sizes are shown in centimetres (metres above 1 m).
- **Still no web fonts, framework or third-party requests**: system fonts, one stylesheet with
  colour tokens for light and dark, and the same content security policy.

## After the second newcomer test (18 November 2026)

- **`submit` carries the contributor's git name and email** (from their clone, global or local)
  into the commit it makes in a fresh clone, and refuses before forking when they aren't set.
- **The Blender export script warns about material settings** that export as glTF extensions this
  spec doesn't allow (Coat, Sheen, Anisotropic, Thin Film, Specular level and tint, Emission
  Strength above 1), names the setting to change, and repeats every warning in a summary at the
  end. The FILE-EXT hint now says that material settings, not exporter options, usually cause it.
- **MCP `render_preview` saves the images** in `previews/<author>/<slug>/v<N>/`, like the CLI, so
  the person can look at them.
- **The author's default credit role is `directed` when `ai_assisted` is true**, `modeled`
  otherwise; `init_asset` takes an optional `roles`.
- **"Merged" for `search_assets` prefers `upstream/main`**, since `gh repo fork --clone` makes the
  fork `origin`.
- **A `work/` folder is ignored by git**, for generator scripts that need the project's packages.
  The seed generator's shape helpers moved to `tools/lib/mesh.ts`.
- **PR-SIGNOFF's wording in SPEC.md** now says the statement must be ticked, which is what the
  check has always required. The rule ID and level are unchanged.
- **`packages/mcp/src/main.ts` is committed as executable**, so `npm ci` no longer shows it as
  changed in a fresh clone.

## After the v0 gate rehearsal's contributors (18–19 November 2026)

- **Every preview set includes `thumb.png`**, a close-up of the asset alone, so small assets (a
  3 cm strawberry) can be judged. The four review images are unchanged.
- **Assets that use extensions also get `fallback.png`**: the same close-up with every extension
  removed, as an engine that ignores them shows it, so reviewers can judge the spec's "graceful
  fallback" guidance.
- **`propcommons check-pr --against <branch>`** runs GitHub's pull-request check on the current
  branch's commits locally, with the base taken from that branch (default `upstream/main`). The
  sign-off is assumed ticked unless `--body-file` is given.
- **`template/model.glb` names its default scene** (`scene: 0`). The seed assets don't, and
  can't change, because merged versions are frozen; it is only a warning in Godot.
- **Docs** now cover glass materials and their fallback, resting objects on several contact
  points, leaving out collision when 8 hulls can't follow a hollow shape, non-square textures,
  credit roles for AI-made assets, and assets not on the Wanted list.
- **`propcommons preview` accepts a composition folder.** It renders the scene and gives advice,
  not rule results, on the spec's composition frame (rests on y = 0, footprint centred) and on
  items that look like they float or go below the ground, using bounding boxes. Turning these
  into rules is a spec change, proposed for the maintainer to decide.
- **Wanted entries hide themselves** on the site and in `search_assets` once any live asset uses
  that slug, until a maintainer removes them from `wanted.json`.
- **The gate check's Blender picture uses Cycles** (64 samples, denoised), because EEVEE shows
  glTF glass as milky.

## Composition frame rules (19 November 2026)

The maintainer approved two new rules after the rehearsal showed a composition could float a metre
up and still pass.

- **CMP-GROUND (error):** with every item placed, the scene's lowest vertex is at y = 0 within
  `tolerances.length_m` (1 mm), as ORIGIN-Y is for an asset.
- **CMP-CENTER (error):** the centre of the scene's XZ footprint is within
  `origin.centerFraction` (25%) of the footprint's longer side from the origin, the same measure as
  ORIGIN-CENTER. It is an error here, not a warning, because a scene has no reason to be off-centre.
- **How they measure:** each pinned asset's `model.glb` vertices (in world space within the asset),
  placed by the item's position, rotation (normalised) and scale. Vertices, not bounding boxes, so
  rotated items measure exactly. Each asset is read once however many items use it.
- **When they run:** only when the composition has no other error, so every pinned asset is live
  and the placements are well-formed. A model that can't be read (or is a link, or over the file
  size limit) skips both rules; that asset fails its own validation anyway.
- **This widens what the validator reads** for a composition from "does this version exist" to the
  pinned models themselves, inside `assets/` of the same repository.
- **Spec version stays 0.1.** No schema changes; the only existing compositions (the seed fruit
  bowl and the rehearsal scene) pass both rules.
- **Items floating or sinking into each other stay advice** in `propcommons preview`, not rules:
  telling resting contact from a deliberate gap needs more than bounding boxes.

## `propcommons settle` (19 November 2026)

- **A straight drop, not physics.** Each item keeps its x, z, rotation and scale; only its height
  changes. That is what "lower each item until it touches" asked people to do by hand, and it runs
  in seconds where the rehearsal's Blender drop took 8.5 minutes (and a 14-item one never finished).
- **Contact** is found with vertical rays: from the falling item's vertices down onto what is
  placed, and from placed vertices up onto the falling item. Points every millimetre along long
  edges catch edge-on-edge contacts (two boxes at an angle), which vertices alone miss.
- **Order:** an item settles before any item that sits above it where they overlap, judged at the
  heights given; otherwise lowest point first. Ordering by list position or by middle height both
  failed on the rehearsal scene (a strawberry tucked under another; a bowl taller than its fruit).
- **On the rehearsal scene** it puts every strawberry within 0.21 mm below where Blender's physics
  left it (Blender's collision margin).
- **Lowered from the given height, not dropped from above everything** (changed 19 November):
  surfaces above an item's given position don't catch it, except within 2 cm (for heights given a
  little low). Dropping from above put a toolbox meant for a bench's low shelf on the bench top, and
  a chair tucked under a table onto the table, whenever the furniture settled first. Order now also
  puts an item after one that most of its base is over (a box after the shelf it sits on, though
  the bench top is above the box); otherwise the earlier rule decides, so every published scene
  settles exactly as before.
- **It centres the footprint** too (CMP-CENTER), unless `--no-center`. It is a command-line tool
  only; the MCP server's six tools are unchanged, and agents run it from the shell.

## Glass in Godot (19 November 2026)

- **`tools/godot/prop_commons.gd` approximates KHR_materials_transmission**, which Godot 4.7's glTF
  importer ignores: alpha blending with the material's alpha scaled down to 12% at full
  transmission, back faces drawn, and a quarter-strength KHR_materials_volume tint. In the gate
  check's Godot picture the strawberries now show through the bowl.
- **No refraction.** Godot's screen-space refraction gave an opaque, dark bowl in the gate check's
  render, and the full attenuation colour made it dark teal; both were dropped.
- **The editor gets it too, as an opt-in plugin.** `tools/godot/addons/prop_commons` registers a
  GLTFDocumentExtension that runs the same function after parsing, so a `.glb` dropped into a
  project imports with see-through glass. Without the plugin Godot shows the opaque fallback, as
  the spec allows. A test keeps the plugin's copy of the function identical to the loader's, so
  each file still works on its own.

## Previews and MCP input (19 November 2026)

- **Preview cameras fit the box's corners**, not its bounding sphere, so long thin assets fill the
  frame: the asset (and scale cube) fill 86% of the frame in the four views, 90% in the close-up
  and 88% in the kit view. Testers couldn't judge a spoon's 3-pixel details before.
- **MCP tool inputs are strict.** An unknown argument name (`query` for `text`) is now an error
  that names it; it used to be dropped silently, returning unfiltered results.

## Testing period: the maintainer works alone (19 November 2026)

- **The v0 gate is run by the maintainer and agents, not three outside contributors.** The project
  goes to outside people only once it is an app; until then every contribution is the maintainer's
  (mattashes) with an AI agent doing the making.
- **Standing sign-off.** For assets and compositions an agent makes under `mattashes` during
  testing, the maintainer has given a standing yes to the sign-off statement, so the agent ticks the
  box and merges once the checks pass. The rule in AGENTS.md (a person's explicit yes for each
  contribution) is unchanged for everyone else.
- **The sign-off wording's legal review is deferred** until outside people are invited.
- **No extra GitHub accounts.** The fork pull request path is tested from the maintainer's own
  fork instead.

## The fork path, tested for real (19 November 2026)

- **The MCP `submit` tool was tested end to end from the maintainer's own fork** (PR #8, the
  teaspoon). It found three faults, now fixed:
  - `gh repo fork <repo> --remote=false` is refused by current gh ("the --remote flag is
    unsupported when a repository argument is provided"), so `submit` failed for everyone. It
    now forks through the API (`POST repos/{upstream}/forks`), which also returns the fork's real
    name (it differs when the contributor already has a repository called `propcommons`).
  - It took over a minute, and MCP clients commonly time out at 60 s. The shallow clone downloaded
    every model in the library, and `git commit` downloaded them again to work out the status.
    It now clones without file contents, fills the index from main's tree, stages the one folder
    and commits with `write-tree` and `commit-tree`: about 6 s however big the library is.
  - Any failure was reported as "gh is not available or not signed in". It now names the step
    that failed.
- **Submitting the same folder again updates the open pull request** instead of failing: the
  branch belongs to that asset version, so it is force-pushed and the existing PR is reported.
- **CI browser install**: GitHub's Ubuntu images already have Chrome's system libraries, so CI
  downloads only the browser and checks it starts; apt runs only if it doesn't (stalled apt
  mirrors had hung three runs, and a timed-out attempt left apt's lock held).

## Gallery cards (19 November 2026)

- **Cards use a 384 px WebP copy of the close-up** (`card.webp`, written next to `thumb.png` by
  the preview renderer), about 5–10 kB instead of 350–400 kB. With 60 assets the home page's
  gallery would otherwise download about 20 MB as people scroll. The PNG previews are unchanged
  for asset pages and reviewers; `index.json` is unchanged (the card path is the thumbnail's with
  `card.webp` in place of `thumb.png`), and the site falls back to the PNG where there's no card.
- **Deploys keep the previews from the last deploy** (actions/cache, saved only by the deploy
  workflow on main). The builder already re-renders only what changed, but each deploy used to
  start empty and render all 60 assets: 6–9 minutes, growing with the library.

## The Studio (19 November 2026)

- **What the app is**: a scene builder on the site (`/studio/`). Pick props from the library, place
  them in a 3D room, and download the scene as one `.glb` for any engine, or as a
  `composition.json` to publish to the library. The maintainer confirmed this direction.
- **It is a static page**, like the rest of the site: no server, no accounts. Scenes are kept in
  the browser (localStorage); the same Three.js reference scene as the previews and viewers.
- **Props land on what's under them** with the rule `propcommons settle` uses: an item is lowered
  from where it is put (the surface under the pointer, plus 2 cm) until a point on its underside
  meets a surface. For speed it tests about 60 points on the underside (its outline in 24
  directions, a ring further in, and the lowest points), not every vertex.
- **Describe a scene** has no AI call of its own: it writes a prompt listing every prop with its
  size and the placement rules, to paste into any assistant; the Studio builds the reply's JSON
  plan (`asset`, `x`, `z`, `y`, `turn`), lowering each prop onto what's under it. No API key or
  account is needed, and nothing leaves the page.
- **Exports**: the `.glb` holds every placed prop as its own node named after it; the
  composition is centred and resting on y = 0 (CMP-CENTER, CMP-GROUND) on export, credits the
  GitHub username given (or a placeholder to replace), and sets `ai_assisted` to true when
  "Describe a scene" laid any of it out (the scene remembers that), false otherwise.
