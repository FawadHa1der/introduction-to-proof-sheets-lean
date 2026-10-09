#!/usr/bin/env bash
# Publish the baked environments as a GitHub release of this repository, so that anyone can run
# the site without the full build (website/build.sh --prebuilt), and pin them in sources.json.
#
#   website/scripts/publish-prebuilt.sh [--dry-run] [tag]
#
# Run it after a full build (website/build.sh), from a pushed commit. It packs
# website/out/staging/snapshots and out/plan/entries.json into website/out/prebuilt
# (scripts/prebuilt.mjs pack: every entry must have passed the bake lane's browser check),
# creates the release <tag> (default website-prebuilt-<runtime>-<inputs>) on the origin
# repository (PREBUILT_REPO=<owner>/<name> to choose another) with the GitHub CLI (gh, logged
# in), uploads the files (~3.6 GB), and writes the release URL and the digest of prebuilt.json
# into website/sources.json (prebuilt). Commit sources.json afterwards. --dry-run packs and
# prints what it would do.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$W/out"
DRY=0; [ "${1:-}" = "--dry-run" ] && { DRY=1; shift; }
RID="$(node -p 'require(process.argv[1]).release.id' "$W/sources.json")"
RUNTIME="$(node -p 'require(process.argv[1]).release.runtime' "$W/sources.json")"

packed="$(node "$W/scripts/prebuilt.mjs" pack --out "$OUT" --dest "$OUT/prebuilt" --release "$RID" --runtime "$RUNTIME")"
DIGEST="$(node -p 'JSON.parse(process.argv[1]).digest' "$packed")"
INPUTS="$(node -p 'JSON.parse(process.argv[1]).inputs.slice(7, 17)' "$packed")"
TAG="${1:-website-prebuilt-${RUNTIME#wasm64-}-$INPUTS}"
if [ -n "${PREBUILT_REPO:-}" ]; then GH_REPO="$PREBUILT_REPO"; else
  GH_REPO="$(git -C "$W" remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
fi
COMMIT="$(git -C "$W" rev-parse HEAD)"
FROM="https://github.com/$GH_REPO/releases/download/$TAG/"
echo "release $TAG on $GH_REPO at ${COMMIT:0:12}: $(ls "$OUT/prebuilt" | wc -l | tr -d ' ') files, prebuilt.json $DIGEST"
if [ "$DRY" = 1 ]; then echo "(dry run: nothing uploaded; sources.json unchanged)"; ls -l "$OUT/prebuilt"; exit 0; fi
command -v gh >/dev/null || { echo "the GitHub CLI (gh) is required" >&2; exit 2; }
gh release create "$TAG" --repo "$GH_REPO" --target "$COMMIT" --prerelease \
  --title "Prebuilt environments ($RID, $RUNTIME)" \
  --notes "The proof sheets' baked Lean environments for website/build.sh --prebuilt: $RID, runtime $RUNTIME, course inputs $INPUTS, made at $COMMIT. prebuilt.json lists every file with its sha256; its own digest is $DIGEST." \
  "$OUT"/prebuilt/*
node -e '
  const fs = require("fs"), [file, from, digest] = process.argv.slice(1);
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  s.prebuilt = { ...s.prebuilt, from, digest };
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
' "$W/sources.json" "$FROM" "$DIGEST"
echo "pinned in website/sources.json: prebuilt.from $FROM, prebuilt.digest $DIGEST — commit it"
