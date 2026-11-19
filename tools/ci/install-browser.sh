#!/usr/bin/env bash
# Installs the headless browser the previews are rendered with. GitHub's apt mirrors sometimes
# stall, which used to hang a run until its job timeout; give each attempt five minutes and try
# three times.
set -u
for attempt in 1 2 3; do
  if timeout 300 npx playwright install --with-deps --only-shell chromium; then exit 0; fi
  echo "Browser install attempt $attempt failed or stalled; trying again." >&2
done
exit 1
