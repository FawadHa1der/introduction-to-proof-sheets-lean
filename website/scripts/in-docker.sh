#!/usr/bin/env bash
# Run a command in the native compiler's image (docker/Dockerfile) with the course repository
# mounted at its own path, so every path is the same inside and outside the container.
#
# The compiler is linux/arm64: native on Apple silicon and arm64 Linux; on x86_64 Docker needs
# arm64 emulation (Docker Desktop has it; Docker Engine: `docker run --privileged --rm
# tonistiigi/binfmt --install arm64` once).
#
# Ownership: with Docker Engine on Linux (rootful), the container runs as the host user, so
# what it writes into website/out stays the user's. Docker Desktop and rootless Docker map
# files to the user already. DOCKER_USER=1 forces --user, DOCKER_USER=0 turns it off.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$W/.." && pwd)"
IMAGE="proofsheets-native64:$( (sha256sum "$W/docker/Dockerfile" 2>/dev/null || shasum -a 256 "$W/docker/Dockerfile") | cut -c1-12)"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build --platform linux/arm64 -t "$IMAGE" "$W/docker" >&2
user=()
case "${DOCKER_USER:-auto}" in
  1) user=(--user "$(id -u):$(id -g)" -e HOME=/tmp) ;;
  0) ;;
  *) if [ "$(uname -s)" = Linux ] && [ "$(id -u)" != 0 ] \
        && ! docker info -f '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless \
        && [ "$(docker context show 2>/dev/null)" != desktop-linux ]; then
       user=(--user "$(id -u):$(id -g)" -e HOME=/tmp)
     fi ;;
esac
exec docker run --rm --platform linux/arm64 ${user[@]+"${user[@]}"} -v "$REPO:$REPO" -w "${DOCKER_WD:-$REPO}" "$IMAGE" "$@"
