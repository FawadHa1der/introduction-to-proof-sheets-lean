# The proof sheets in the browser

This folder turns the course's proof sheets into a website. Students open a sheet in the
[Waterproof editor](https://github.com/impermeable/waterproof-editor), write their proofs in the
exercise holes, and Lean 4.34 checks them **in the browser tab**: no installation, no server.

It is the *faithful* path of `../qed64/REPORT-2-website-2026-10-08.md`. Lean receives each sheet's
Verso file itself (`#doc (WaterproofGenre) … =>`, Markdown prose, `::::multilean` exercises with
`:::input` holes), exactly as the VS Code extension sends it. It elaborates the file in the
environment of exactly the sheet's imports, so a sheet's messages in the browser are native
Lean's, message for message. The build checks that for every sheet (below).

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
| `build.sh` | The whole build, in lanes (`--help`). |
| `sources.json` | Every pin: the toolchain release, QED64, the forks (upstream commit + patches), the dependencies. |
| `patches/<fork>/` | The forks as patch series (`git format-patch`), applied by the `sources` lane. |
| `forks/` | The fork checkouts (gitignored; each its own git repo, rebuilt from `patches/`). |
| `scripts/compile.py` | Compiles the olean overlay with the release's native compiler (Docker). |
| `scripts/check-sheets.py` | Every sheet natively: errors only in exercise holes. |
| `scripts/plan-entries.mjs` | One snapshot entry per distinct environment (ordered import closure). |
| `scripts/browser-check.mjs` | One sheet through the browser's own FileWorker under Node, as the page runs it. |
| `scripts/compare-checks.py` | Native versus browser (or 4.31 versus 4.34), message by message. |
| `expected/known-issues.json` | Course content issues that native Lean 4.31 has too (one, in L08). |
| `test/fixtures/` | Sheet-shaped test files with exercises of their own (no course solutions). |
| `site/` | The web page (Vite + TypeScript): editor, Lean client, InfoView, QED64 boot. |
| `site/edge/`, `site/wrangler.toml` | The production Worker (Cloudflare, QED64's edge library). |
| `out/` | Everything the build makes (gitignored). |

## The pieces

- **Toolchain.** The Lean fork's release `lean-v4.34.0-e1a79c1` (runtime
  `wasm64-f69cca24d0878a58`): the WebAssembly Lean, its native compiler (`native64`, the one
  that compiled the release's Mathlib), and the Lean and Mathlib oleans as packs.
- **QED64** (`github:FawadHa1der/QED64#8c461a8`, the site's npm dependency): the library that
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

| Check | Lane | Result (2026-10-08) |
|---|---|---|
| Every sheet natively on 4.34: errors only at the (empty) holes | `check-native` | 28/28 (L08's Example 4.3.4 fails on 4.31 too: `expected/known-issues.json`) |
| Every sheet's messages on 4.34 = on native Lean 4.31 with the unported libraries | manual (recipe below) | 28/28 identical (severity, position, text) |
| Every sheet through the browser's FileWorker = native 4.34, message by message | `bake` | 28/28 identical |
| The page in a browser: boot, editing, hole status, goal panel, environment switch, saved work | manual (built-in browser pane) | passed, on the dev server and on the production build |

Each snapshot holds the environment of one *ordered* import closure: Lean adds modules in a
depth-first walk of the header, and some environment state depends on that order (Verbose's
configuration is the last module's). The 28 sheets need 13 such environments. The page boots
the entry baked for exactly the open sheet's imports, never a larger one, and restarts Lean when
the next sheet needs another entry (QED64 reports the header as `exact`).

Measured on an Apple-silicon Mac (while other Lean jobs ran beside it):

| | |
|---|---|
| Lean runtime, downloaded once | 160 MB |
| One environment, downloaded once | 225–324 MB (0.83–1.15 GB in the browser's cache) |
| All 13 environments plus `init` | 3.8 GB to host |
| First visit to a sheet (cold cache, local server) | about 1 minute: runtime + environment download, compile, load |
| Opening a sheet again (warm cache) | 10–30 s, most of it waiting for the previous tab's Lean to stop |
| Checking a sheet once loaded (browser) | 4.7–13.8 s per sheet; natively, with the import, 6–15 s |
| Browser tab memory, a sheet loaded and checked | 5.8 GB physical footprint with a 3,494-module environment, 6.0 GB with a 4,825-module one (macOS `footprint`; RSS 8.7–8.9 GB including reclaimable pages) |

The browser floor is a hard requirement for students: a desktop Chrome or Edge 133+ or Firefox
134+ (WebAssembly Memory64), cross-origin isolation, and a tab that needs about 6 GB. A computer
with 16 GB of memory is comfortable, and 8 GB is the minimum with nothing else open. The page
says so and still shows the sheet when the browser cannot run Lean.

The 4.31 baseline is native Lean 4.31 with the course's own (unported) libraries, on the same
sheet text. To recreate it (about 8 GB; elan and Lake on the host):

```bash
git worktree add --detach website/out/ref431 main
cp Bewijzen/Customlib/WeakInduction.lean website/out/ref431/Bewijzen/Customlib/
cp Bewijzen/L08_Strong_Induction/sheet1_strong_induction.lean website/out/ref431/Bewijzen/L08_Strong_Induction/
(cd website/out/ref431 && lake exe cache get && lake build WaterproofGenre Bewijzen.Customlib Bewijzen.Customlib.WeakInduction)
python3 website/scripts/check-sheets.py --repo website/out/ref431 --lean ~/.elan/toolchains/leanprover--lean4---v4.31.0/bin/lean --lean-path "$(cd website/out/ref431 && lake env printenv LEAN_PATH)" --out website/out/check/native431 --opts=-Dpp.unicode.fun=true,-DautoImplicit=false,-DrelaxedAutoImplicit=false
python3 website/scripts/compare-checks.py website/out/check/native431 website/out/check/native434 --label-a 4.31 --label-b 4.34
```

## Build

Requirements: Docker that runs `linux/arm64` (native on Apple silicon; elsewhere qemu), Node 24+,
python3, git, and ~40 GB of disk for a first run.

```bash
website/build.sh
```

A first run takes about two hours: Docker compiles ~330 modules (~15 min), each of the 13
snapshot bakes takes ~6 minutes, and the browser check of the 28 sheets takes ~15 minutes.
Re-runs skip what is up to date; `--lanes` picks lanes (`website/build.sh --help`).

## Run it locally

```bash
npm --prefix website/site run dev
```

Then open <http://localhost:5197/>. The dev server serves the runtime from
`out/release/mirror/runtime` and the snapshots from `out/staging/snapshots`, with the COOP/COEP
headers the page needs. `?sheet=<id>` opens a sheet, and `?fixture=hole-status` opens the
hole-status test fixture (a solved, a wrong and an empty hole). `npm --prefix website/site run
preview` serves the production build (`dist/`) on port 5207 in the same way.

## Deploy

`site/scripts/deploy.sh` uploads the snapshots to R2 (`qed64-artifacts`, prefix
`proof-sheets/`), builds the page and deploys the Worker (`wrangler deploy`). It needs the
Cloudflare account's rclone remote and a `wrangler login`. It refuses to deploy unless the
toolchain release is already in the bucket under `lean4-wasm64/<release id>/`, where its owner
uploads it once for every site on that release. `--dry-run` shows what it would upload.

The browser downloads Lean once (160 MB) and then each environment it needs once
(225–330 MB). It keeps the two most recent environments in its cache.

## When the course changes

- **Sheet text only** (most of the exporter's commits): rebuild the site (`--lanes site`); no
  rebake. A sheet whose import list is new needs `--lanes plan,bake,site`.
- **Customlib, Verbose or the genre**: `--lanes compile,check-native,plan,bake,site`.
- **Upstream exports on Lean 4.31**: merge them into `website-v4.34`, port what 4.34 needs, and
  run the lanes above. `check-native` and the browser comparison catch what the port missed.
- **A new toolchain release**: change `sources.json` (release and QED64 pins) and run every lane.
  Snapshots are paired with one runtime build; they are always rebaked with it.

## Requests to QED64 and the Lean fork

Done in this site, and better done upstream (`../qed64/REPORT-2-website-2026-10-08.md` §7):
- **Lean options**: the site patches its staged copy of QED64's `lean.worker.js` to pass the
  course's lakefile `leanOptions` as `-D` flags (`site/scripts/stage.mjs`; the patch must apply
  exactly once). QED64 should take options per session.
- **Exact environments**: the site passes its own snapshot policy so that a sheet gets the entry
  of its ordered import closure. QED64's root matching cannot tell two orders of the same
  modules apart.
- **A headless FileWorker check**: `scripts/browser-check.mjs` is adapted from QED64's
  resident probe. It is worth a tier-1 tool in QED64.
- **The Verbose overflow** shows that generic folds over the imported modules overflow the
  browser's JavaScript stack where native Lean does not. The fork's stack guard does not reach
  that path (it checks Lean's recursion, not core's compiled folds called back through
  closures).
