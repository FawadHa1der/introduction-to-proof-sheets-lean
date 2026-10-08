#!/usr/bin/env bash
# Run a command in the native compiler's image (docker/Dockerfile) with the course repository
# mounted at its own path, so every path is the same inside and outside the container.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$W/.." && pwd)"
IMAGE="proofsheets-native64:$(shasum -a 256 "$W/docker/Dockerfile" | cut -c1-12)"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build --platform linux/arm64 -t "$IMAGE" "$W/docker" >&2
exec docker run --rm --platform linux/arm64 -v "$REPO:$REPO" -w "${DOCKER_WD:-$REPO}" "$IMAGE" "$@"
