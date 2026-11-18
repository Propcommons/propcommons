# Governance

Prop Commons is small, so its governance is simple and written down so it can change openly.

## Who decides

- **The maintainer decides.** Today there is one maintainer, @mattashes, listed in
  [`MAINTAINERS`](MAINTAINERS). The maintainer merges pull requests, makes calls the spec leaves
  open, enforces the [code of conduct](CODE_OF_CONDUCT.md) and the
  [content policy](CONTENT_POLICY.md), and handles takedowns.
- **A second maintainer is being sought.** One person is a single point of failure. If you have
  contributed assets or code and would like to help review, say so in an issue.
- Maintainers are listed in `MAINTAINERS`, which the checks read from the main branch. Adding or
  removing a maintainer is a pull request to that file, merged by an existing maintainer.

## How decisions are made

- **Assets** are merged when the checks pass and a maintainer has reviewed the previews against the
  spec's guidance (proportions, resting pose and facing, normal maps, fit with the kit) and the
  content policy. A maintainer may ask for changes or decline an asset, and says why.
- **The spec** changes through an issue, then a pull request to `spec/`. Until 1.0, breaking
  changes are allowed; they are announced in the pull request and in `spec/DECISIONS.md`. Rule IDs
  are never reused or renamed.
- **Budgets and other proposed values** (triangle limits, size class edges, the extension
  allowlist and so on) are revisited once the first kit of real contributions exists, using what
  those assets actually needed.
- **Disagreements** are discussed in the open, on the issue or pull request. The maintainer makes
  the final call and records the reason.

## When this changes

This model is revisited when **25 contributors** have merged assets, or sooner if the maintainers
think it should be. Likely changes then include more maintainers, reviewers who can approve assets,
and a written process for spec proposals. Any change to this file is made by pull request.

## Repository settings

These settings support the rules above; a maintainer keeps them on:

- Workflow runs from outside contributors' pull requests need a maintainer's approval.
- Private vulnerability reporting is enabled, for security and conduct reports.
- GitHub Pages is built only by the deploy workflow, from the main branch.
