#!/usr/bin/env bash
# Run a command in the native compiler's image (docker/Dockerfile) with the course repository
# mounted at its own path, so every path is the same inside and outside the container.
#
# The compiler is linux/arm64: native on Apple silicon and arm64 Linux; on x86_64 Docker needs
# arm64 emulation (Docker Desktop has it; Docker Engine: `docker run --privileged --rm
# tonistiigi/binfmt --install arm64` once).
#
# Ownership: on Linux, one throwaway container first shows who owns the files a container
# writes into the clone. Docker Engine (rootful) makes them root's: then the container runs as
# the host user, so website/out stays the user's. Rootless Docker, Podman and Docker Desktop
# make them the user's already: then it runs as is. DOCKER_USER=1 forces --user, DOCKER_USER=0
# turns it off.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$W/.." && pwd)"
IMAGE="proofsheets-native64:$( (sha256sum "$W/docker/Dockerfile" 2>/dev/null || shasum -a 256 "$W/docker/Dockerfile") | cut -c1-12)"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build --platform linux/arm64 -t "$IMAGE" "$W/docker" >&2
as_user=0
case "${DOCKER_USER:-auto}" in
  1) as_user=1 ;;
  0) ;;
  *) if [ "$(uname -s)" = Linux ] && [ "$(id -u)" != 0 ]; then
       mkdir -p "$W/out"
       probe="$(mktemp -d "$W/out/.in-docker.XXXXXX")"
       docker run --rm --platform linux/arm64 -v "$probe:$probe" "$IMAGE" touch "$probe/p" >/dev/null 2>&1 || true
       [ "$(stat -c %u "$probe/p" 2>/dev/null)" = "$(id -u)" ] || as_user=1
       rm -rf "$probe"
     fi ;;
esac
user=()
if [ "$as_user" = 1 ]; then
  user=(--user "$(id -u):$(id -g)" -e HOME=/tmp)
  root_owned="$(find "$W/out" -maxdepth 3 -user 0 -print -quit 2>/dev/null || true)"
  [ -z "$root_owned" ] || { echo "in-docker.sh: $root_owned belongs to root (an earlier version ran the container as root): sudo chown -R \"\$USER\" website/out once" >&2; exit 1; }
fi
exec docker run --rm --platform linux/arm64 ${user[@]+"${user[@]}"} -v "$REPO:$REPO" -w "${DOCKER_WD:-$REPO}" "$IMAGE" "$@"
