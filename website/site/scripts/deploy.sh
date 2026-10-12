#!/usr/bin/env bash
# Deploy the site to Cloudflare: the course snapshots to R2, then the Worker with the built page.
#
#   website/site/scripts/deploy.sh [--dry-run]
#
# Needs: rclone with a remote for the R2 account (RCLONE_REMOTE, default "qed64-r2"; the same
# remote QED64's scripts/upload-artifacts.sh uses), and wrangler logged in to that account
# (npx wrangler@4.125.0 login). The toolchain release must already be in the bucket under
# lean4-wasm64/<release id>/ (its owner uploads it once; every site on that release shares it):
# the script refuses to deploy otherwise. The account, the bucket (here and in wrangler.toml) and
# the remote are the site owner's: anyone else deploys to their own, with their own names.
set -euo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$SITE/../out"
REMOTE="${RCLONE_REMOTE:-qed64-r2}"
BUCKET="qed64-artifacts"
PREFIX="proof-sheets/"
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY="--dry-run"
WRANGLER="wrangler@4.125.0"
RID="$(node -p 'require(process.argv[1]).id' "$SITE/edge/lean4-wasm64-release.json")"
RUNTIME="$(node -p 'require(process.argv[1]).runtime.buildId' "$SITE/edge/lean4-wasm64-release.json")"
INDEX="$OUT/staging/snapshots/index.json"

[ -f "$INDEX" ] || { echo "no $INDEX: run website/build.sh first" >&2; exit 2; }
# Every snapshot must be paired with the release's runtime (QED64 refuses an unpaired one).
node -e '
  const ix = require(process.argv[1]), want = process.argv[2];
  const bad = ix.snapshots.filter((e) => e.runtime !== want).map((e) => e.name);
  if (bad.length) { console.error("snapshots not baked against " + want + ": " + bad.join(", ")); process.exit(1); }
  console.log(ix.snapshots.length + " snapshots, all paired with " + want);
' "$INDEX" "$RUNTIME"
rclone lsf "$REMOTE:$BUCKET/lean4-wasm64/$RID/release.json" >/dev/null 2>&1 \
  || { echo "lean4-wasm64/$RID/ is not in $REMOTE:$BUCKET (or R2 is unreachable): the release owner uploads it first" >&2; exit 3; }

( cd "$SITE" && npm run -s build:site )
# Digest-named regions first, the index last: a page never sees an index naming a missing region.
# (QED64's per-build index copies and the bake's lock file stay home: this page reads neither.)
rclone copy $DRY --exclude index.json --exclude 'index.*.json' --exclude '*.lock' "$OUT/staging/snapshots" "$REMOTE:$BUCKET/${PREFIX}snapshots"
rclone copyto $DRY "$INDEX" "$REMOTE:$BUCKET/${PREFIX}snapshots/index.json"
if [ -n "$DRY" ]; then (cd "$SITE" && npx --yes "$WRANGLER" deploy --dry-run); else (cd "$SITE" && npx --yes "$WRANGLER" deploy); fi
