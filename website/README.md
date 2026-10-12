# The proof sheets in the browser

This folder turns the course's proof sheets into a website. Students open a sheet in the
[Waterproof editor](https://github.com/impermeable/waterproof-editor), write their proofs in the
exercise holes, and Lean 4.34 checks them **in the browser tab**: no installation, no server.

It takes the *faithful* path: Lean receives each sheet's Verso file itself (`#doc (WaterproofGenre) … =>`, Markdown prose, `::::multilean` exercises with
`:::input` holes), exactly as the VS Code extension sends it. It elaborates the file in the
environment of exactly the sheet's imports, so that a sheet's messages in the browser are native
Lean's, message for message. The build checks that for every sheet with the browser's Lean under
Node (below). **In Chrome, on the current toolchain release, this holds for only about half the
sheets**: the others show extra "the WebAssembly runtime's stack is exhausted" errors, because a
Chrome Worker gives Lean far less stack than Node does, and the release's stack guard is tuned
too cautiously for it. This is a lasting limit of the in-browser checker on the current runtime:
no fix is planned (Requests, below), and closing it would take a new runtime or more engine
stack. `--lanes chrome-check` measures it.

**[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** explains the process step by step: how the build turns
the course into 13 Lean environments and checks them, how they are published and fetched, and
what the page does when a student opens a sheet or switches to another (and why Lean sometimes
restarts). This README is the reference: what is where, requirements, commands.

```
 Waterproof editor (ProseMirror)                      Lean 4.34 in a Web Worker (QED64, wasm64)
 ┌─────────────────────────────────┐   full text     ┌──────────────────────────────────────────┐
 │ the sheet's .lean, as blocks    │ ──didChange───▶ │ resident FileWorker                      │
 │ squiggles · hole status · busy  │ ◀─diagnostics── │ environment: a baked snapshot of exactly │
 └─────────────────────────────────┘   plainGoal     │ the sheet's imports (Mathlib, Verbose,   │
 Lean InfoView (goals, panel widgets) ◀─RPC────────▶ │ Verso, WaterproofGenre, Customlib)       │
                                                     └──────────────────────────────────────────┘
```

## What is where

| Path | What |
|---|---|
| `HOW-IT-WORKS.md` | The process: build, publish, and what the page does when a sheet is opened or switched. |
| `build.sh` | The whole build, in lanes (`--help`); `--prebuilt` for the quick path. |
| `sources.json` | Every pin: the toolchain release, QED64, the prebuilt environments, the forks (upstream commit + patches), the dependencies. |
| `patches/<fork>/` | The forks as patch series (`git format-patch`), applied by the `sources` lane. |
| `forks/` | The fork checkouts (gitignored; each its own git repo, rebuilt from `patches/`). |
| `scripts/compile.py` | Compiles the olean overlay with the release's native compiler (Docker). |
| `scripts/check-sheets.py` | Every sheet natively: errors only in exercise holes. |
| `scripts/plan-entries.mjs` | One snapshot entry per distinct environment (ordered import closure). |
| `scripts/browser-check.mjs` | One sheet through the browser's own FileWorker under Node, as the page runs it. |
| `scripts/chrome-check.mjs` | Every sheet in real Chrome against native Lean (`--lanes chrome-check`, on a running dev or preview server). |
| `scripts/compare-checks.py` | Native versus browser (or 4.31 versus 4.34), message by message. |
| `scripts/fingerprint.mjs` | What each baked and checked entry depends on; the bake lane redoes an entry when it changes. |
| `scripts/prebuilt.mjs`, `scripts/publish-prebuilt.sh` | The baked environments as a GitHub release, and the fetch lane that installs them. |
| `expected/known-issues.json` | Course content issues that native Lean 4.31 has too (one, in L08). |
| `test/fixtures/` | Sheet-shaped test files with exercises of their own (no course solutions). |
| `site/` | The web page (Vite + TypeScript): editor, Lean client, InfoView, QED64 boot. |
| `site/edge/`, `site/wrangler.toml` | The production Worker (Cloudflare, QED64's edge library). |
| `out/` | Everything the build makes (gitignored). |

## The pieces

- **Toolchain.** The Lean fork's release `lean-v4.34.0-e1a79c1` (runtime
  `wasm64-f69cca24d0878a58`): the WebAssembly Lean, its native compiler (`native64`, the one
  that compiled the release's Mathlib), and the Lean and Mathlib oleans as packs.
- **QED64** (`github:FawadHa1der/QED64#62a06e2`, the site's npm dependency): the library that
  boots that runtime in a page and runs Lean's FileWorker on it, and the snapshot pipeline.
- **The forks**, each a branch off upstream (`sources.json`):
  - `verso`: upstream Verso v4.34.0 plus pimotte's Waterproof changes (`:::multilean`,
    `elabCommandsCore`, the `error` flag), ported: upstream 4.34 parses code blocks in place.
  - `waterproof-genre`: ported to that Verso; its goal panel imports only the ProofWidgets
    modules it uses (all in the release's Mathlib pack).
  - `verbose-lean4`: ported to Mathlib v4.34.0. Mathlib 4.34 elaborates `s ⊆ t` on sets to
    `s ≤ t`, so the help tactic had to learn that set inclusions are `≤` now. One fix is for the
    browser only: Verbose's config extension built its imported state with a fold that recursed
    once per imported module and overflowed the browser's stack (Mathlib + Verbose is ~3,500
    modules); it is a loop now, with the same value.
  - `waterproof-vscode`: the source of the Lean file format the editor uses
    (`site/src/lean-format/`, copied verbatim, LGPL-2.1).
- **The course** (this repository, branch `website-v4.34`): ported to Lean 4.34. Only
  `Customlib/Sets.lean` changed (its type-as-set `⊆` rule hands the relation to Mathlib's new
  elaborator), plus `Customlib/WeakInduction.lean`, a verbatim copy of L07's preamble that L08
  now imports (a sheet with empty holes never compiles, so L08 could not import L07).

## Faithfulness, and how it is checked

| Check | Lane | Result |
|---|---|---|
| Every sheet natively on 4.34: errors only at the (empty) holes | `check-native` | 28/28 (L08's Example 4.3.4 fails on 4.31 too: `expected/known-issues.json`) |
| Every sheet's messages on 4.34 = on native Lean 4.31 with the unported libraries | manual (recipe below) | 28/28 identical (severity, position, text) |
| Every sheet through the browser's FileWorker **under Node** = native 4.34, message by message | `bake` | 28/28 identical |
| Every sheet **in Chrome** (headless Chromium 151, fresh load) = native 4.34 | `chrome-check` | 12–13/28 identical, 0 Lean deaths (2026-10-10 on QED64 8c461a8, 2026-10-12 on 62a06e2); the others have extra "stack is exhausted" errors (51–53 in all; L07 has 19), and a few sheets flip between runs |
| The page in a browser: boot, editing, hole status, goal panel, environment switch, saved work | manual (below) | passed, on the dev server and on the production build |

Each snapshot holds the environment of one *ordered* import closure: Lean adds modules in a
depth-first walk of the header, and some environment state depends on that order (Verbose's
configuration is the last module's). The 28 sheets need 13 such environments. The page boots
the entry baked for exactly the open sheet's ordered import closure, never a larger one, and
restarts Lean when the next sheet needs another entry (QED64 reports the header `exact`, or
`covered` for the 5 sheets whose import lines differ from the entry's but close over the same
modules in the same order). HOW-IT-WORKS.md §1, §4 and §5 explain why.

Measured on an Apple-silicon Mac (while other Lean jobs ran beside it):

| | |
|---|---|
| Lean runtime, downloaded once | 160 MB |
| One environment, downloaded once | 225–324 MB (0.83–1.15 GB in the browser's cache) |
| All 13 environments plus `init` | 3.8 GB to host |
| First visit to a sheet (cold cache, local server) | 18 s in headless Chromium (2026-10-09); about 1 minute in a desktop browser under load (2026-10-08) |
| Opening a sheet again (warm cache) | 14 s (reload, headless); 10–30 s in a desktop browser, most of it waiting for the previous tab's Lean to stop |
| Switching to a sheet of the same environment | 1.6 s (L04.1 → L04.2): no restart |
| Switching to a sheet of another environment | 13.6–15.1 s: a Lean restart (~8 s) plus checking the sheet; over a network, a first visit to that environment also downloads 225–324 MB, starting at the switch (HOW-IT-WORKS.md §4) |
| Checking a sheet once loaded (browser) | 4.7–13.8 s per sheet; natively, with the import, 6–15 s |
| Browser tab memory, a sheet loaded and checked | 5.8 GB physical footprint with a 3,494-module environment, 6.0 GB with a 4,825-module one (macOS `footprint`; RSS 8.7–8.9 GB including reclaimable pages) |

The browser floor is a hard requirement for students: a desktop Chrome or Edge 133+ or Firefox
134+ (WebAssembly Memory64), cross-origin isolation, and a tab that needs about 6 GB. A computer
with 16 GB of memory is comfortable, and 8 GB is the minimum with nothing else open. The page
says so and still shows the sheet when the browser cannot run Lean.

The 4.31 baseline is native Lean 4.31 with the course's own (unported) libraries, on the same
sheet text. To recreate it (about 8 GB; elan and Lake on the host):

```bash
git fetch origin main && git worktree add --detach website/out/ref431 FETCH_HEAD
cp Bewijzen/Customlib/WeakInduction.lean website/out/ref431/Bewijzen/Customlib/
cp Bewijzen/L08_Strong_Induction/sheet1_strong_induction.lean website/out/ref431/Bewijzen/L08_Strong_Induction/
(cd website/out/ref431 && lake exe cache get && lake build WaterproofGenre Bewijzen.Customlib Bewijzen.Customlib.WeakInduction)
python3 website/scripts/check-sheets.py --repo website/out/ref431 --lean "$(cd website/out/ref431 && elan which lean)" --lean-path "$(cd website/out/ref431 && lake env printenv LEAN_PATH)" --out website/out/check/native431 --opts=-Dpp.unicode.fun=true,-DautoImplicit=false,-DrelaxedAutoImplicit=false
python3 website/scripts/compare-checks.py website/out/check/native431 website/out/check/native434 --label-a 4.31 --label-b 4.34
```

## Requirements

| | Quick path (`build.sh --prebuilt`) | Full build (`build.sh`) |
|---|---|---|
| Platform | macOS, Linux, or Windows with WSL2 | macOS on Apple silicon (verified end to end), Linux on arm64; x86_64 Linux, Intel Macs and WSL2 through arm64 emulation (slow) |
| Tools | Node 24+, npm 10.8+, git, bash, tar | the same, plus python3 3.9+ and Docker that runs `linux/arm64` |
| Disk | ~4 GB | ~16 GB in `out/` at the end of a full build (also its peak), on a filesystem with hard links; leave ~20 GB free for the Docker image and caches |
| Memory | a browser tab needs ~6 GB | 16 GB; the Docker VM 8 GB or more (`JOBS=1` below that) |
| Network | ~3.9 GB from GitHub (the runtime, 0.16 GB; the environments, 3.8 GB) and ~0.1 GB from npm | ~3.3 GB from GitHub and npm, plus the Ubuntu image the compiler's Docker image is built from |
| Time | minutes | about two hours on Apple silicon (1 h 54 min measured from a fresh clone) |

Nothing needs an account or a key: the toolchain release, the forks' upstreams, the
dependencies and QED64 are all public, and fetched over HTTPS by pinned commit or digest.

- **The compiler is linux/arm64.** Docker Desktop runs it everywhere (emulated on x86_64). With
  Docker Engine on x86_64 Linux, enable arm64 emulation once:
  `docker run --privileged --rm tonistiigi/binfmt --install arm64`. Only the compile and
  check-native lanes use Docker; emulated, they take several times longer.
- **Linux:** `scripts/in-docker.sh` checks whether the container's files come out as root's
  (Docker Engine) and then runs it as your user, so `website/out` stays yours
  (`DOCKER_USER=0|1` overrides the check). Use the `docker` group or rootless Docker, not
  `sudo website/build.sh`. An `out/` made as root by an earlier version of the script needs
  `sudo chown -R "$USER" website/out` once. Docker Engine with `userns-remap` is not supported.
- **Docker mounts only the clone:** `website/out` must be a real directory inside it (not a
  symlink elsewhere), on a filesystem with hard links, and the clone's path must be one Docker
  shares (Docker Desktop: under your home directory by default).
- **Lake and VS Code** do not work on this branch: `lean-toolchain` is Lean 4.34, but
  `lakefile.toml` still names the course's 4.31 libraries (the ported forks are patch series
  here, not published packages). The website build does not use Lake. To work on the sheets in
  VS Code, use the `main` branch.

## Quick path: run the site without building it

```bash
git clone -b website-v4.34 https://github.com/FawadHa1der/introduction-to-proof-sheets-lean
cd introduction-to-proof-sheets-lean
website/build.sh --prebuilt
npm --prefix website/site run dev
```

`--prebuilt` runs the lanes `release,fetch,site`: the Lean runtime from the toolchain release,
the published environments (the snapshots and the plan that maps each sheet to its
environment, each file checked against `prebuilt.json`, whose digest `sources.json` pins), and
the page. These are the environments the full build made and checked, so the page behaves as
after a full build of the same commit; `fetch` warns when this checkout's Customlib, patches or
pins differ from the ones they were made from.

The environments are published once per toolchain release and course change by
`scripts/publish-prebuilt.sh` (after a full build, from a pushed commit; it needs `gh` logged
in to the repository, uploads ~3.8 GB as a GitHub release and pins it in `sources.json`;
`--dry-run` first). **Until that has run,
`--prebuilt` stops with a message, and the full build is the only way to get Lean in the page.**

## Full build

```bash
website/build.sh
```

The first run takes about two hours (1 h 54 min from a fresh clone, 2026-10-09): the release
~10 min, Docker compiles 284 modules (~10 min), the native check ~2 min, and the 14 snapshot
bakes ~6 minutes each, with the browser check of the 28 sheets (~8 min) between them. Most of a
bake is QED64's baker waiting 300 s for its process to exit (a request below). A fresh clone's
build matches the author's: the same native messages, plan, compiled overlay and browser
messages; 11 of the 14 snapshots are byte-identical, and 3 differ in about 35 bytes (baking is
not byte-deterministic).
Re-runs skip what is up to date; `--lanes` picks lanes and `--plan` prints what would run
(`website/build.sh --help`). Peak memory: ~12 GB for a browser check, ~9 GB for a bake.

## Run it locally

```bash
npm --prefix website/site ci       # once; build.sh does it too
npm --prefix website/site run dev
```

npm warns about install scripts (esbuild, fsevents) and skips an integrity check for the QED64
git dependency (it is pinned by commit); npm 11.0–11.8 also call `allow-git` (in `site/.npmrc`,
for npm 12) unknown. These warnings are expected.

Then open <http://localhost:5197/>. The page itself works right after `npm ci`, but Lean needs
the runtime (`out/release/mirror/runtime`) and the environments (`out/staging/snapshots`),
which the full build or the quick path puts there (`RUNTIME_DIR` and `SNAPSHOTS_DIR` point the
server elsewhere). The dev server sends the COOP/COEP headers the page needs. `?sheet=<id>`
opens a sheet, and `?fixture=hole-status` opens the hole-status test fixture (a solved, a wrong
and an empty hole). `npm --prefix website/site run preview` serves the production build
(`dist/`) on port 5207 in the same way. The ports are fixed; `run dev -- --port <n>` picks
another.

The browser floor applies: a desktop Chrome or Edge 133+ or Firefox 134+, and ~6 GB for the tab.

## Test

```bash
npm --prefix website/site test
```

The page's code without Lean: the Lean file format on every sheet, the text document, the edge
Worker, and the environment switching (`test/checker.test.mjs` against a stand-in relay,
`test/checker-real-relay.test.mjs` against QED64's own) — seconds; the entry check is skipped
before a plan exists. Lean's side is checked by the
build: `check-native` (every sheet natively) and `bake` (every sheet through the browser's
FileWorker under Node, against native). Chrome itself, where a Worker has much less stack:

```bash
npx --prefix website/site playwright install chromium-headless-shell   # once
website/build.sh --lanes chrome-check       # with the dev server running (CHROME_CHECK_URL)
```

It opens every sheet with a fresh load and fails on any message that differs from native Lean,
any Lean death, or a sheet that never checks (`out/check/chrome/`). By hand, on the dev server:
1. `?fixture=hole-status`: the three holes show green, red with Lean's error, and red;
2. type a proof into the empty hole: it turns green;
3. move the cursor into a proof: the goal panel follows;
4. pick a sheet with other imports: Lean restarts on that sheet's environment;
5. reload: the work is still there.

## Deploy

`site/scripts/deploy.sh` uploads the snapshots to R2 (`qed64-artifacts`, prefix
`proof-sheets/`), builds the page and deploys the Worker (`wrangler deploy`). It needs the
Cloudflare account's rclone remote and a `wrangler login`. It refuses to deploy unless the
toolchain release is already in the bucket under `lean4-wasm64/<release id>/`, where its owner
uploads it once for every site on that release. `--dry-run` shows what it would upload. The
account, bucket and remote are the site owner's; anyone else deploys to their own account under
their own names (`deploy.sh`, `wrangler.toml`).

The browser downloads Lean once (160 MB) and then each environment it needs once
(225–330 MB). It keeps the two most recent environments in its cache.

## When the course changes

- **Sheet text only** (most of the exporter's commits): rebuild the site (`--lanes site`); no
  rebake is needed. To hold the changed sheets against native Lean again, run
  `--lanes check-native,bake,site`: the entries whose sheets changed are checked again, from
  their staged snapshots, without a rebake. A sheet whose import list is new needs
  `--lanes plan,bake,site`.
- **Customlib, Verbose or the genre**: `--lanes compile,check-native,plan,bake,site`. The bake
  lane notices the change (each entry's markers hold fingerprints of the compiled modules, the
  runtime, QED64 and the Lean options, and of its sheets' text and their native messages:
  `scripts/fingerprint.mjs`) and bakes and checks the affected entries again.
- **Upstream exports on Lean 4.31**: merge them into `website-v4.34`, port what 4.34 needs, and
  run the lanes above. `check-native` and the browser comparison catch what the port missed.
- **A new toolchain release**: change `sources.json` (release and QED64 pins) and run every lane,
  then `--lanes chrome-check`. Snapshots are paired with one runtime build; they are always
  rebaked with it.
- **After any rebake**, publish the environments again (`scripts/publish-prebuilt.sh`) so that
  the quick path serves them; a sheet-text-only change needs no new publish.

## Requests to QED64 and the Lean fork

Done in this site, and better done upstream:
- **The Chrome stack budget** (the one that matters most): on the release's runtime
  (wasm64-f69cca24d0878a58, kernel patch 0036) 16 of 28 sheets get extra "stack is exhausted"
  errors in Chrome, where a Worker has ~500 KiB of engine stack. The guard probes the engine
  stack only every 16th `checkSystem`, so it must keep a wide reserve (16384 slots); QED64 main's
  interim of 8192 halves the errors but lets L02.1 and L08.1 overflow and kill Lean (measured),
  and no value between is safe. **No fix is planned** (2026-10-12): the Lean fork's stack work
  (kernel patch 0038: a guard by recursion depth, native exports for the core functions the
  interpreter runs) is on hold, and QED64 will only catch stack *deaths* (below). Closing the
  gap would be a new decision: a runtime with such a guard, or more engine stack per Worker,
  then a new toolchain release and a rebake of every snapshot. Its acceptance test is
  `--lanes chrome-check`: 28/28 equal to native, no Lean death.
- **Lean options**: the site patches its staged copy of QED64's `lean.worker.js` to pass the
  course's lakefile `leanOptions` as `-D` flags (`site/scripts/stage.mjs` `workerOptions`; the
  patch must apply exactly once). QED64 should take options per session. QED64 plans to pass
  `Elab.async=false` too (HARDENING #70: ~20 slow theorems in flight grow the runtime's thread
  pool until the tab crashes); the site does not: with the course's sheets the pool never grew,
  the flag changed no message in Chrome, and it starts tactics deeper in the stack.
- **Exact environments**: the site passes its own snapshot policy so that a sheet gets the entry
  of its ordered import closure. QED64's root matching cannot tell two orders of the same
  modules apart.
- **A headless FileWorker check**: `scripts/browser-check.mjs` is adapted from QED64's
  resident probe. It is worth a tier-1 tool in QED64.
- **Replacing a session that is still starting**: a sheet chosen while Lean starts waits for that
  start (QED64's relay accepts `restart()` only while serving), so two quick switches pay for
  both starts (25 s instead of 15 s measured). The relay should replace a session in its settle
  wait or before its environment is loaded.
- **The bake's exit wait**: QED64's `bake-snapshot.mjs` waits 300 s for the baking process to go
  quiet after the snapshot is written; that is ~70 of a full build's 114 minutes. Finishing once
  the snapshot file is complete and stable would bring a full build to ~47 minutes.
- **Interpreted core code**: Verso answers `textDocument/documentSymbol` with its own handler,
  which waits on every command snapshot of the document (`IO.AsyncList.waitAll`). Called from
  Verso's interpreted code, that core function runs in Lean's interpreter too (lean.wasm exports
  no native entry for it), at ~10 KiB of engine stack per command, so on a sheet of ~50
  commands (L07) the request overflowed a Chrome Worker's stack and killed Lean on every new
  version of the text; three deaths stop Lean. The page therefore does not ask for
  `documentSymbol` (its completions come from the text, `site/src/declarations.ts`); with that,
  the Chrome check sees no death. For stack deaths that remain possible (very deep proofs),
  QED64 (from 62a06e2, HARDENING #72) has a backstop: the death is classified
  (`ENGINE_STACK_OVERFLOW`), the relay pauses after the first one instead of rebooting into it
  three times, a QED64 note marks the line Lean was checking, the page says "Checking paused",
  and an edit or another sheet resumes.
- **Snapshot caching**: a stored region is recognised by its size and first bytes, not its
  sha256; the browser's HTTP cache does not keep a 324 MB snapshot, so an evicted environment is
  downloaded again; and since baking is not byte-deterministic, a rebake of an unchanged entry
  gets a new name and is downloaded again.
- **The Verbose overflow** shows that generic folds over the imported modules overflow the
  browser's JavaScript stack where native Lean does not. The fork's stack guard does not reach
  that path (it checks Lean's recursion, not core's compiled folds called back through
  closures).
