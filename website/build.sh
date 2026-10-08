#!/usr/bin/env bash
# Build the proof-sheets website: the course on Lean 4.34 in the browser (QED64, the toolchain
# release's wasm64 runtime) with the Waterproof editor, faithfully: Lean elaborates each sheet's
# Verso file itself, in an environment baked from exactly that sheet's imports.
#
#   website/build.sh                      every lane, in order
#   website/build.sh --lanes compile,check-native
#   website/build.sh --plan               print the lanes and their commands, run nothing
#
# Lanes:
#   sources       the forks (upstream + website/patches/<fork>/*.patch) in website/forks/, and the
#                 pinned dependencies in website/out/src/ (website/sources.json)
#   release       the toolchain release (sources.json release): fetched and verified with its own
#                 tools; the runtime artifact, the native compiler, and the library packs unpacked
#                 into olean trees (fat, to compile against; slim, to bake on)
#   compile       the olean overlay: Verso, SubVerso, MD4Lean, Illuminate, WaterproofGenre,
#                 Verbose, the course's Customlib and the three Mathlib modules the packs lack,
#                 compiled by the release's native compiler in Docker (scripts/compile.py)
#   check-native  every sheet elaborated natively; errors only in exercise holes, apart from the
#                 known content issues (expected/known-issues.json); out/check/native434/
#   plan          the bake tree (slim packs + overlay) and the snapshot entries: one per distinct
#                 ordered import closure (scripts/plan-entries.mjs → out/plan/entries.json)
#   bake          the init snapshot and every entry, against the release's runtime; after each,
#                 its sheets run through the browser's FileWorker (scripts/browser-check.mjs) and
#                 must give native Lean's messages exactly; then the raw region is deleted
#                 (KEEP_RAW=1 keeps it) to save disk
#   site          the web page (website/site): npm ci, stage, type-check, vite build
#
# Environment:
#   RELEASE_FROM   where the release is fetched from: its GitHub download URL (default, from
#                  sources.json) or a local release directory in the served layout
#   QED64_DIR      a QED64 checkout at sources.json's commit, for the bake and probe pipeline
#                  (default: the site's installed package, website/site/node_modules/qed64)
#   JOBS           parallel compiles (default 3; Docker needs ~3 GB per Mathlib-importing one)
#   KEEP_RAW       1: keep each entry's raw .snap in out/bake-work after its browser check
#
# Requirements: Docker that runs linux/arm64 (native on Apple silicon), Node 24+, python3, git,
# ~40 GB of free disk for a full run (~25 GB once out/trees and out/build exist).
set -euo pipefail

W="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$W/.." && pwd)"
OUT="$W/out"
LANES="sources,release,compile,check-native,plan,bake,site"
PLAN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --lanes) LANES="$2"; shift 2 ;;
    --plan) PLAN=1; shift ;;
    -h|--help) awk 'NR > 1 { if (/^set -euo/) exit; print }' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
for l in ${LANES//,/ }; do
  case "$l" in sources|release|compile|check-native|plan|bake|site) ;; *) echo "unknown lane: $l" >&2; exit 2 ;; esac
done

say()  { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }
lane_on() { case ",$LANES," in *,"$1",*) return 0 ;; *) return 1 ;; esac; }
run() { if [ "$PLAN" = 1 ]; then printf '   $ %s\n' "$*"; else "$@"; fi; }
json() { node -p "const v = require('$W/sources.json')$1; typeof v === 'string' ? v : JSON.stringify(v)"; }

RID="$(json .release.id)"; RDIGEST="$(json .release.digest)"; RUNTIME="$(json .release.runtime)"
RELEASE_FROM="${RELEASE_FROM:-$(json .release.from)}"
PACKS="$(node -p "require('$W/sources.json').release.packs.join(' ')")"
LEAN="$OUT/native64/bin/lean"
L4W="$OUT/tools/package/cli.mjs"
ART="$OUT/release/artifact"
LEAN_OPTS_CSV="$(node --input-type=module -e "
  const { leanOptions } = await import('$W/site/scripts/stage.mjs');
  console.log(Object.entries(leanOptions()).map(([k, v]) => '-D' + k + '=' + v).join(','));
")"
QED64_DIR="${QED64_DIR:-$W/site/node_modules/qed64}"
mkdir -p "$OUT/logs"

# ------------------------------------------------------------------------------- sources --
lane_sources() {
  say "sources: forks (upstream + patches) and pinned dependencies"
  local name upstream base want have
  for name in $(node -p "Object.keys(require('$W/sources.json').forks).join(' ')"); do
    upstream="$(json ".forks['$name'].upstream")"; base="$(json ".forks['$name'].base")"
    local dir="$W/forks/$name" patches=("$W"/patches/"$name"/*.patch)
    [ -e "${patches[0]}" ] || patches=()
    if [ ! -d "$dir/.git" ]; then
      run git clone -q "$upstream" "$dir"
      run git -C "$dir" checkout -q -b "$(json ".forks['$name'].branch")" "$base"
      [ ${#patches[@]} -eq 0 ] || run git -C "$dir" am -q "${patches[@]}"
    fi
    [ "$PLAN" = 1 ] && continue
    # The checkout must be exactly base + patches (an older port or a stray edit is refused).
    want="$(cd "$dir" && tmp="$(mktemp -d)" && GIT_INDEX_FILE="$tmp/i" git read-tree "$base" \
      && for p in ${patches[@]+"${patches[@]}"}; do GIT_INDEX_FILE="$tmp/i" git apply --cached "$p" || exit 1; done \
      && GIT_INDEX_FILE="$tmp/i" git write-tree; rm -rf "$tmp")" || die "$name: the patches do not apply to $base"
    have="$(git -C "$dir" rev-parse 'HEAD^{tree}')"
    [ "$want" = "$have" ] || die "$name: website/forks/$name is not $base + website/patches/$name (tree ${have:0:12}, expected ${want:0:12}); commit and re-export the patches (git format-patch $base..HEAD), or delete the checkout"
    [ -z "$(git -C "$dir" status --porcelain --untracked-files=no -- '*.lean')" ] || die "$name: uncommitted Lean edits in website/forks/$name"
    note "$name: $base + ${#patches[@]} patch(es) ✓"
  done
  local url rev
  for name in $(node -p "Object.keys(require('$W/sources.json').deps).join(' ')"); do
    url="$(json ".deps['$name'].url")"; rev="$(json ".deps['$name'].rev")"
    local dir="$OUT/src/$name"
    if [ ! -d "$dir/.git" ]; then
      run mkdir -p "$dir"
      run git -C "$dir" init -q
      run git -C "$dir" remote add origin "$url"
      run git -C "$dir" fetch -q --depth 1 origin "$rev"
      run git -C "$dir" checkout -q FETCH_HEAD
    fi
    [ "$PLAN" = 1 ] || [ "$(git -C "$dir" rev-parse HEAD)" = "$rev" ] || die "$name: out/src/$name is not at $rev"
    [ "$PLAN" = 1 ] || note "$name @ ${rev:0:12} ✓"
  done
}

# ------------------------------------------------------------------------------- release --
lane_release() {
  say "release: $RID from $RELEASE_FROM (runtime $RUNTIME)"
  local mirror="$OUT/release/mirror"
  if [ ! -f "$L4W" ]; then
    # The release's own tools verify everything else; they are themselves fetched by digest.
    run mkdir -p "$OUT/tools" "$mirror/tools"
    # (release.json is checked against the pinned digest by the fetch below; the tgz here
    # against the sha256 that release.json lists for it.)
    run node -e "
      const [from, out, digest] = process.argv.slice(1);
      const crypto = require('crypto'), fs = require('fs'), path = require('path');
      const flat = /^https?:/.test(from);
      const get = async (p) => flat ? Buffer.from(await (await fetch(from.replace(/\/?$/, '/') + path.basename(p))).arrayBuffer()) : fs.readFileSync(path.join(from, p));
      (async () => {
        const rec = JSON.parse(await get('release.json'));
        if (rec.digest !== digest) throw new Error('release.json digest ' + rec.digest + ', pinned ' + digest);
        const tgz = await get(rec.tools.tgz);
        const want = rec.files.find((f) => f.path === rec.tools.tgz).sha256;
        const have = crypto.createHash('sha256').update(tgz).digest('hex');
        if (have !== want) throw new Error(rec.tools.tgz + ': sha256 ' + have + ', release.json says ' + want);
        fs.writeFileSync(out, tgz);
      })().catch((e) => { console.error(e.message); process.exit(1); });
    " "$RELEASE_FROM" "$mirror/tools/tools.tgz" "$RDIGEST"
    run tar xzf "$mirror/tools/tools.tgz" -C "$OUT/tools"
  fi
  # The runtime (manifest + chunks) stays in the mirror: the dev and preview servers serve it.
  run node "$L4W" fetch --from "$RELEASE_FROM" --id "$RID" --digest "$RDIGEST" --out "$mirror" --only runtime-chunks
  run node "$L4W" fetch --from "$mirror" --id "$RID" --digest "$RDIGEST" --out "$ART" --only runtime
  if [ "$PLAN" = 0 ]; then
    local got; got="$(node "$L4W" id "$ART" | grep -Eo 'wasm64-[0-9a-f]{16}' | head -1)"
    [ "$got" = "$RUNTIME" ] || die "the runtime rebuilt from the release is $got, sources.json pins $RUNTIME"
    note "runtime $got ✓"
  fi
  # The native compiler and the library packs are fetched (verified) only to be unpacked, and
  # then dropped from the mirror (KEEP_MIRROR=1 keeps them): ~2.5 GB the build never reads again.
  if [ ! -x "$LEAN" ]; then
    run node "$L4W" fetch --from "$RELEASE_FROM" --id "$RID" --digest "$RDIGEST" --out "$mirror" --only native64
    run mkdir -p "$OUT/native64"
    run tar xzf "$mirror/native64/native64.tar.gz" -C "$OUT/native64"
    [ "${KEEP_MIRROR:-0}" = 1 ] || run rm -rf "$mirror/native64"
  fi
  if [ ! -f "$OUT/trees/.unpacked" ]; then
    run node "$L4W" fetch --from "$RELEASE_FROM" --id "$RID" --digest "$RDIGEST" --out "$mirror" --only "${PACKS// /,}"
    run rm -rf "$OUT/trees"
    for p in $PACKS; do
      run node "$L4W" unpack --manifest "$mirror/profiles/$p.manifest.json" --out "$OUT/trees/fat"
      run node "$L4W" unpack --manifest "$mirror/profiles/$p.manifest.json" --out "$OUT/trees/slim" --slim
      [ "${KEEP_MIRROR:-0}" = 1 ] || run find "$mirror/profiles" -name "$p.pack.*.part-*" -delete
    done
    run touch "$OUT/trees/.unpacked"
  fi
}

# ------------------------------------------------------------------------------- compile --
all_roots() {
  local verbose customlib
  verbose="$(cd "$W/forks/verbose-lean4" && find Verbose -name '*.lean' | sed 's/\.lean$//; s#/#.#g' | sort | paste -sd, -)"
  customlib="$(cd "$REPO" && ls Bewijzen/Customlib/*.lean | sed 's/\.lean$//; s#/#.#g' | paste -sd, -)"
  echo "WaterproofGenre,$verbose,Bewijzen.Customlib,$customlib"
}
lane_compile() {
  say "compile: the olean overlay with the release's native compiler"
  run "$W/scripts/overlay.sh" "$(all_roots)" -j "${JOBS:-3}" --heavy-jobs 2
}

# -------------------------------------------------------------------------- check-native --
lane_check_native() {
  say "check-native: every sheet, natively (errors only in exercise holes)"
  run python3 "$W/scripts/check-preambles.py"
  run "$W/scripts/in-docker.sh" python3 "$W/scripts/check-sheets.py" --lean "$LEAN" \
    --lean-path "$OUT/build/lib:$OUT/build/fill:$OUT/trees/fat" --out "$OUT/check/native434" \
    --opts="$LEAN_OPTS_CSV" --known "$W/expected/known-issues.json" -j 2
}

# ---------------------------------------------------------------------------------- plan --
lane_plan() {
  say "plan: the bake tree and one snapshot entry per distinct ordered import closure"
  run python3 "$W/scripts/bake-tree.py" "$OUT/trees/slim" "$OUT/build/lib" "$OUT/build/fill" "$OUT/bake-tree"
  run node "$W/scripts/plan-entries.mjs" --tree "$OUT/bake-tree" --out "$OUT/plan/entries.json"
}

# ---------------------------------------------------------------------------------- bake --
bake() { # bake <name> <probe source> [extra bake-snapshot flags...]
  local name="$1" probe="$2"; shift 2
  run node --stack-size=8192 "$QED64_DIR/pipeline/snapshot/bake-snapshot.mjs" --name "$name" --probe "$probe" \
    --artifact "$ART" --lib "$OUT/bake-tree" --work "$OUT/bake-work" --out "$OUT/staging/snapshots" "$@"
}
lane_bake() {
  say "bake: init and every entry against runtime $RUNTIME, each checked through the browser's FileWorker"
  local plan="$OUT/plan/entries.json"
  [ "$PLAN" = 1 ] || [ -f "$plan" ] || die "no $plan: run the plan lane first"
  run mkdir -p "$OUT/bake-work" "$OUT/staging/snapshots" "$OUT/check/browser"
  if [ "$PLAN" = 1 ] || ! node -e "process.exit(require('$OUT/staging/snapshots/index.json').snapshots.some(e => e.name === 'init' && e.runtime === '$RUNTIME') ? 0 : 1)" 2>/dev/null; then
    bake init "#check (2 + 2 : Nat)"
  fi
  [ "$PLAN" = 1 ] && { note "then, per entry of $plan: bake, browser-check its sheets against out/check/native434, delete the raw region"; return 0; }
  local opts=(); IFS=, read -r -a o <<< "$LEAN_OPTS_CSV"; for x in "${o[@]}"; do opts+=(--opt "${x#-D}"); done
  node -e "for (const e of require('$plan').entries) console.log([e.name, e.imports.join(' '), e.roots.join(','), e.label, e.sheets.join(' ')].join('\t'))" |
  while IFS=$'\t' read -r name imports roots label sheets; do
    local digest
    if node -e "process.exit(require('$OUT/staging/snapshots/index.json').snapshots.some(e => e.name === '$name' && e.runtime === '$RUNTIME') ? 0 : 1)" 2>/dev/null \
       && [ -f "$OUT/check/browser/.$name.ok" ]; then
      note "$name: baked and checked already"; continue
    fi
    note "$name: $label — imports $imports"
    bake "$name" "$(printf 'import %s\n' $imports)#check (2 + 2 : Nat)" --roots "$roots" --label "$label" --allow-legacy-imports \
      > "$OUT/logs/bake-$name.log" 2>&1 || { tail -20 "$OUT/logs/bake-$name.log"; die "bake of $name failed"; }
    grep -E "^baked " "$OUT/logs/bake-$name.log" | sed 's/^/   /'
    local s ok=1
    for s in $sheets; do
      local file; file="$REPO/Bewijzen/$(echo "$s" | sed 's#\.#/#').lean"
      node --stack-size=8192 "$W/scripts/browser-check.mjs" --qed64 "$QED64_DIR" --artifact "$ART" --lib "$OUT/bake-tree" \
        --snap-dir "$OUT/bake-work" --snapshots "init,$name" --sheet "$file" --out "$OUT/check/browser/$s.json" "${opts[@]}" \
        > "$OUT/logs/browser-$s.log" 2>&1 || { tail -5 "$OUT/logs/browser-$s.log"; ok=0; continue; }
      mkdir -p "$OUT/check/pair" && rm -f "$OUT/check/pair"/*.json
      cp "$OUT/check/native434/$s.json" "$OUT/check/pair/" 2>/dev/null || { note "  $s: no native result to compare (run check-native)"; ok=0; continue; }
      mkdir -p "$OUT/check/pair-b" && rm -f "$OUT/check/pair-b"/*.json && cp "$OUT/check/browser/$s.json" "$OUT/check/pair-b/"
      if python3 "$W/scripts/compare-checks.py" "$OUT/check/pair" "$OUT/check/pair-b" --label-a native --label-b browser > "$OUT/logs/compare-$s.log"; then
        note "  $s: browser = native ($(node -p "const r=require('$OUT/check/browser/$s.json'); r.messages.length + ' messages, ' + r.elaborationSeconds + ' s'"))"
      else
        cat "$OUT/logs/compare-$s.log"; ok=0
      fi
    done
    [ "$ok" = 1 ] || die "$name: a sheet's browser messages differ from native Lean's (logs above)"
    touch "$OUT/check/browser/.$name.ok"
    [ "${KEEP_RAW:-0}" = 1 ] || rm -f "$OUT/bake-work/$name.snap" "$OUT/bake-work/$name.snap.deps"
  done
}

# ---------------------------------------------------------------------------------- site --
lane_site() {
  say "site: stage, type-check and build website/site"
  ( cd "$W/site" && run npm ci --no-audit --no-fund && run npm run -s build:site )
}

lane_on sources && lane_sources
lane_on release && lane_release
lane_on compile && lane_compile
lane_on check-native && lane_check_native
lane_on plan && lane_plan
lane_on bake && lane_bake
lane_on site && lane_site
say "done ($LANES)"
