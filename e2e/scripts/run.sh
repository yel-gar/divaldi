#!/usr/bin/env bash
#
# Full end-to-end run: bring the stack up, seed it, then run Playwright.
#
#   ./e2e/scripts/run.sh
#   ./e2e/scripts/run.sh --ui
#   ./e2e/scripts/run.sh auth.spec.ts
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$E2E_DIR/scripts/setup.sh"

cd "$E2E_DIR"

if [ ! -d node_modules ]; then
  echo "==> Installing Playwright"
  # The global npm on some machines is newer than the pinned one and refuses
  # remote tarball dependencies, so use the version the repo standardises on.
  npx --yes npm@10.9.2 install
  npx playwright install chromium
fi

echo "==> Running the e2e suite"
exec npx playwright test "$@"
