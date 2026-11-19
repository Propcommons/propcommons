// A minimal static server for looking at the built site locally. Not used in production.
// Usage: node packages/site/src/serve.ts [--dir site-dist] [--base /propcommons/] [--port 8080]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".webp": "image/webp",
  ".hdr": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function serveSite(dir: string, base: string, port: number): Promise<Server> {
  const root = path.resolve(dir);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(base)) {
      res.writeHead(302, { location: base }).end();
      return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname.slice(base.length)));
    if (!file.startsWith(root)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { dir: { type: "string" }, base: { type: "string" }, port: { type: "string" } },
  });
  const base = values.base ?? "/propcommons/";
  const port = Number(values.port ?? 8080);
  await serveSite(values.dir ?? "site-dist", base, port);
  console.log(`Serving at http://127.0.0.1:${port}${base}`);
}
