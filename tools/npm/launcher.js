#!/usr/bin/env node
// The `propcommons` package on npm: one command that connects an AI to Prop Commons.
//
//   npx -y propcommons mcp      the MCP server (what `claude mcp add` and friends run)
//   npx propcommons setup       get everything ready now, with progress, in a terminal
//   npx propcommons where       print the folder Prop Commons lives in on this computer
//   npx propcommons <command>   any other command runs the project's own command line there
//
// The tools themselves live in a copy of the repository (by default ~/propcommons), which this
// file downloads and keeps up to date. It is plain JavaScript with no dependencies, so it starts
// on any current Node.js and can explain what is missing.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const PKG = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const REPO_URL =
  process.env.PROPCOMMONS_REPO_URL ?? "https://github.com/Propcommons/propcommons.git";
const WIN = process.platform === "win32";
const INIT_ID = "propcommons-launcher-init";
const MINUTE = 60_000;

/**
 * Where Prop Commons lives on this computer. PROPCOMMONS_ROOT names a clone the person looks
 * after themselves (never downloaded or updated here); otherwise this file manages
 * PROPCOMMONS_HOME, or ~/propcommons.
 */
function workspace() {
  if (process.env.PROPCOMMONS_ROOT)
    return { dir: path.resolve(process.env.PROPCOMMONS_ROOT), managed: false };
  return {
    dir: path.resolve(process.env.PROPCOMMONS_HOME ?? path.join(homedir(), "propcommons")),
    managed: true,
  };
}

/** Runs a command and resolves with its exit code and output; never rejects. */
function run(cmd, args, { cwd, timeout = 10 * MINUTE, input } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        shell: WIN && (cmd === "npm" || cmd === "npx"),
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: -1, out: String(e?.message ?? e), missing: true });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: e.message, missing: e.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const tail = (s, lines = 12) => s.trim().split("\n").slice(-lines).join("\n");
const git = (dir, args, opts) => run("git", args, { cwd: dir, ...opts });

function lockHash(dir) {
  const file = path.join(dir, "package-lock.json");
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
}

// The marker sits inside .git, so it belongs to this copy and is never part of anyone's work.
const markerFile = (dir) => path.join(dir, ".git", "propcommons-ready.json");
function readMarker(dir) {
  try {
    return JSON.parse(readFileSync(markerFile(dir), "utf8"));
  } catch {
    return null;
  }
}

const serverFile = (dir) => path.join(dir, "packages", "mcp", "src", "main.ts");
const cliFile = (dir) => path.join(dir, "packages", "cli", "src", "main.ts");

/** True when the tools are downloaded and installed for the files that are there now. */
function isReady(ws) {
  if (!existsSync(serverFile(ws.dir))) return false;
  if (!existsSync(path.join(ws.dir, "node_modules", "@modelcontextprotocol"))) return false;
  if (!ws.managed) return true;
  const lock = lockHash(ws.dir);
  return lock !== null && readMarker(ws.dir)?.lock === lock;
}

/** A sentence saying this Node.js is too old for the project's tools, or null when it is fine. */
function nodeProblem(dir) {
  let wanted;
  try {
    wanted = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).engines?.node;
  } catch {
    return null;
  }
  const min = /(\d+)\.(\d+)\.(\d+)/.exec(wanted ?? "");
  if (!min) return null;
  const have = process.versions.node.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] > Number(min[i + 1])) return null;
    if (have[i] < Number(min[i + 1]))
      return `Prop Commons needs Node.js ${min[0]} or later, and this computer runs ${process.versions.node}. Install the current version from https://nodejs.org, then restart your AI tool.`;
  }
  return null;
}

/**
 * Brings a managed copy up to date with the main project. The person's own work there is new,
 * uncommitted folders, which a fast-forward leaves alone; copies of files that have since been
 * merged (their own published props) are removed first so they don't block it. Best effort.
 */
async function update(ws, fetchTimeout = 20_000) {
  if (!ws.managed || !existsSync(path.join(ws.dir, ".git"))) return "skipped";
  const branch = (await git(ws.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).out.trim();
  const changed = (await git(ws.dir, ["status", "--porcelain", "--untracked-files=no"])).out.trim();
  if (branch !== "main" || changed) return "skipped";
  const fetched = await git(ws.dir, ["fetch", "--quiet", "origin", "main"], {
    timeout: fetchTimeout,
  });
  if (fetched.code !== 0) return "offline";
  const head = (await git(ws.dir, ["rev-parse", "HEAD"])).out.trim();
  const theirs = (await git(ws.dir, ["rev-parse", "origin/main"])).out.trim();
  if (head === theirs) return "current";
  const untracked = (await git(ws.dir, ["ls-files", "--others", "--exclude-standard", "-z"])).out
    .split("\0")
    .filter(Boolean);
  if (untracked.length) {
    const incoming = new Map();
    for (const line of (await git(ws.dir, ["ls-tree", "-r", "-z", "origin/main"])).out.split(
      "\0",
    )) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(line);
      if (m) incoming.set(m[2], m[1]);
    }
    const mine = untracked.filter((f) => incoming.has(f));
    if (mine.length) {
      const hashes = (
        await git(ws.dir, ["hash-object", "--stdin-paths"], { input: `${mine.join("\n")}\n` })
      ).out
        .trim()
        .split("\n");
      mine.forEach((f, i) => {
        if (hashes[i] === incoming.get(f)) unlinkSync(path.join(ws.dir, f));
      });
    }
  }
  const merged = await git(ws.dir, ["merge", "--quiet", "--ff-only", "origin/main"]);
  return merged.code === 0 ? "updated" : "blocked";
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Downloads and installs everything, skipping what is already done. `log` gets one line per
 * step. Resolves with { ok, error?, notes } and never throws for an expected problem.
 */
async function setup(ws, log) {
  // One setup at a time on this computer (two AI tools may start together).
  const lock = `${ws.dir}.setup-lock`;
  for (let waited = 0; existsSync(lock); waited++) {
    const pid = Number(readFileSync(lock, "utf8"));
    if (!pidAlive(pid) || waited > 20 * 60) break;
    if (waited === 0) log("Another setup is already running; waiting for it.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  try {
    writeFileSync(lock, String(process.pid));
  } catch {
    // The folder above may not exist yet or not be writable; git reports that below.
  }
  try {
    return await setupSteps(ws, log);
  } finally {
    rmSync(lock, { force: true });
  }
}

async function setupSteps(ws, log) {
  const fail = (error) => ({ ok: false, error, notes: [] });
  if ((await run("git", ["--version"])).code !== 0)
    return fail(
      "git is not installed. Install it from https://git-scm.com/downloads, then run setup again.",
    );
  if (!existsSync(path.join(ws.dir, ".git"))) {
    if (!ws.managed)
      return fail(
        `PROPCOMMONS_ROOT is ${ws.dir}, which is not a copy of the Prop Commons project.`,
      );
    if (existsSync(ws.dir) && readdirSync(ws.dir).length)
      return fail(
        `${ws.dir} already exists and is not a copy of Prop Commons. Move it away, or set PROPCOMMONS_HOME to another folder, then run setup again.`,
      );
    log(`Downloading the Prop Commons library into ${ws.dir}.`);
    const cloned = await run("git", ["clone", "--quiet", REPO_URL, ws.dir]);
    if (cloned.code !== 0) return fail(`Downloading the library failed:\n${tail(cloned.out)}`);
  } else {
    const state = await update(ws);
    if (state === "updated") log("Brought the library up to date.");
  }
  if (!existsSync(serverFile(ws.dir)))
    return fail(`${ws.dir} is not a copy of the Prop Commons project.`);
  const node = nodeProblem(ws.dir);
  if (node) return fail(node);

  const lock = lockHash(ws.dir);
  const marker = readMarker(ws.dir);
  const installed = existsSync(path.join(ws.dir, "node_modules", "@modelcontextprotocol"));
  const install = !installed || (ws.managed && marker?.lock !== lock);
  if (install) {
    log("Installing the tools. This takes a minute or two.");
    const ci = await run("npm", ["ci"], { cwd: ws.dir, timeout: 20 * MINUTE });
    if (ci.code !== 0)
      return fail(
        ci.missing
          ? "npm is not installed. It comes with Node.js: install the current version from https://nodejs.org, then run setup again."
          : `Installing the tools failed:\n${tail(ci.out)}`,
      );
  }
  const extra = [];
  let browser = marker?.browser === true && !install;
  if (!browser) {
    log("Getting the browser that draws the preview pictures (about 200 MB, the first time only).");
    const got = await run("npx", ["playwright", "install", "--only-shell", "chromium"], {
      cwd: ws.dir,
      timeout: 20 * MINUTE,
    });
    browser = got.code === 0;
    if (!browser)
      extra.push(
        `The preview browser could not be installed, so render_preview will not work yet. To retry, run this in ${ws.dir}: npx playwright install --only-shell chromium`,
      );
  }
  if (ws.managed)
    writeFileSync(markerFile(ws.dir), JSON.stringify({ lock, browser, at: Date.now() }));
  log("Ready.");
  return { ok: true, notes: [...extra, ...(await notes(ws))] };
}

/** Things that are not needed to start, but will be needed to publish. */
async function notes(ws) {
  const out = [];
  const gh = await run("gh", ["auth", "status"], { timeout: 20_000 });
  if (gh.missing)
    out.push(
      "The GitHub CLI (gh) is not installed. It is only needed to publish: before submit, the person installs it from https://cli.github.com and runs `gh auth login`.",
    );
  else if (gh.code !== 0)
    out.push(
      "The GitHub CLI is not signed in. It is only needed to publish: before submit, the person runs `gh auth login`.",
    );
  const email = await git(ws.dir, ["config", "user.email"]);
  if (!email.out.trim())
    out.push(
      "git does not know the person's name and email yet. Before submit, ask them for both (the email should be their GitHub noreply address from https://github.com/settings/emails) and set them with git config --global user.name and user.email.",
    );
  return out;
}

/** Starts a Node.js program from the copy and resolves with its exit code. */
function runNode(ws, file, args, stdio = "inherit") {
  const child = spawn(process.execPath, [file, ...args], { cwd: ws.dir, stdio });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  return child;
}
const exitCode = (child) =>
  new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));

// ---------- The MCP server ----------

const text = (s, isError = false) => ({ content: [{ type: "text", text: s }], isError });

/**
 * Before the tools are installed, this file answers the AI itself: it lists the project's tools
 * (from tools.json, a snapshot made when this package was published) plus `setup`, and tells any
 * other call to run setup first. Once setup finishes it starts the real server and passes every
 * message through.
 */
function proxy(ws) {
  const snapshot = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
  const setupTool = {
    name: "setup",
    title: "Set up Prop Commons on this computer",
    description: `Run this first if another tool says Prop Commons is not set up yet. It downloads the Prop Commons library and its tools into ${ws.dir} and installs them, including a small browser (about 200 MB) that draws the preview pictures. It changes nothing else on the computer and nothing on GitHub. The first run takes a few minutes: it returns progress, so call it again until it says Prop Commons is ready.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  };
  const instructions = `Prop Commons is not set up on this computer yet, so start by calling the setup tool (again and again until it says ready). The folder named below, and the AGENTS.md in it, exist only after that.\n\n${snapshot.instructions.replaceAll("{root}", ws.dir)}`;
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });

  let initRequest = null;
  let child = null;
  let live = false; // the real server is running and has been greeted
  let job = null;

  function startChild() {
    return new Promise((resolve, reject) => {
      child = runNode(ws, serverFile(ws.dir), ["--root", ws.dir], ["pipe", "pipe", "inherit"]);
      child.on("error", reject);
      child.on("exit", (code) => {
        if (live) process.exit(code ?? 0);
        else reject(new Error(`the Prop Commons server stopped (exit code ${code}).`));
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (live) {
          process.stdout.write(`${line}\n`);
          return;
        }
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.id !== INIT_ID) return;
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        );
        live = true;
        send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
        resolve();
      });
      const params = initRequest?.params ?? {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "propcommons-launcher", version: PKG.version },
      };
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: INIT_ID, method: "initialize", params })}\n`,
      );
    });
  }

  async function setupCall(id) {
    if (live) {
      reply(id, text(`Prop Commons is ready in ${ws.dir}.`));
      return;
    }
    if (!job) {
      job = { lines: [], done: false, result: null };
      const current = job;
      setup(ws, (line) => current.lines.push(line))
        .catch((e) => ({ ok: false, error: String(e?.message ?? e), notes: [] }))
        .then((result) => {
          current.result = result;
          current.done = true;
        });
    }
    const current = job;
    // Answer within half a minute whatever happens: some AI tools give up on a call after 60 s.
    for (let i = 0; i < 100 && !current.done; i++) await new Promise((r) => setTimeout(r, 250));
    const progress = current.lines.join("\n");
    if (!current.done) {
      reply(id, text(`${progress}\n\nStill working. Call setup again in about 20 seconds.`.trim()));
      return;
    }
    if (!current.result.ok) {
      job = null; // the next call tries again
      reply(id, text(`${progress}\n\nSetup did not finish. ${current.result.error}`.trim(), true));
      return;
    }
    try {
      if (!child) await startChild();
    } catch (e) {
      job = null;
      child = null;
      reply(id, text(`Setup finished, but the tools did not start: ${e.message}`, true));
      return;
    }
    const more = current.result.notes.length
      ? `\n\nFor later:\n${current.result.notes.map((n) => `- ${n}`).join("\n")}`
      : "";
    reply(id, text(`Prop Commons is ready in ${ws.dir}. Now call the tool you wanted.${more}`));
  }

  function handle(msg, raw) {
    if (msg.method === "tools/call" && msg.params?.name === "setup") {
      setupCall(msg.id);
      return;
    }
    if (live) {
      child.stdin.write(`${raw}\n`);
      return;
    }
    switch (msg.method) {
      case "initialize":
        initRequest = msg;
        reply(msg.id, {
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "propcommons", version: PKG.version },
          instructions,
        });
        return;
      case "ping":
        reply(msg.id, {});
        return;
      case "tools/list":
        reply(msg.id, { tools: [setupTool, ...snapshot.tools] });
        return;
      case "tools/call":
        reply(
          msg.id,
          text(
            `Prop Commons is not set up on this computer yet. Call the setup tool first (it downloads the library and tools into ${ws.dir}; call it again until it says ready), then call ${msg.params?.name ?? "this tool"} again.`,
            true,
          ),
        );
        return;
      default:
        if (msg.id !== undefined && msg.method)
          send({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32601, message: `Method not found: ${msg.method}` },
          });
    }
  }

  const lines = createInterface({ input: process.stdin });
  lines.on("line", (raw) => {
    if (!raw.trim()) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handle(msg, raw);
  });
  lines.on("close", () => {
    child?.kill();
    process.exit(0);
  });
  console.error(`propcommons: not set up yet in ${ws.dir}; waiting for the setup tool.`);
}

async function mcp() {
  const ws = workspace();
  // A quick look for new props and tools before starting; it gives up fast when offline.
  await update(ws, 8000).catch(() => {});
  if (isReady(ws) && !nodeProblem(ws.dir)) {
    process.exitCode = await exitCode(runNode(ws, serverFile(ws.dir), ["--root", ws.dir]));
    return;
  }
  proxy(ws);
}

// ---------- The command line ----------

const HELP = `propcommons ${PKG.version}: connect your AI to Prop Commons, an open library of free game props.

Connect an AI (once):
  Claude Code     claude mcp add propcommons -- npx -y propcommons mcp
  Codex           codex mcp add propcommons -- npx -y propcommons mcp
  Anything else   add an MCP server with the command "npx" and the arguments "-y", "propcommons", "mcp"

Then ask it, for example: Use Prop Commons to improve mattashes/kettle.

Commands:
  mcp       Start the MCP server (your AI runs this; you don't need to).
  setup     Download and install everything now, with progress. Optional: your AI can do it.
  where     Print the folder Prop Commons lives in on this computer.
  <other>   validate, preview, improve, init, settle ...: run the project's own command line.

The folder is ~/propcommons unless PROPCOMMONS_HOME names another one.
More: https://propcommons.github.io/propcommons/`;

async function main(argv) {
  const command = argv[0];
  const ws = workspace();
  switch (command) {
    case "mcp":
      await mcp();
      return;
    case "setup": {
      const result = await setup(ws, (line) => console.log(line));
      if (!result.ok) {
        console.error(`\nSetup did not finish. ${result.error}`);
        process.exitCode = 1;
        return;
      }
      console.log(`\nProp Commons is ready in ${ws.dir}.`);
      for (const n of result.notes) console.log(`- ${n}`);
      return;
    }
    case "where":
      console.log(ws.dir);
      return;
    case "--version":
    case "-v":
      console.log(PKG.version);
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default: {
      const problem = isReady(ws) ? nodeProblem(ws.dir) : "Run `npx propcommons setup` first.";
      if (problem) {
        console.error(`propcommons: ${problem}`);
        process.exitCode = 2;
        return;
      }
      process.exitCode = await exitCode(runNode(ws, cliFile(ws.dir), argv));
    }
  }
}

await main(process.argv.slice(2));
