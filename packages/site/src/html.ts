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
  active?: "gallery" | "compositions" | "wanted" | "about";
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
<link rel="stylesheet" href="${o.base}static/style.css">
${importMap ? raw(`<script type="importmap">${importMap}</script>`) : ""}
${o.modelViewer ? html`<script type="module" src="${o.base}vendor/model-viewer/model-viewer.min.js"></script>` : ""}
${(o.scripts ?? []).map((s) => html`<script ${raw(s.module === false ? "defer" : 'type="module"')} src="${o.base}${s.src}"></script>`)}
</head>
<body>
<header class="site">
  <a class="brand" href="${o.base}">Prop Commons</a>
  <nav>
    ${nav("gallery", "", "Assets")}
    ${nav("compositions", "compositions/", "Compositions")}
    ${nav("wanted", "wanted/", "Wanted")}
    ${nav("about", "about/", "About")}
  </nav>
</header>
<main>
${o.body}
</main>
<footer class="site">
  <p>Assets and compositions are <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>: free to use for anything, no credit required. The spec text is CC BY 4.0 and the code is MIT.
  Machine-readable: <a href="${o.base}index.json">index.json</a> · <a href="${o.base}llms.txt">llms.txt</a> · <a href="${o.base}spec/0.1/SPEC.md">spec</a></p>
</footer>
</body>
</html>`)}
`;
}
