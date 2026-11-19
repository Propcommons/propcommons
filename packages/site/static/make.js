// The "Improve it" and "Make a prop" builders: they turn what the person types into a prompt for
// their own AI (or the commands to do it by hand), so whatever they use follows the project's
// rules. Everything here runs in the page; nothing is sent anywhere.

const QUALITY =
  "Make it look like the real thing, not a quick generated model: true-to-life proportions, softened edges, and believable materials and textures (wood grain, worn metal, glaze, fabric weave) rather than flat colours.";

function setup() {
  return [
    "Get the project, unless you're already in a clone of it: check that Node.js 26.13 or later, git and the GitHub CLI are installed and that `gh auth status` shows me signed in (if not, walk me through `gh auth login`). Then run `gh repo fork Propcommons/propcommons --clone`, `cd propcommons`, `npm ci` and `npx playwright install --only-shell chromium`.",
    "Read AGENTS.md in the clone and follow it: it's the rulebook and wins over anything in this message.",
    `Use the project's MCP server if you can (AGENTS.md says how to connect it); otherwise the \`npx propcommons\` commands do the same things.`,
  ];
}

const finish = [
  "Validate until it passes. Then render the preview images, look at them yourself and show them to me (they're saved under previews/). Fix whatever looks wrong: passing only means the file is well-formed.",
  "When I'm happy with it, show me the sign-off statement word for word, and only after my yes, submit it as a pull request.",
];

const numbered = (steps) => steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

function improvePrompt(d, wish) {
  return `Help me make a better version of a prop for Prop Commons, an open library of free (CC0) 3D game props that all follow one spec, so they fit together in any scene.

The prop: ${d.name} (${d.ref})
Its page: ${d.page}
Its size: ${d.size} (width × height × depth). Keep about that size unless the real object is different.
What I want better: ${wish || "Make it clearly better: closer to the real object in shape and detail."}
${QUALITY}

Please do it end to end on this computer:
${numbered([
  ...setup(),
  `Start from the current model with improve_asset, from "${d.ref}" (command line: \`npx propcommons improve ${d.ref} --ai-assisted --tools "<your model's name>"\`). That makes a folder under my GitHub handle that links back to the original.`,
  "Look at the original's preview images first and tell me in a sentence or two what you'll change. Then build the better model (in Blender if I have it, otherwise with a generator script in work/, as AGENTS.md describes) and replace model.glb in the new folder.",
  ...finish,
])}`;
}

function newPrompt(d, wish) {
  return `Help me make a new prop for Prop Commons, an open library of free (CC0) 3D game props that all follow one spec, so they fit together in any scene.

What I want: ${wish || `(Ask me what to make. The Wanted list is a good place to start: ${d.site}wanted/)`}
${QUALITY}

Please do it end to end on this computer:
${numbered([
  ...setup(),
  `First check the library doesn't have it already (search_assets, or ${d.site}index.json). If something close exists, show me and ask whether to improve that one instead.`,
  'Work out its real-world size and size class, then start the folder with init_asset under my GitHub handle (command line: `npx propcommons init <my-handle>/<slug> --ai-assisted --tools "<your model\'s name>"`).',
  "Build the model at real-world size (in Blender if I have it, otherwise with a generator script in work/, as AGENTS.md describes) and put it at model.glb. Check the kit preview too: it should look right next to the props already in the library.",
  ...finish,
])}`;
}

function byHand(d, kind) {
  const start =
    kind === "improve"
      ? `npx propcommons improve ${d.ref} --tools "Blender"`
      : 'npx propcommons init your-handle/your-prop --name "Your prop" --size-class small --tools "Blender"';
  return `# Once: get the project (needs Node.js 26.13+, git, and the GitHub CLI signed in)
gh repo fork Propcommons/propcommons --clone
cd propcommons && npm ci
npx playwright install --only-shell chromium

# ${kind === "improve" ? `Start from ${d.name}: a copy of it under your own handle` : "Start the folder"}
${start}

# Model it in Blender, then export with tools/blender/export_asset.py
# (CONTRIBUTING.md has the steps). Then check it and look at the pictures:
npx propcommons validate assets/your-handle/...
npx propcommons preview assets/your-handle/...

# Then open a pull request: CONTRIBUTING.md sections 6 and 7.`;
}

for (const maker of document.querySelectorAll(".maker")) {
  const d = maker.dataset;
  const text = maker.querySelector(".maker-text");
  const out = maker.querySelector(".maker-out");
  const label = maker.querySelector(".maker-out-label");
  const update = () => {
    const how = maker.querySelector("input[type=radio]:checked")?.value ?? "ai";
    const wish = text.value.trim().replace(/\s+/g, " ");
    out.textContent =
      how === "self"
        ? byHand(d, d.kind)
        : d.kind === "improve"
          ? improvePrompt(d, wish)
          : newPrompt(d, wish);
    if (label)
      label.textContent =
        how === "self" ? "The commands, in a terminal:" : "Copy this and paste it into your AI:";
    text.closest("label").hidden = how === "self";
  };
  maker.addEventListener("input", update);
  maker.addEventListener("change", update);
  // ?make=<words> fills in the request, e.g. from a Wanted entry.
  const asked = new URLSearchParams(location.search).get("make");
  if (asked && d.kind === "new") text.value = asked.slice(0, 600);
  update();
}

// The asset page's Improve button opens its builder in a dialog.
const dialog = document.getElementById("improve-dialog");
document.getElementById("improve-open")?.addEventListener("click", () => {
  dialog?.showModal();
  dialog?.querySelector(".maker-text")?.focus();
});
