// The "Improve it" and "Make a prop" builders: they turn what the person types into a prompt for
// their own AI (or the commands to do it by hand), so whatever they use follows the project's
// rules. Everything here runs in the page; nothing is sent anywhere.

// The project's conventions, in words. The numbers (budgets) come from the page, which reads them
// from spec/budgets.json when the site is built.
const RULES = `How props are built here, so they fit together (AGENTS.md "Making the model" has the full list):
- Metres, +Y up, the front faces +Z. The lowest point sits at y = 0 and the footprint is centred on the origin. One scene, one root node with no transform, every scale 1.
- It rests the way the real thing sits on a table or the floor. A long object with no obvious front lies along X.
- Triangles go into the silhouette; fine detail goes into textures and normal maps. Metal/roughness materials, PNG or JPEG textures with power-of-two sides, no vertex colours, and no lighting or shadows painted into textures (each engine lights it).
- Materials are few, so parts share them through a texture atlas.
- Real-world size and proportions, softened edges, and surfaces that read as what they're made of (grain, brushing, glaze, weave, wear), not flat colours.`;

function setup() {
  return [
    "Get the project, unless you're already in an up-to-date clone of it: check that Node.js 26.13 or later, git and the GitHub CLI are installed and that `gh auth status` shows me signed in (if not, walk me through `gh auth login`). Then run `gh repo fork Propcommons/propcommons --clone` and `cd propcommons`. If my fork already existed it may be old, so bring it up to date with `git pull --ff-only upstream main` before anything else. Then `npm ci` and `npx playwright install --only-shell chromium`.",
    "If `git config user.email` prints nothing, ask me for my name and my GitHub noreply email and set them, as AGENTS.md says.",
    "Read AGENTS.md in the clone and follow it: it's the rulebook and wins over anything in this message.",
    `Use the Prop Commons MCP server if it's already connected (get_spec gives every rule and budget); otherwise use the \`npx propcommons\` commands in the clone, which do the same things (a server you add now usually only works after a restart, so don't stop for that).`,
  ];
}

const finish = [
  "Validate until it passes, and fix every warning too. Then render the preview images and look at them yourself: front, side and top beside the scale cube, and kit.png beside two other props of its size class. Check proportions, resting pose, facing +Z, materials and how it sits next to its neighbours, fix what looks wrong, and show me the images (they're saved under previews/). Passing only means the file is well-formed.",
  "When I'm happy with it, show me the sign-off statement word for word, and only after my yes, submit it as a pull request.",
];

const numbered = (steps) => steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

/** The line for an AI that is already connected: the connector hands it the brief and the steps. */
function line(d, kind, wish) {
  if (kind === "improve")
    return `Use Prop Commons to improve ${d.ref.split("@")[0]}. ${wish ? `What I want better: ${wish}` : "Start with where it falls short."}`;
  return wish
    ? `Use Prop Commons to make a new prop: ${wish}`
    : `Use Prop Commons to make a new prop. Ask me what to make; the Wanted list at ${d.site}wanted/ is a good place to start.`;
}

function improvePrompt(d, wish) {
  return `Help me make a better version of a prop for Prop Commons, an open library of free (CC0) 3D game props at real-world scale that all follow one spec, so they fit together in any scene.

The prop: ${d.name} (${d.ref})
Its page: ${d.page}
What I want better: ${wish || (d.brief.includes("Where it falls short") ? "Make it clearly better, starting with where it falls short (below)." : "Make it clearly better: closer to the real thing in shape, detail and materials.")}

${d.brief}

${RULES}

Please do it end to end on this computer:
${numbered([
  ...setup(),
  `Start from the current model with improve_asset, from "${d.ref}" (command line: \`npx propcommons improve ${d.ref} --ai-assisted --tools "<your model's name>"\`). If the prop is mine, that makes its next version; otherwise it makes a copy under my GitHub handle that links back to the original. \`--tools\` is the full list of tools used for the new model.`,
  `Look at the original first: \`npx propcommons preview ${d.path}\` renders its images into previews/. Tell me in a sentence or two what you'll change. Then build the better model (in Blender if I have it, otherwise with a generator script in work/, as AGENTS.md describes) and replace model.glb in the new folder. Keep its front, its resting pose and roughly its size.`,
  ...finish,
])}`;
}

function newPrompt(d, wish) {
  return `Help me make a new prop for Prop Commons, an open library of free (CC0) 3D game props at real-world scale that all follow one spec, so they fit together in any scene.

What I want: ${wish || `(Ask me what to make. The Wanted list is a good place to start: ${d.site}wanted/)`}

${d.brief}

${RULES}

Please do it end to end on this computer:
${numbered([
  ...setup(),
  `First check the library doesn't have it already (search_assets, or ${d.site}index.json). If something close exists, show me and ask whether to improve that one instead.`,
  'Work out its real-world size and pick its size class (keep clear of the class edges). Pick tags, including the kit it belongs to, and look at a few previews of that kit so the new prop matches their scale and finish. Then start the folder with init_asset under my GitHub handle (command line: `npx propcommons init <my-handle>/<slug> --name "…" --size-class … --tags … --ai-assisted --tools "<your model\'s name>"`).',
  "Build the model at real-world size (in Blender if I have it, otherwise with a generator script in work/, as AGENTS.md describes) and put it at model.glb.",
  ...finish,
])}`;
}

function byHand(d, kind) {
  const start =
    kind === "improve"
      ? `npx propcommons preview ${d.path}    # look at the original first
npx propcommons improve ${d.ref} --tools "Blender"`
      : 'npx propcommons init your-handle/your-prop --name "Your prop" --size-class small --tags kitchen --tools "Blender"';
  const notes = (d.brief || "")
    .split("\n")
    .map((l) => `# ${l}`.trimEnd())
    .join("\n");
  return `${notes}

# Once: get the project (needs Node.js 26.13+, git, and the GitHub CLI signed in)
gh repo fork Propcommons/propcommons --clone
cd propcommons
git pull --ff-only upstream main   # brings an older fork up to date
npm ci
npx playwright install --only-shell chromium

# ${kind === "improve" ? `Start from ${d.name}: a copy of it under your own handle` : "Start the folder"}
${start}

# Model it in Blender, then export with tools/blender/export_asset.py
# (CONTRIBUTING.md has the steps). Then check it and look at the pictures:
npx propcommons validate assets/your-handle/...
npx propcommons preview assets/your-handle/...

# Then open a pull request: CONTRIBUTING.md sections 6 and 7.`;
}

const LABELS = {
  line: "Paste this into your AI:",
  ai: "Paste this into your AI. It is long because it explains the whole project:",
  self: "The commands, in a terminal:",
};

for (const maker of document.querySelectorAll(".maker")) {
  const d = maker.dataset;
  const text = maker.querySelector(".maker-text");
  const out = maker.querySelector(".maker-out");
  const label = maker.querySelector(".maker-out-label");
  const update = () => {
    const how = maker.querySelector("input[type=radio]:checked")?.value ?? "line";
    const wish = text.value.trim().replace(/\s+/g, " ");
    out.textContent =
      how === "self"
        ? byHand(d, d.kind)
        : how === "line"
          ? line(d, d.kind, wish)
          : d.kind === "improve"
            ? improvePrompt(d, wish)
            : newPrompt(d, wish);
    if (label) label.textContent = LABELS[how] ?? LABELS.line;
    text.closest("label").hidden = how === "self";
  };
  maker.addEventListener("input", update);
  maker.addEventListener("change", update);
  // ?make=<words> fills in the request, e.g. from a Wanted entry.
  const asked = new URLSearchParams(location.search).get("make");
  if (asked && d.kind === "new") text.value = asked.slice(0, 600);
  update();
}
