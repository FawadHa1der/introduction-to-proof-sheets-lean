#!/usr/bin/env bash
# Compile the website's olean overlay (scripts/compile.py) in the native compiler's image.
#   scripts/overlay.sh <Root,Root,...> [compile.py flags: -j N, --heavy-jobs N, --plan]
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=compile-args.sh
source "$W/scripts/compile-args.sh"
ROOTS="$1"; shift
PKGS=(); while IFS= read -r l; do PKGS+=("$l"); done < <(overlay_pkg_args "$W")
exec "$W/scripts/in-docker.sh" python3 "$W/scripts/compile.py" \
  --lean "$W/out/native64/bin/lean" --out "$W/out/build/lib" --base "$W/out/trees/fat" \
  --log-dir "$W/out/logs/compile" "${PKGS[@]}" --roots "$ROOTS" "$@"
