#!/usr/bin/env bash
# Publish the baked environments as a GitHub release of this repository, so that anyone can run
# the site without the full build (website/build.sh --prebuilt), and pin them in sources.json.
#
#   website/scripts/publish-prebuilt.sh [--dry-run] [--tag <tag>]
#
# Run it after a full build (website/build.sh), from a pushed commit whose course inputs are
# committed. It packs website/out/staging/snapshots and out/plan/entries.json into
# website/out/prebuilt (scripts/prebuilt.mjs pack: every entry must have passed the bake lane's
# browser check, and every sheet must have its entry), creates the release <tag> (default
# website-prebuilt-<runtime>-<digest>) on the origin repository (PREBUILT_REPO=<owner>/<name>
# to choose another) with the GitHub CLI (gh, logged in), uploads the files (~3.8 GB), and writes
# the release URL and the digest of prebuilt.json into website/sources.json (prebuilt). Commit
# sources.json afterwards. --dry-run packs and prints what it would do, and changes nothing else.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$W/.." && pwd)"
OUT="$W/out"
DRY=0; TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
RID="$(node -p 'require(process.argv[1]).release.id' "$W/sources.json")"
RUNTIME="$(node -p 'require(process.argv[1]).release.runtime' "$W/sources.json")"
QED64="$(node -p 'require(process.argv[1]).qed64.commit' "$W/sources.json")"
if [ -n "${PREBUILT_REPO:-}" ]; then GH_REPO="$PREBUILT_REPO"; else
  GH_REPO="$(git -C "$REPO" remote get-url origin | sed -E 's#^(ssh://)?(git@|https://)?github\.com[:/]##; s#/$##; s#\.git$##')"
fi
printf '%s' "$GH_REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
  || { echo "cannot tell the GitHub repository from origin ($GH_REPO): set PREBUILT_REPO=<owner>/<name>" >&2; exit 2; }
COMMIT="$(git -C "$REPO" rev-parse HEAD)"
if [ "$DRY" = 0 ]; then
  command -v gh >/dev/null || { echo "the GitHub CLI (gh) is required" >&2; exit 2; }
  # The release names the commit the environments were made from: its inputs must be in it.
  [ -z "$(git -C "$REPO" status --porcelain -- Bewijzen Bewijzen.lean lakefile.toml website/patches website/scripts website/sources.json)" ] \
    || { echo "the course inputs have uncommitted changes (git status): commit them first" >&2; exit 2; }
  [ -n "$(git -C "$REPO" branch -r --contains "$COMMIT" 2>/dev/null)" ] \
    || { echo "HEAD (${COMMIT:0:12}) is not on any remote branch: push it first" >&2; exit 2; }
fi

packed="$(node "$W/scripts/prebuilt.mjs" pack --out "$OUT" --dest "$OUT/prebuilt" --release "$RID" --runtime "$RUNTIME" --qed64 "$QED64")"
DIGEST="$(node -p 'JSON.parse(process.argv[1]).digest' "$packed")"
INPUTS="$(node -p 'JSON.parse(process.argv[1]).inputs.slice(7, 19)' "$packed")"
TAG="${TAG:-website-prebuilt-${RUNTIME#wasm64-}-${DIGEST:7:12}}"
FROM="https://github.com/$GH_REPO/releases/download/$TAG/"
echo "release $TAG on $GH_REPO at ${COMMIT:0:12}: $(ls "$OUT/prebuilt" | wc -l | tr -d ' ') files, prebuilt.json $DIGEST"
if [ "$DRY" = 1 ]; then echo "(dry run: nothing uploaded; sources.json unchanged)"; ls -l "$OUT/prebuilt"; exit 0; fi
gh release create "$TAG" --repo "$GH_REPO" --target "$COMMIT" --prerelease \
  --title "Prebuilt environments ($RID, $RUNTIME)" \
  --notes "The proof sheets' baked Lean environments for website/build.sh --prebuilt: $RID, runtime $RUNTIME, QED64 ${QED64:0:12}, course inputs $INPUTS, made at $COMMIT. prebuilt.json lists every file with its sha256; its own digest is $DIGEST." \
  "$OUT"/prebuilt/*
node -e '
  const fs = require("fs"), [file, from, digest, tag] = process.argv.slice(1);
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  s.prebuilt = { note: `The baked, browser-checked environments, published as the GitHub release ${tag} by website/scripts/publish-prebuilt.sh, for website/build.sh --prebuilt.`, from, digest };
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
' "$W/sources.json" "$FROM" "$DIGEST" "$TAG"
echo "pinned in website/sources.json: prebuilt.from $FROM, prebuilt.digest $DIGEST — commit it"
