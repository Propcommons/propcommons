#!/usr/bin/env node
// Starts the Prop Commons MCP server over stdio. Run from a clone of the repository:
//   node packages/mcp/src/main.ts [--root <repository>]
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findRepoRoot } from "@propcommons/validator";
import { createServer } from "./server.ts";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = values.root ?? process.env.PROPCOMMONS_ROOT ?? findRepoRoot(process.cwd());
const server = createServer({ root });
await server.connect(new StdioServerTransport());
// Nothing else may write to stdout: it carries the protocol.
console.error(`propcommons MCP server running for ${root}`);
