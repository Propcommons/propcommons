#!/usr/bin/env bash
# The body of the assets-pr workflow, kept in a script so it can be tested locally.
# It always runs from the BASE branch's checkout; the pull request's head is read only as data.
# Nothing from the head is executed: no npm, no scripts, no Blender.
#
# Required environment:
#   BASE_DIR   checkout of the base branch, with `npm ci` already run there
#   HEAD_DIR   checkout of the pull request's head, with full history
#   BASE_SHA   base commit
#   HEAD_SHA   head commit
#   PR_AUTHOR  the pull request author's login
#   PR_BODY    the pull request description
#   OUT_DIR    where result.json, summary.md and previews/ are written
set -euo pipefail

mkdir -p "$OUT_DIR"
git -C "$HEAD_DIR" fetch --quiet --no-tags origin "$BASE_SHA" 2>/dev/null || true
git -C "$HEAD_DIR" diff --name-status --no-renames "$BASE_SHA...$HEAD_SHA" > "$OUT_DIR/changed.txt"
printf '%s' "$PR_BODY" > "$OUT_DIR/body.md"

set +e
node "$BASE_DIR/packages/cli/src/main.ts" check-pr \
  --base "$BASE_DIR" --head "$HEAD_DIR" \
  --changed "$OUT_DIR/changed.txt" --author "$PR_AUTHOR" --body-file "$OUT_DIR/body.md" \
  --json > "$OUT_DIR/result.json"
code=$?
set -e

node "$BASE_DIR/tools/ci/summary.ts" "$OUT_DIR/result.json" > "$OUT_DIR/summary.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$OUT_DIR/summary.md" >> "$GITHUB_STEP_SUMMARY"; fi
exit "$code"
