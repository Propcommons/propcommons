// Runs on every page: which AI the visitor uses and whether they have connected it, and tabs.
// The site cannot check a connection. It remembers what the visitor ticked, in this browser only.
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private windows and blocked storage: the page still works, it just forgets.
    }
  },
};

const TOOL_NAMES = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", other: "Your AI" };

function setTool(tool) {
  const t = tool in TOOL_NAMES ? tool : "claude";
  store.set("pc-tool", t);
  for (const b of document.querySelectorAll("[data-tool]"))
    b.setAttribute("aria-selected", String(b.dataset.tool === t));
  for (const p of document.querySelectorAll("[data-tool-panel]"))
    p.hidden = p.dataset.toolPanel !== t;
  for (const n of document.querySelectorAll("[data-tool-name]")) n.textContent = TOOL_NAMES[t];
}

function setConnected(on) {
  store.set("pc-connected", on ? "1" : "");
  for (const c of document.querySelectorAll("[data-connected]")) c.checked = on;
  for (const el of document.querySelectorAll("[data-when]"))
    el.hidden = (el.dataset.when === "on") !== on;
  document.dispatchEvent(new CustomEvent("pc-connected", { detail: on }));
}

for (const b of document.querySelectorAll("[data-tool]"))
  b.addEventListener("click", () => setTool(b.dataset.tool));
for (const c of document.querySelectorAll("[data-connected]"))
  c.addEventListener("change", () => setConnected(c.checked));
for (const b of document.querySelectorAll("[data-disconnect]"))
  b.addEventListener("click", () => setConnected(false));
setTool(store.get("pc-tool") ?? "claude");
setConnected(store.get("pc-connected") === "1");

// The 3D viewer zooms on scroll only after a click, so scrolling down the page never gets stuck
// in it. Leaving it with the pointer (or lifting your fingers) hands scrolling back to the page.
for (const viewer of document.querySelectorAll("model-viewer[disable-zoom]")) {
  viewer.addEventListener("pointerdown", () => viewer.removeAttribute("disable-zoom"));
  viewer.addEventListener("pointerleave", () => viewer.setAttribute("disable-zoom", ""));
}

// Plain tab groups: buttons with data-tab show the panel with the matching data-panel.
for (const group of document.querySelectorAll("[data-tabs]")) {
  const tabs = [...group.querySelectorAll("[data-tab]")];
  for (const tab of tabs)
    tab.addEventListener("click", () => {
      for (const other of tabs) {
        other.setAttribute("aria-selected", String(other === tab));
        const panel = group.querySelector(`[data-panel="${other.dataset.tab}"]`);
        if (panel) panel.hidden = other !== tab;
      }
    });
}
