# propcommons

Connects your AI to [Prop Commons](https://propcommons.github.io/propcommons/), an open library of
free (CC0) 3D game props that all follow one spec, so they fit together in any scene. Pick a prop
that looks rough, and have your AI build a better one: it gets the rules, checks its own model
against them, shows you pictures, and publishes under your name after your yes.

## Connect your AI, once

**Claude Code**

```bash
claude mcp add propcommons -- npx -y propcommons mcp
```

**Codex**

```bash
codex mcp add propcommons -- npx -y propcommons mcp
```

**Anything else that uses MCP servers**

```json
{
  "mcpServers": {
    "propcommons": { "command": "npx", "args": ["-y", "propcommons", "mcp"] }
  }
}
```

Then ask it, for example:

> Use Prop Commons to improve mattashes/kettle.

## What it does on your computer

The first time your AI uses it, it downloads the Prop Commons library and its tools into
`~/propcommons` (set `PROPCOMMONS_HOME` for another folder) and installs them, including a small
browser (about 200 MB) that draws the preview pictures. Your props are made in that folder. Nothing
is published until you have read the sign-off statement and said yes; publishing uses your own
GitHub login through the [GitHub CLI](https://cli.github.com).

You need [Node.js](https://nodejs.org) (the current version) and git. To publish you also need a
free GitHub account and the GitHub CLI.

## Commands

```bash
npx propcommons setup
```

Downloads and installs everything now, with progress. Optional: your AI does this when it needs to.

```bash
npx propcommons where
```

Prints the folder Prop Commons lives in.

Any other command (`validate`, `preview`, `improve`, `init`, `settle` and so on) runs the project's
own command line in that folder; `npx propcommons help` there lists them.

If you already work in your own clone of the repository, set `PROPCOMMONS_ROOT` to it and this
package uses that clone as it is, without downloading or updating anything.

Published from `tools/npm/` in the
[repository](https://github.com/Propcommons/propcommons). License: MIT.
