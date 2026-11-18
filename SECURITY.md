# Security policy

## Reporting a problem

Please report security problems privately, not in a public issue:

1. Go to https://github.com/Propcommons/propcommons/security.
2. Click **Report a vulnerability** and describe the problem and how to reproduce it.

Only the maintainers can see the report. The same form is used for code of conduct reports; start
the title with "Conduct:" for those.

Prop Commons is run by volunteers. A maintainer aims to acknowledge a report within a week and will
keep you informed while it is fixed. Please give a reasonable chance to fix a problem before
making it public.

## What is in scope

- **The validator and the checks on pull requests.** Every file in a pull request is treated as
  hostile data. A way to make the checks run contributed code, read files outside the pull
  request, use the validator from the pull request instead of the main branch, or get write access
  or secrets is a serious problem.
- **The website.** A way to make a manifest inject HTML or script into a page, or to make the site
  load anything from another origin.
- **The MCP server**, which runs locally. A way to make it reach the network other than through
  `submit`, read outside the repository, or follow instructions written in asset data.
- **The Blender export script**, which runs on contributors' own machines.

## How the project defends itself

- Contributors' files are never executed: no scripts, no Blender files, no `npm install` inside a
  pull request. Assets are a `.glb` and a JSON file.
- The asset check runs on `pull_request` (never `pull_request_target`), with a read-only token and
  no secrets, using the validator from the main branch. The pull request is checked out separately
  and read only as data.
- File lists and sizes are checked before anything is parsed, symbolic links are refused, and the
  job has a 10-minute limit.
- Only the deploy workflow can write, only to GitHub Pages, and only from the main branch.
- Third-party GitHub Actions are pinned to exact commits, and installs use the committed lockfile.
- Every page escapes manifest text, links only to `https` addresses, and has a content security
  policy that allows scripts only from the site itself.
- Workflow runs from outside contributors' pull requests need a maintainer's approval.

## Supported versions

Only the `main` branch and the live site are supported.
