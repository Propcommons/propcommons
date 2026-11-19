#!/usr/bin/env bash
# Installs the headless browser the previews are rendered with.
#
# GitHub's Ubuntu images already have the system libraries Chrome needs, so download only the
# browser and check that it starts. Only if it doesn't, install the libraries with apt. That
# used to be the first step every time, and when a mirror stalled the whole run hung; a timed-out
# attempt also left apt holding its lock, so plain retries failed at once.
set -u
npx playwright install --only-shell chromium || exit 1
starts() {
  node --input-type=module -e "import { chromium } from 'playwright'; const b = await chromium.launch(); await b.close();" 2>/dev/null
}
if starts; then exit 0; fi
echo "The browser needs system libraries; installing them with apt." >&2
echo 'DPkg::Lock::Timeout "300";' | sudo tee /etc/apt/apt.conf.d/99-lock-timeout >/dev/null
for attempt in 1 2 3; do
  if timeout 600 npx playwright install-deps chromium && starts; then exit 0; fi
  echo "Attempt $attempt to install the libraries failed or stalled; trying again." >&2
  sudo pkill -f apt-get || true
  sleep 5
done
exit 1
