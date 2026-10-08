# The userland the toolchain release's native compiler runs in.
# native64.tar.gz (release.json native64) is a linux/aarch64 `lean`/`lake`
# that needs glibc >= 2.38, libstdc++ and libuv. python3 runs the compile
# driver; gcc and libc6-dev let `leanc` link a shared library when a module
# needs native code at compile time (MD4Lean's md4c, see build.sh).
# The base is pinned by its multi-arch index digest (Ubuntu 24.04, glibc 2.39,
# the same distro as the release's build image).
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 libuv1t64 libstdc++6 gcc libc6-dev git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
