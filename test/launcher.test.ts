// The `propcommons` package on npm (tools/npm): the one command that connects an AI. These tests
// run the launcher for real over stdio, as an AI tool would, against throwaway folders.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SNAPSHOT_FILE, snapshot } from "../tools/npm/snapshot.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const LAUNCHER = path.join(REPO, "tools/npm/launcher.js");
const TOOLS = [
  "get_spec",
  "init_asset",
  "improve_asset",
  "validate",
  "render_preview",
  "search_assets",
  "compose_scene",
  "submit",
];

let tmp = "";
let fakeBin = "";

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
const textOf = (r: ToolResult) => r.content.find((c) => c.type === "text")?.text ?? "";

/** The environment an AI tool would start the launcher with, plus stand-ins for npm and npx. */
function env(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !k.startsWith("PROPCOMMONS_")) base[k] = v;
  return { ...base, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, ...extra };
}

const launcher = (args: string[], extra: Record<string, string>) =>
  spawnSync(process.execPath, [LAUNCHER, ...args], { env: env(extra), encoding: "utf8" });

async function connect(extra: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "launcher-test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [LAUNCHER, "mcp"],
      env: env(extra),
      stderr: "ignore",
    }),
  );
  return client;
}

/** A tiny stand-in for the main project, with a main branch, that the launcher can clone. */
function fakeUpstream(dir: string, node = ">=20.0.0") {
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  mkdirSync(path.join(dir, "packages/mcp/src"), { recursive: true });
  mkdirSync(path.join(dir, "packages/cli/src"), { recursive: true });
  writeFileSync(path.join(dir, "packages/mcp/src/main.ts"), "// stand-in\n");
  writeFileSync(
    path.join(dir, "packages/cli/src/main.ts"),
    'console.log("cli " + process.argv.slice(2).join(" ") + " in " + process.cwd());\n',
  );
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ engines: { node } }));
  writeFileSync(path.join(dir, "package-lock.json"), "{}\n");
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  git("init", "--quiet", "-b", "main");
  git("add", "-A");
  git("commit", "--quiet", "-m", "base");
  return git;
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "propcommons-launcher-"));
  // Stand-ins for the slow, networked steps. "npm ci" either links the real node_modules
  // (PC_REAL_MODULES) or makes an empty one that looks installed; "npx playwright" does nothing.
  fakeBin = path.join(tmp, "bin");
  mkdirSync(fakeBin);
  writeFileSync(
    path.join(fakeBin, "npm"),
    '#!/bin/sh\nif [ -n "$PC_REAL_MODULES" ]; then ln -s "$PC_REAL_MODULES" node_modules; else mkdir -p node_modules/@modelcontextprotocol; fi\n',
  );
  writeFileSync(path.join(fakeBin, "npx"), "#!/bin/sh\nexit 0\n");
  for (const f of ["npm", "npx"]) chmodSync(path.join(fakeBin, f), 0o755);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("the propcommons launcher", () => {
  it("ships a tool list that matches the server's", async () => {
    expect(
      JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")),
      "run: node tools/npm/snapshot.ts",
    ).toEqual(JSON.parse(await snapshot()));
  });

  it("offers every tool before anything is installed, and asks for setup", async () => {
    const home = path.join(tmp, "empty");
    const client = await connect({ PROPCOMMONS_HOME: home });
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(["setup", ...TOOLS]);
      expect(client.getInstructions()).toContain(home);
      const r = (await client.callTool({ name: "get_spec", arguments: {} })) as ToolResult;
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/not set up on this computer yet\. Call the setup tool first/);
      expect(existsSync(home)).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("sets itself up when asked, then hands over to the real server", async () => {
    const home = path.join(tmp, "real");
    const client = await connect({
      PROPCOMMONS_HOME: home,
      PROPCOMMONS_REPO_URL: REPO,
      PC_REAL_MODULES: path.join(REPO, "node_modules"),
    });
    try {
      let said = "";
      for (let i = 0; i < 20 && !/is ready in/.test(said); i++) {
        const r = (await client.callTool({ name: "setup", arguments: {} })) as ToolResult;
        said = textOf(r);
        expect(r.isError, said).not.toBe(true);
      }
      expect(said).toContain(`Prop Commons is ready in ${home}`);
      // The same connection now reaches the project's own server in the new folder.
      const spec = JSON.parse(
        textOf((await client.callTool({ name: "get_spec", arguments: {} })) as ToolResult),
      );
      expect(spec.rules.length).toBeGreaterThan(10);
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOLS);
      expect(existsSync(path.join(home, ".git/propcommons-ready.json"))).toBe(true);
    } finally {
      await client.close();
    }
    // Started again, it goes straight to the real server: no setup tool.
    const again = await connect({ PROPCOMMONS_HOME: home, PROPCOMMONS_REPO_URL: REPO });
    try {
      expect((await again.listTools()).tools.map((t) => t.name)).toEqual(TOOLS);
    } finally {
      await again.close();
    }
  });

  it("uses a clone the person looks after as it is", async () => {
    const client = await connect({ PROPCOMMONS_ROOT: REPO });
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOLS);
      expect(client.getInstructions()).toContain(path.join(REPO, "AGENTS.md"));
    } finally {
      await client.close();
    }
  });

  it("downloads, installs, updates and passes commands on from a terminal", () => {
    const upstream = path.join(tmp, "upstream");
    mkdirSync(upstream);
    const git = fakeUpstream(upstream);
    const home = path.join(tmp, "copy");
    const vars = { PROPCOMMONS_HOME: home, PROPCOMMONS_REPO_URL: upstream };

    expect(launcher(["where"], vars).stdout.trim()).toBe(home);
    const early = launcher(["validate", "x"], vars);
    expect(early.status).toBe(2);
    expect(early.stderr).toContain("npx propcommons setup");

    const first = launcher(["setup"], vars);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Downloading the Prop Commons library");
    expect(first.stdout).toContain(`Prop Commons is ready in ${home}`);
    expect(launcher(["validate", "x"], vars).stdout.trim()).toMatch(/^cli validate x in .*copy$/);

    // The main project gains a prop. The person has the same file already (their own, since
    // merged) and one that is still only theirs.
    const merged = "assets/alice/cup/v1/asset.json";
    mkdirSync(path.dirname(path.join(upstream, merged)), { recursive: true });
    writeFileSync(path.join(upstream, merged), '{"name":"Cup"}\n');
    git("add", "-A");
    git("commit", "--quiet", "-m", "add cup");
    const mine = "assets/alice/mug/v1/asset.json";
    for (const f of [merged, mine])
      mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
    writeFileSync(path.join(home, merged), '{"name":"Cup"}\n');
    writeFileSync(path.join(home, mine), '{"name":"Mug"}\n');

    const second = launcher(["setup"], vars);
    expect(second.status, second.stderr).toBe(0);
    const inCopy = (...args: string[]) =>
      execFileSync("git", args, { cwd: home, encoding: "utf8" }).trim();
    expect(inCopy("rev-parse", "HEAD")).toBe(git("rev-parse", "HEAD").trim());
    expect(inCopy("status", "--porcelain", "--untracked-files=all")).toBe(`?? ${mine}`);
  });

  it("says so plainly when Node.js is too old for the tools", () => {
    const upstream = path.join(tmp, "upstream-new-node");
    mkdirSync(upstream);
    fakeUpstream(upstream, ">=999.0.0");
    const r = launcher(["setup"], {
      PROPCOMMONS_HOME: path.join(tmp, "copy-new-node"),
      PROPCOMMONS_REPO_URL: upstream,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Prop Commons needs Node.js 999.0.0 or later");
  });

  it("refuses to download into a folder that holds something else", () => {
    const home = path.join(tmp, "taken");
    mkdirSync(home);
    writeFileSync(path.join(home, "notes.txt"), "mine\n");
    const r = launcher(["setup"], { PROPCOMMONS_HOME: home, PROPCOMMONS_REPO_URL: REPO });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("already exists and is not a copy of Prop Commons");
    expect(readFileSync(path.join(home, "notes.txt"), "utf8")).toBe("mine\n");
  });
});
