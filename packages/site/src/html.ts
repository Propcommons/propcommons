// Tiny HTML templating with escaping by default. Manifest text is always treated as text: every
// interpolated value is escaped unless it is explicitly wrapped in raw(), which is used only for
// markup this file builds itself.
import { createHash } from "node:crypto";

const RAW = Symbol("raw");

export interface Raw {
  [RAW]: string;
}

export const raw = (s: string): Raw => ({ [RAW]: s });

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Value = string | number | boolean | null | undefined | Raw | Value[];

function render(v: Value): string {
  if (Array.isArray(v)) return v.map(render).join("");
  if (v && typeof v === "object" && RAW in v) return v[RAW];
  if (v === null || v === undefined || v === false) return "";
  return escapeHtml(v);
}

/** Tagged template: html`<p>${userText}</p>` escapes userText. Returns Raw so it nests. */
export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return raw(out);
}

/** Only https links are rendered; anything else becomes plain text. */
export function safeLink(url: unknown, text: Value): Raw {
  if (typeof url === "string" && /^https:\/\/[^\s"'<>]+$/.test(url)) {
    return html`<a href="${url}" rel="nofollow noopener noreferrer">${text}</a>`;
  }
  return html`${text}`;
}

export const IMPORT_MAP = (base: string) =>
  JSON.stringify({
    imports: {
      three: `${base}vendor/three/three.module.js`,
      "three/addons/": `${base}vendor/three/addons/`,
    },
  });

const sha256Base64 = (s: string) => createHash("sha256").update(s).digest("base64");

let repoUrl = "https://github.com/";

/** The brand mark: three faces of a box resting on the ground, in the accent colours. */
const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M16 3 28 9.5 16 16 4 9.5Z" fill="var(--accent-soft)"/><path d="M4 9.5 16 16v13L4 22.5Z" fill="var(--accent)"/><path d="M28 9.5 16 16v13l12-6.5Z" fill="var(--accent-strong)"/></svg>`;

/** The repository's GitHub address, linked from every page's header and footer. */
let assetVersion = "";
/**
 * A fingerprint of the site's own scripts and styles, added to their URLs, so a deploy takes
 * effect at once instead of after GitHub Pages' ten-minute browser cache.
 */
export function setAssetVersion(v: string): void {
  assetVersion = v;
}
const versioned = (url: string) => (assetVersion ? `${url}?v=${assetVersion}` : url);

export function setRepoUrl(url: string): void {
  repoUrl = url;
}

export interface PageOptions {
  base: string;
  title: string;
  description?: string;
  body: Raw;
  /** Extra script files (paths relative to the site root). */
  scripts?: { src: string; module?: boolean }[];
  /** Adds the import map for Three.js. */
  importMap?: boolean;
  /** Load the model-viewer bundle. */
  modelViewer?: boolean;
  active?: "gallery" | "studio" | "compositions" | "wanted" | "contribute" | "about";
  /** A full-window app page: no footer, and main is not width-limited. */
  app?: boolean;
}

export function page(o: PageOptions): string {
  const importMap = o.importMap ? IMPORT_MAP(o.base) : null;
  // Scripts: only same-origin files, plus the exact import map by hash. No inline code.
  const csp = [
    "default-src 'self'",
    // model-viewer compiles a WebAssembly module; 'wasm-unsafe-eval' allows that and nothing else
    // (JavaScript eval stays blocked). Only asset pages load model-viewer.
    `script-src 'self'${importMap ? ` 'sha256-${sha256Base64(importMap)}'` : ""}${o.modelViewer ? " 'wasm-unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const nav = (key: PageOptions["active"], href: string, label: string) =>
    html`<a href="${o.base}${href}"${raw(o.active === key ? ' aria-current="page"' : "")}>${label}</a>`;
  const footer = html`<footer class="site">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="${o.base}">${raw(LOGO)}<span>Prop Commons</span></a>
      <p class="muted">An open library of game props that fit together. Assets and compositions are <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>: free for anything, no credit required.</p>
    </div>
    <div>
      <h2>Library</h2>
      <ul>
        <li><a href="${o.base}">All assets</a></li>
        <li><a href="${o.base}compositions/">Compositions</a></li>
        <li><a href="${o.base}wanted/">Wanted</a></li>
      </ul>
    </div>
    <div>
      <h2>Contribute</h2>
      <ul>
        <li><a href="${o.base}contribute/">Add an asset</a></li>
        <li><a href="${o.base}spec/0.1/">The asset spec</a></li>
        <li><a href="${repoUrl}">GitHub</a></li>
      </ul>
    </div>
    <div>
      <h2>For tools and agents</h2>
      <ul>
        <li><a href="${o.base}index.json">index.json</a></li>
        <li><a href="${o.base}llms.txt">llms.txt</a></li>
        <li><a href="${o.base}about/">About the project</a></li>
      </ul>
    </div>
  </div>
  <p class="wrap fineprint muted">The spec text is CC BY 4.0 and the code is MIT.</p>
</footer>`;
  return `<!doctype html>
${render(html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>${o.title}</title>
${o.description ? html`<meta name="description" content="${o.description}">` : ""}
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${versioned(`${o.base}static/style.css`)}">
${importMap ? raw(`<script type="importmap">${importMap}</script>`) : ""}
${o.modelViewer ? html`<script type="module" src="${o.base}vendor/model-viewer/model-viewer.min.js"></script>` : ""}
${(o.scripts ?? []).map((s) => html`<script ${raw(s.module === false ? "defer" : 'type="module"')} src="${versioned(`${o.base}${s.src}`)}"></script>`)}
</head>
<body${raw(o.app ? ' class="app"' : "")}>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <div class="wrap header-inner">
    <a class="brand" href="${o.base}">${raw(LOGO)}<span>Prop Commons</span></a>
    <nav aria-label="Site">
      ${nav("gallery", "", "Library")}
      ${nav("studio", "studio/", "Studio")}
      ${nav("compositions", "compositions/", "Compositions")}
      ${nav("wanted", "wanted/", "Wanted")}
      ${nav("about", "about/", "About")}
      <a class="nav-github" href="${repoUrl}">GitHub</a>
      <a class="button small${o.active === "contribute" ? " current" : ""}" href="${o.base}contribute/">Contribute</a>
    </nav>
  </div>
</header>
<main id="main"${raw(o.app ? "" : ' class="wrap"')}>
${o.body}
</main>
${o.app ? "" : footer}
</body>
</html>`)}
`;
}
