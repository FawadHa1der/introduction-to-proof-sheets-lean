#!/usr/bin/env bash
# Adopt the toolchain release that website/sources.json pins: rebuild and rebake everything that
# depends on it, then check every sheet in Chrome. One command, re-runnable (a re-run skips what
# is already done):
#
#   website/adopt-runtime.sh
#
# It runs website/build.sh (every lane: the release, the compiled overlay, the native check, the
# plan, a rebake of every environment for the new runtime, the page; about two hours on Apple
# silicon, ~16 GB in website/out), installs Playwright's Chromium once, and runs the Chrome check
# of the 28 sheets on a preview server it starts and stops itself. Requirements: website/README.md
# (Node 24+, Docker that runs linux/arm64, python3, ~20 GB free).
#
# After it:
#   website/scripts/publish-prebuilt.sh --dry-run, then without --dry-run   (the quick path's environments)
#   website/site/scripts/deploy.sh --dry-run, then without --dry-run        (the live site)
set -euo pipefail
W="$(cd "$(dirname "$0")" && pwd)"
RID="$(node -p 'require(process.argv[1]).release.id' "$W/sources.json")"
RUNTIME="$(node -p 'require(process.argv[1]).release.runtime' "$W/sources.json")"
step() { printf '\n\033[1;32m>> %s\033[0m\n' "$*"; }

step "1/3 rebuild and rebake for $RID (runtime $RUNTIME)"
"$W/build.sh"

step "2/3 Playwright's Chromium (once)"
npx --prefix "$W/site" playwright install chromium-headless-shell

step "3/3 every sheet in Chrome against native Lean"
# The check fails while any sheet differs from native; on this release some do (the browser's
# stack limit, website/README.md), so its result is reported, not treated as a failed adoption.
rc=0; "$W/build.sh" --lanes chrome-check || rc=$?
summary="$W/out/check/chrome/summary.json"
[ -f "$summary" ] || { echo "the Chrome check wrote no summary (exit $rc): see its output above" >&2; exit 1; }
node -e '
  const s = require(process.argv[1]);
  const equal = s.results.filter((r) => r.ok).length, deaths = s.results.reduce((n, r) => n + r.deaths, 0);
  const stack = s.results.reduce((n, r) => n + r.onlyChrome.filter((m) => /stack is exhausted|nested error/.test(m.text)).length, 0);
  console.log(`Chrome: ${equal}/${s.results.length} sheets equal to native Lean, ${stack} "stack is exhausted" errors, ${deaths} Lean deaths`);
  if (deaths) { console.log("Lean died on: " + s.results.filter((r) => r.deaths).map((r) => r.sheet).join(", ")); process.exit(1); }
' "$summary"

cat <<EOF

Adopted $RID. Expected on this release (measured 2026-10-16): 15/28 sheets equal to native in
Chrome, about 42 "stack is exhausted" errors, no deaths; a few sheets flip between runs.
Next: website/scripts/publish-prebuilt.sh, then website/site/scripts/deploy.sh (each has --dry-run).
EOF
