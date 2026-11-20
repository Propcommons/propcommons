// Writes tools/npm/tools.json: the MCP server's tool list and instructions as they are now. The
// published launcher shows these to an AI before the real server is installed, so every tool is
// there from the first moment. A test fails when this file is out of date.
// Usage: node tools/npm/snapshot.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, instructionsFor } from "../../packages/mcp/src/server.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const SNAPSHOT_FILE = path.join(import.meta.dirname, "tools.json");

/** The snapshot as it should be written, as text. */
export async function snapshot(): Promise<string> {
  const server = createServer({ root: ROOT });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "snapshot", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  // "{root}" stands for the folder on the person's computer; the launcher fills it in.
  const instructions = instructionsFor("{root}").replaceAll(path.sep, "/");
  return `${JSON.stringify({ instructions, tools }, null, 2)}\n`;
}

if (import.meta.main) {
  const text = await snapshot();
  if (process.argv.includes("--check")) {
    const same = (a: string, b: string) =>
      JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
    if (!same(readFileSync(SNAPSHOT_FILE, "utf8"), text)) {
      console.error("tools/npm/tools.json is out of date. Run: node tools/npm/snapshot.ts");
      process.exitCode = 1;
    }
  } else {
    writeFileSync(SNAPSHOT_FILE, text);
    console.log(`wrote ${path.relative(ROOT, SNAPSHOT_FILE)}`);
  }
}
