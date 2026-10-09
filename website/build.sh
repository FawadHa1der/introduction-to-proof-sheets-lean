#!/usr/bin/env bash
# Build the proof-sheets website: the course on Lean 4.34 in the browser (QED64, the toolchain
# release's wasm64 runtime) with the Waterproof editor, faithfully: Lean elaborates each sheet's
# Verso file itself, in an environment baked from exactly that sheet's imports.
#
#   website/build.sh                      every lane of the full build, in order (~2 h)
#   website/build.sh --prebuilt           the quick path: the runtime and the published prebuilt
#                                         environments instead of compiling and baking (minutes)
#   website/build.sh --lanes compile,check-native
#   website/build.sh --plan               print the lanes and their commands, run nothing
#
# Lanes (the full build runs all but fetch; --prebuilt is release,fetch,site):
#   sources       the forks (upstream + website/patches/<fork>/*.patch) in website/forks/, the
#                 pinned dependencies in website/out/src/ (website/sources.json), and the site's
#                 npm packages (website/site/node_modules, QED64 among them)
#   release       the toolchain release (sources.json release): fetched and verified with its own
#                 tools; the runtime artifact, and (when a later lane compiles, checks or plans)
#                 the native compiler and the library packs unpacked into olean trees (fat, to
#                 compile against; slim, to bake on)
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
#   fetch         instead of compile..bake: the prebuilt snapshots and plan that
#                 scripts/publish-prebuilt.sh published (sources.json prebuilt), verified
#   site          the web page (website/site): stage, type-check, vite build
#
# Environment:
#   RELEASE_FROM   where the release is fetched from: its GitHub download URL (default, from
#                  sources.json) or a local release directory in the served layout
#   PREBUILT_FROM, PREBUILT_DIGEST
#                  the fetch lane's source (URL or directory) and the sha256 of its prebuilt.json
#                  (default: sources.json prebuilt)
#   QED64_DIR      a QED64 checkout at sources.json's commit, for the bake and probe pipeline
#                  (default: the site's installed package, website/site/node_modules/qed64)
#   JOBS           parallel compiles (default 3; Docker needs ~3 GB per Mathlib-importing one;
#                  JOBS=1 on a machine with less than 16 GB)
#   KEEP_RAW       1: keep each entry's raw .snap in out/bake-work after its browser check
#   KEEP_MIRROR    1: keep the downloaded compiler and pack parts in out/release/mirror (~2.5 GB)
#   DOCKER_USER    see scripts/in-docker.sh
#
# Requirements (website/README.md has the details): Node 24+, git, and for the full build
# python3, Docker that runs linux/arm64 (native on Apple silicon and arm64 Linux; emulated
# elsewhere), 16 GB of memory and ~20 GB of free disk. The quick path needs Node and ~4 GB.
set -euo pipefail

W="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$W/.." && pwd)"
OUT="$W/out"
LANES="sources,release,compile,check-native,plan,bake,site"
PLAN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --lanes) LANES="$2"; shift 2 ;;
    --prebuilt) LANES="release,fetch,site"; shift ;;
    --plan) PLAN=1; shift ;;
    -h|--help) awk 'NR > 1 { if (/^set -euo/) exit; print }' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
for l in ${LANES//,/ }; do
  case "$l" in sources|release|compile|check-native|plan|bake|fetch|site) ;; *) echo "unknown lane: $l" >&2; exit 2 ;; esac
done

say()  { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }
lane_on() { case ",$LANES," in *,"$1",*) return 0 ;; *) return 1 ;; esac; }
run() { if [ "$PLAN" = 1 ]; then printf '   $ %s\n' "$*"; else "$@"; fi; }
# json <expression on the parsed sources.json>: a string as is, anything else as JSON, nothing
# for undefined. Paths reach node as arguments, never inside the script text.
json() { node -e 'const v = (0, eval)("(s) => s" + process.argv[2])(require(process.argv[1])); if (v !== undefined && v !== null) console.log(typeof v === "string" ? v : JSON.stringify(v))' "$W/sources.json" "$1"; }

# ------------------------------------------------------------------------------ preflight --
command -v node >/dev/null || die "Node.js 24 or later is required (no node on PATH)"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || die "Node.js 24 or later is required (this is $(node --version))"
command -v git >/dev/null || die "git is required"
FULL=0; for l in compile check-native plan bake; do lane_on "$l" && FULL=1; done
if [ "$PLAN" = 0 ] && [ "$FULL" = 1 ]; then
  command -v python3 >/dev/null || die "python3 is required by the compile, check-native, plan and bake lanes"
fi
if [ "$PLAN" = 0 ] && { lane_on compile || lane_on check-native; }; then
  docker info >/dev/null 2>&1 || die "the compile and check-native lanes need Docker (docker info failed: is it installed and running?)"
fi

RID="$(json .release.id)"; RDIGEST="$(json .release.digest)"; RUNTIME="$(json .release.runtime)"
RELEASE_FROM="${RELEASE_FROM:-$(json .release.from)}"
PACKS="$(json ".release.packs.join(' ')")"
LEAN="$OUT/native64/bin/lean"
L4W="$OUT/tools/package/cli.mjs"
ART="$OUT/release/artifact"
# (stage.mjs's path goes by the environment: as process.argv[1] it would run its own main.)
LEAN_OPTS_CSV="$(STAGE_MJS="$W/site/scripts/stage.mjs" node --input-type=module -e '
  const { pathToFileURL } = await import("node:url");
  const { leanOptions } = await import(pathToFileURL(process.env.STAGE_MJS).href);
  console.log(Object.entries(leanOptions()).map(([k, v]) => "-D" + k + "=" + v).join(","));
')"
QED64_DIR="${QED64_DIR:-$W/site/node_modules/qed64}"
# One QED64 pin: sources.json's commit is the one the site's lockfile resolves.
QED64_PIN="$(json .qed64.commit)"
LOCKED="$(node -p '(require(process.argv[1]).packages?.["node_modules/qed64"]?.resolved ?? "").split("#")[1] ?? "none"' "$W/site/package-lock.json")"
[ "$LOCKED" = "$QED64_PIN" ] || die "sources.json pins QED64 $QED64_PIN but website/site/package-lock.json resolves $LOCKED: change both together"
PREBUILT_FROM="${PREBUILT_FROM:-$(json '.prebuilt?.from')}"; PREBUILT_DIGEST="${PREBUILT_DIGEST:-$(json '.prebuilt?.digest')}"
if lane_on fetch && [ "$PLAN" = 0 ] && { [ -z "$PREBUILT_FROM" ] || [ -z "$PREBUILT_DIGEST" ]; }; then
  die "no prebuilt environments are pinned in website/sources.json (prebuilt.from, prebuilt.digest): they are not published yet. Run the full build (website/build.sh), or set PREBUILT_FROM and PREBUILT_DIGEST"
fi
run mkdir -p "$OUT/logs"

# The site's npm packages, from the lockfile: the page's dependencies and the default QED64_DIR.
# Installed again only when the lockfile is newer than the installed tree.
site_deps() {
  local stamp="$W/site/node_modules/.package-lock.json"
  if [ "$PLAN" = 1 ] || [ ! -f "$stamp" ] || [ "$W/site/package-lock.json" -nt "$stamp" ]; then
    run npm --prefix "$W/site" ci --no-audit --no-fund
  fi
}

# ------------------------------------------------------------------------------- sources --
# Git for the forks and dependencies, with none of the user's configuration that could change
# what is checked out or stop it (hooks, line endings, whitespace fixing); `git am` with a fixed
# identity, so the forks' commits are the same on every machine and nothing needs configuring.
GITX=(git -c core.hooksPath=/dev/null -c core.autocrlf=false -c core.eol=lf -c apply.whitespace=nowarn -c advice.detachedHead=false)
GIT_AM=(env GIT_COMMITTER_NAME="proof-sheets build" GIT_COMMITTER_EMAIL=build@localhost
  "${GITX[@]}" -c user.name="proof-sheets build" -c user.email=build@localhost -c commit.gpgSign=false -c i18n.commitEncoding=UTF-8)
lane_sources() {
  say "sources: forks (upstream + patches), pinned dependencies, the site's npm packages"
  local name upstream base want have
  for name in $(json ".forks && Object.keys(s.forks).join(' ')"); do
    upstream="$(json ".forks['$name'].upstream")"; base="$(json ".forks['$name'].base")"
    local dir="$W/forks/$name" patches=("$W"/patches/"$name"/*.patch)
    [ -e "${patches[0]}" ] || patches=()
    if [ ! -e "$dir/.git" ]; then
      # Made aside and moved into place when complete: an interrupted run leaves no half fork.
      [ "$PLAN" = 1 ] || [ ! -e "$dir" ] || rmdir "$dir" 2>/dev/null || die "website/forks/$name exists but is not a git checkout: delete it to re-create it from the patches"
      run rm -rf "$dir.tmp"
      run "${GITX[@]}" clone -q --config core.autocrlf=false "$upstream" "$dir.tmp"
      # The base may sit on a branch upstream no longer has: GitHub still serves it by id.
      [ "$PLAN" = 1 ] || git -C "$dir.tmp" cat-file -e "$base^{commit}" 2>/dev/null || run "${GITX[@]}" -C "$dir.tmp" fetch -q origin "$base"
      run "${GITX[@]}" -C "$dir.tmp" checkout -q -b "$(json ".forks['$name'].branch")" "$base"
      [ ${#patches[@]} -eq 0 ] || run "${GIT_AM[@]}" -C "$dir.tmp" am -q --committer-date-is-author-date "${patches[@]}"
      run mv "$dir.tmp" "$dir"
    fi
    [ "$PLAN" = 1 ] && continue
    # The checkout must be exactly base + patches (an older port or a stray edit is refused).
    local tmp; tmp="$(mktemp -d)"
    want="$(cd "$dir" && GIT_INDEX_FILE="$tmp/i" git read-tree "$base" \
      && for p in ${patches[@]+"${patches[@]}"}; do GIT_INDEX_FILE="$tmp/i" "${GITX[@]}" apply --cached "$p" || exit 1; done \
      && GIT_INDEX_FILE="$tmp/i" git write-tree)" || { rm -rf "$tmp"; die "$name: the patches do not apply to $base"; }
    rm -rf "$tmp"
    have="$(git -C "$dir" rev-parse 'HEAD^{tree}')"
    [ "$want" = "$have" ] || die "$name: website/forks/$name is not $base + website/patches/$name (tree ${have:0:12}, expected ${want:0:12}). Delete website/forks/$name to re-create it from the patches; if you changed the fork on purpose, commit and re-export the patches (git format-patch $base..HEAD)"
    # (untracked ones too: every .lean file in a fork's tree is compiled)
    [ -z "$(git -C "$dir" status --porcelain --untracked-files=all -- '*.lean')" ] || die "$name: uncommitted or untracked Lean files in website/forks/$name"
    note "$name: $base + ${#patches[@]} patch(es) ✓"
  done
  local url rev
  for name in $(json ".deps && Object.keys(s.deps).join(' ')"); do
    url="$(json ".deps['$name'].url")"; rev="$(json ".deps['$name'].rev")"
    local dir="$OUT/src/$name"
    if [ ! -e "$dir/.git" ]; then
      [ "$PLAN" = 1 ] || [ ! -e "$dir" ] || rmdir "$dir" 2>/dev/null || die "website/out/src/$name exists but is not a git checkout: delete it to fetch it again"
      run rm -rf "$dir.tmp"
      run mkdir -p "$dir.tmp"
      run "${GITX[@]}" -C "$dir.tmp" init -q
      run "${GITX[@]}" -C "$dir.tmp" config core.autocrlf false
      run "${GITX[@]}" -C "$dir.tmp" remote add origin "$url"
      run "${GITX[@]}" -C "$dir.tmp" fetch -q --depth 1 origin "$rev"
      run "${GITX[@]}" -C "$dir.tmp" checkout -q FETCH_HEAD
      run mv "$dir.tmp" "$dir"
    fi
    [ "$PLAN" = 1 ] || [ "$(git -C "$dir" rev-parse HEAD)" = "$rev" ] || die "$name: out/src/$name is not at $rev (delete website/out/src/$name to fetch it again)"
    [ "$PLAN" = 1 ] || note "$name @ ${rev:0:12} ✓"
  done
  site_deps
}

# ------------------------------------------------------------------------------- release --
# Each unpacked piece carries a stamp with the release id, so a release change replaces it. A
# piece without one (made before stamps had ids, or by an interrupted run) is fetched again.
stamped() { [ "$2" = 1 ] && [ -s "$1" ] && [ "$(cat "$1")" = "$RID" ]; } # stamped <stamp file> <piece present?>
lane_release() {
  local mirror="$OUT/release/mirror" toolchain=0 l
  # The native compiler and the packs when a later lane compiles, checks or plans, or when the
  # release lane runs without any later lane (fetching the whole release); not for the quick
  # path or for a bake or a site build on top of an earlier full build.
  for l in compile check-native plan; do lane_on "$l" && toolchain=1; done
  [ "$toolchain" = 1 ] || lane_on fetch || lane_on bake || lane_on site || toolchain=1
  say "release: $RID from $RELEASE_FROM (runtime $RUNTIME$([ "$toolchain" = 1 ] || echo '; runtime only'))"
  if [ "$PLAN" = 1 ] || ! stamped "$OUT/tools/.release" "$([ -f "$L4W" ] && echo 1)"; then
    # The release's own tools verify everything else. They are fetched first, by hand: the
    # release record must be the pinned one (its own digest, recomputed, equal to the pin), and
    # the tools archive must have the sha256 that record lists for it.
    run rm -rf "$OUT/tools"
    run mkdir -p "$OUT/tools" "$mirror/tools"
    run node -e '
      const [from, out, pin] = process.argv.slice(1);
      const crypto = require("crypto"), fs = require("fs"), path = require("path");
      const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
      const flat = /^https?:/.test(from);
      const get = async (p) => {
        if (!flat) return fs.readFileSync(path.join(from, p));
        const url = from.replace(/\/?$/, "/") + path.basename(p), r = await fetch(url);
        if (!r.ok) throw new Error(url + ": HTTP " + r.status);
        return Buffer.from(await r.arrayBuffer());
      };
      (async () => {
        const rec = JSON.parse(await get("release.json"));
        const { digest, ...content } = rec;
        const self = "sha256:" + sha256(JSON.stringify(content, null, 2));
        if (digest !== pin || self !== pin) throw new Error("release.json: digest " + digest + ", content " + self + ", pinned " + pin);
        const tgz = await get(rec.tools.tgz);
        const want = rec.files.find((f) => f.path === rec.tools.tgz).sha256;
        if (sha256(tgz) !== want) throw new Error(rec.tools.tgz + ": sha256 " + sha256(tgz) + ", release.json says " + want);
        fs.writeFileSync(out, tgz);
      })().catch((e) => { console.error(e.message); process.exit(1); });
    ' "$RELEASE_FROM" "$mirror/tools/tools.tgz" "$RDIGEST"
    run tar xzf "$mirror/tools/tools.tgz" -C "$OUT/tools"
    [ "$PLAN" = 1 ] || echo "$RID" > "$OUT/tools/.release"
  fi
  # The runtime (manifest + chunks) stays in the mirror: the dev and preview servers serve it.
  run node "$L4W" fetch --from "$RELEASE_FROM" --id "$RID" --digest "$RDIGEST" --out "$mirror" --only runtime-chunks
  run node "$L4W" fetch --from "$mirror" --id "$RID" --digest "$RDIGEST" --out "$ART" --only runtime
  if [ "$PLAN" = 0 ]; then
    local got; got="$(node "$L4W" id "$ART" | grep -Eo 'wasm64-[0-9a-f]{16}' | head -1 || true)"
    [ "$got" = "$RUNTIME" ] || die "the runtime rebuilt from the release is $got, sources.json pins $RUNTIME"
    note "runtime $got ✓"
  fi
  [ "$toolchain" = 1 ] || return 0
  # The native compiler and the library packs are fetched (verified) only to be unpacked, and
  # then dropped from the mirror (KEEP_MIRROR=1 keeps them): ~2.5 GB the build never reads again.
  if [ "$PLAN" = 1 ] || ! stamped "$OUT/native64/.release" "$([ -x "$LEAN" ] && echo 1)"; then
    run node "$L4W" fetch --from "$RELEASE_FROM" --id "$RID" --digest "$RDIGEST" --out "$mirror" --only native64
    run rm -rf "$OUT/native64" "$OUT/native64.tmp"
    run mkdir -p "$OUT/native64.tmp"
    run tar xzf "$mirror/native64/native64.tar.gz" -C "$OUT/native64.tmp"
    run mv "$OUT/native64.tmp" "$OUT/native64"
    [ "$PLAN" = 1 ] || echo "$RID" > "$OUT/native64/.release"
    [ "${KEEP_MIRROR:-0}" = 1 ] || run rm -rf "$mirror/native64"
  fi
  if [ "$PLAN" = 1 ] || ! stamped "$OUT/trees/.unpacked" "$([ -f "$OUT/trees/.unpacked" ] && echo 1)"; then
    run node "$L4W" fetch --from "$RELEASE_FROM" --id "$RID" --digest "$RDIGEST" --out "$mirror" --only "${PACKS// /,}"
    run rm -rf "$OUT/trees"
    for p in $PACKS; do
      run node "$L4W" unpack --manifest "$mirror/profiles/$p.manifest.json" --out "$OUT/trees/fat"
      run node "$L4W" unpack --manifest "$mirror/profiles/$p.manifest.json" --out "$OUT/trees/slim" --slim
      [ "${KEEP_MIRROR:-0}" = 1 ] || run find "$mirror/profiles" -name "$p.pack.*.part-*" -delete
    done
    [ "$PLAN" = 1 ] || echo "$RID" > "$OUT/trees/.unpacked"
  fi
}

# ------------------------------------------------------------------------------- compile --
all_roots() {
  local verbose customlib
  if [ ! -d "$W/forks/verbose-lean4/Verbose" ]; then
    [ "$PLAN" = 1 ] || die "no website/forks/verbose-lean4: run the sources lane first"
    echo "WaterproofGenre,<Verbose modules>,Bewijzen.Customlib,<Customlib modules>"; return 0
  fi
  verbose="$(cd "$W/forks/verbose-lean4" && find Verbose -name '*.lean' | sed 's/\.lean$//; s#/#.#g' | sort | paste -sd, -)"
  customlib="$(cd "$REPO" && ls Bewijzen/Customlib/*.lean | sed 's/\.lean$//; s#/#.#g' | paste -sd, -)"
  echo "WaterproofGenre,$verbose,Bewijzen.Customlib,$customlib"
}
lane_compile() {
  say "compile: the olean overlay with the release's native compiler"
  run "$W/scripts/overlay.sh" "$(all_roots)" -j "${JOBS:-3}" --heavy-jobs "$([ "${JOBS:-3}" -ge 2 ] && echo 2 || echo 1)"
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
# baked <name>: the staged index has <name>, paired with this runtime.
baked() { node -e 'process.exit(require(process.argv[1]).snapshots.some((e) => e.name === process.argv[2] && e.runtime === process.argv[3]) ? 0 : 1)' "$OUT/staging/snapshots/index.json" "$1" "$RUNTIME" 2>/dev/null; }
lane_bake() {
  say "bake: init and every entry against runtime $RUNTIME, each checked through the browser's FileWorker"
  [ "$QED64_DIR" = "$W/site/node_modules/qed64" ] && site_deps
  [ "$PLAN" = 1 ] || [ -f "$QED64_DIR/pipeline/snapshot/bake-snapshot.mjs" ] \
    || die "no QED64 at $QED64_DIR (npm --prefix website/site ci installs it; or set QED64_DIR to a checkout at $QED64_PIN)"
  if [ "$PLAN" = 0 ] && [ -d "$QED64_DIR/.git" ] && [ "$(git -C "$QED64_DIR" rev-parse HEAD)" != "$QED64_PIN" ]; then
    note "warning: QED64_DIR is at $(git -C "$QED64_DIR" rev-parse --short HEAD), sources.json pins ${QED64_PIN:0:7}"
  fi
  local plan="$OUT/plan/entries.json"
  [ "$PLAN" = 1 ] || [ -f "$plan" ] || die "no $plan: run the plan lane first"
  run mkdir -p "$OUT/bake-work" "$OUT/staging/snapshots" "$OUT/check/browser"
  if [ "$PLAN" = 1 ] || ! baked init; then
    bake init "#check (2 + 2 : Nat)"
  fi
  [ "$PLAN" = 1 ] && { note "then, per entry of $plan: bake, browser-check its sheets against out/check/native434, delete the raw region"; return 0; }
  # Two markers per entry hold what its bake and its check depended on (scripts/fingerprint.mjs):
  # .<entry>.baked the compiled overlay, runtime, QED64 and options; .<entry>.ok that, the staged
  # snapshot, its sheets' text and native messages. A sheet edit re-checks without a rebake.
  fingerprint() { node "$W/scripts/fingerprint.mjs" --out "$OUT" --runtime "$RUNTIME" --qed64 "$QED64_PIN" --opts "$LEAN_OPTS_CSV" --entry "$1" | cut -f"$2"; }
  # inflate <name>: the staged snapshot back into bake-work/<name>.snap, for a check without a bake.
  inflate() {
    local file; file="$(node -p 'require("path").basename(require(process.argv[1]).snapshots.find((e) => e.name === process.argv[2]).url)' "$OUT/staging/snapshots/index.json" "$1")"
    gunzip -c "$OUT/staging/snapshots/$file" > "$OUT/bake-work/$1.snap.tmp" && mv "$OUT/bake-work/$1.snap.tmp" "$OUT/bake-work/$1.snap"
  }
  local opts=() o=() x; [ -z "$LEAN_OPTS_CSV" ] || IFS=, read -r -a o <<< "$LEAN_OPTS_CSV"
  for x in ${o[@]+"${o[@]}"}; do opts+=(--opt "${x#-D}"); done
  node -e 'for (const e of require(process.argv[1]).entries) console.log([e.name, e.imports.join(" "), e.roots.join(","), e.label, e.sheets.join(" ")].join("\t"))' "$plan" |
  while IFS=$'\t' read -r name imports roots label sheets; do
    local bake_fp; bake_fp="$(fingerprint "$name" 2)"
    if baked "$name" && [ "$(cat "$OUT/check/browser/.$name.baked" 2>/dev/null)" = "$bake_fp" ]; then
      if [ "$(cat "$OUT/check/browser/.$name.ok" 2>/dev/null)" = "$(fingerprint "$name" 3)" ]; then
        note "$name: baked and checked already"; continue
      fi
      note "$name: baked already; its sheets or their native messages changed: checking again"
      [ -f "$OUT/bake-work/$name.snap" ] || inflate "$name"
    else
      note "$name: $label — imports $imports"
      rm -f "$OUT/check/browser/.$name.ok"
      bake "$name" "$(printf 'import %s\n' $imports)#check (2 + 2 : Nat)" --roots "$roots" --label "$label" --allow-legacy-imports \
        > "$OUT/logs/bake-$name.log" 2>&1 || { tail -20 "$OUT/logs/bake-$name.log"; die "bake of $name failed"; }
      grep -E "^baked " "$OUT/logs/bake-$name.log" | sed 's/^/   /'
      echo "$bake_fp" > "$OUT/check/browser/.$name.baked"
    fi
    [ -f "$OUT/bake-work/init.snap" ] || inflate init
    local s ok=1
    for s in $sheets; do
      local file; file="$REPO/Bewijzen/$(echo "$s" | sed 's#\.#/#').lean"
      node --stack-size=8192 "$W/scripts/browser-check.mjs" --qed64 "$QED64_DIR" --artifact "$ART" --lib "$OUT/bake-tree" \
        --snap-dir "$OUT/bake-work" --snapshots "init,$name" --sheet "$file" --out "$OUT/check/browser/$s.json" ${opts[@]+"${opts[@]}"} \
        > "$OUT/logs/browser-$s.log" 2>&1 || { tail -5 "$OUT/logs/browser-$s.log"; ok=0; continue; }
      mkdir -p "$OUT/check/pair" && rm -f "$OUT/check/pair"/*.json
      cp "$OUT/check/native434/$s.json" "$OUT/check/pair/" 2>/dev/null || { note "  $s: no native result to compare (run check-native)"; ok=0; continue; }
      mkdir -p "$OUT/check/pair-b" && rm -f "$OUT/check/pair-b"/*.json && cp "$OUT/check/browser/$s.json" "$OUT/check/pair-b/"
      if python3 "$W/scripts/compare-checks.py" "$OUT/check/pair" "$OUT/check/pair-b" --label-a native --label-b browser > "$OUT/logs/compare-$s.log"; then
        note "  $s: browser = native ($(node -p 'const r = require(process.argv[1]); r.messages.length + " messages, " + r.elaborationSeconds + " s"' "$OUT/check/browser/$s.json"))"
      else
        cat "$OUT/logs/compare-$s.log"; ok=0
      fi
    done
    [ "$ok" = 1 ] || die "$name: a sheet's browser messages differ from native Lean's (logs above)"
    fingerprint "$name" 3 > "$OUT/check/browser/.$name.ok"
    [ "${KEEP_RAW:-0}" = 1 ] || rm -f "$OUT/bake-work/$name.snap" "$OUT/bake-work/$name.snap.deps"
  done
}

# --------------------------------------------------------------------------------- fetch --
lane_fetch() {
  say "fetch: the prebuilt environments (snapshots and plan) from ${PREBUILT_FROM:-<prebuilt.from>}"
  run node "$W/scripts/prebuilt.mjs" fetch --from "${PREBUILT_FROM:-<prebuilt.from>}" --digest "${PREBUILT_DIGEST:-<prebuilt.digest>}" \
    --out "$OUT" --release "$RID" --runtime "$RUNTIME" --qed64 "$QED64_PIN"
}

# ---------------------------------------------------------------------------------- site --
lane_site() {
  say "site: stage, type-check and build website/site"
  site_deps
  run npm --prefix "$W/site" run -s build:site
}

lane_on sources && lane_sources
lane_on release && lane_release
lane_on compile && lane_compile
lane_on check-native && lane_check_native
lane_on plan && lane_plan
lane_on bake && lane_bake
lane_on fetch && lane_fetch
lane_on site && lane_site
say "done ($LANES)"
