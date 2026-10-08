# The source packages of the website's olean overlay and their Lean options (each package's
# lakefile leanOptions), as compile.py --pkg/--fill arguments (Mathlib is a --fill: the packs serve all
# but the few modules compiled from its source at the release's pin). Sourced by build.sh.
# shellcheck shell=bash
overlay_pkg_args() {
  local W="$1" V="$1/forks/verso/src" S="$1/out/src" MOD=-Dexperimental.module=true
  local VERBOSE_OPTS=-Dpp.unicode.fun=true,-DautoImplicit=false,-DrelaxedAutoImplicit=false,-Dpp.proofs.withType=false
  local COURSE_OPTS=-Dpp.unicode.fun=true,-DautoImplicit=false,-DrelaxedAutoImplicit=false,-Dweak.verso.code.warnLineLength=120
  printf '%s\n' \
    --pkg "course=$(cd "$W/.." && pwd)=$COURSE_OPTS" \
    --pkg "genre=$W/forks/waterproof-genre" \
    --pkg "verbose=$W/forks/verbose-lean4=$VERBOSE_OPTS" \
    --pkg "verso=$V/verso=$MOD" --pkg "verso-manual=$V/verso-manual=$MOD" --pkg "verso-util=$V/verso-util=$MOD" \
    --pkg "multi-verso=$V/multi-verso=$MOD" --pkg "verso-search=$V/verso-search=$MOD" \
    --pkg "verso-illuminate=$V/verso-illuminate=$MOD" --pkg "verso-literate=$V/verso-literate=$MOD" \
    --pkg "verso-literate-code=$V/verso-literate-code=$MOD" \
    --pkg "subverso=$S/subverso/src=$MOD" --pkg "md4lean=$S/md4lean=$MOD" \
    --pkg "illuminate=$S/illuminate/src=-DautoImplicit=false,-Dlinter.missingDocs=true,-Ddoc.verso=true" \
    --pkg "cli=$S/lean4-cli=$MOD" \
    --fill "mathlib=$S/mathlib4=-Dpp.unicode.fun=true,-DautoImplicit=false,-DmaxSynthPendingDepth=3"
}
