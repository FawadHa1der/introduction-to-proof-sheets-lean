# How the site works

The site has two halves. The **build** turns the course into Lean *environments*: one per
distinct ordered import closure the sheets use (section 1), each baked into a snapshot the
browser can load, and each checked against native Lean. The **page** runs Lean in the student's
browser tab, loads the environment of the open sheet, and sends it the sheet's text. This
document follows both, step by step; `README.md` has the commands.

```
 build (website/build.sh, ~2 h, after each change)        page (the student's browser tab)
 ┌──────────────────────────────────────────────┐        ┌──────────────────────────────────────┐
 │ sources → release → compile → check-native   │        │ open a sheet → start Lean on the     │
 │   → plan (13 environments) → bake + check    │ ─────▶ │ sheet's environment → check the text │
 │   → site                                     │/runtime│ another sheet: same environment →    │
 │ quick path: GitHub release → fetch → site    │/snaps. │ new text; other environment → restart│
 └──────────────────────────────────────────────┘        └──────────────────────────────────────┘
```

## 1. What an environment is, and why there are 13

When Lean elaborates a file, it first imports the modules in the file's header. It walks the
imports depth-first, in the order they are written, adding each module after its own imports
(`Init` first). The result, the **environment**, holds every declaration, notation, instance,
simp lemma and extension state of those modules. Everything after the header is elaborated in
it.

Some of that state depends on the **order** the modules were added, not only on which modules
they are:
- Verbose's configuration (the lemmas its automation may use, its suggestions) is whatever the
  *last* module that sets it says;
- instances and simp lemmas of equal priority are tried in an order that depends on the order
  they were added (for instances, the most recently added first).

So only an environment of exactly a sheet's ordered import closure is guaranteed to give
native Lean's messages for whatever the student writes, and two sheets can share an environment
only if their ordered import closures are identical. The 28 sheets have 13 distinct ones,
because sheets (even of one lecture) import different modules (mostly `Customlib` ones; L02.1
and L03.4 also import Mathlib modules directly, and L02.1 differs from L02.3 only by those), or
the same ones in another order:

| Imports (after `WaterproofGenre`, `Verbose.English.All`) | Modules | Sheets |
|---|---|---|
| nothing else | 3,494 | L01.1, L01.2, L02.2 |
| `Rational` | 3,495 | L02.3 |
| `Integers` | 3,649 | L02.4, L02.6, L02.8 |
| `Reals, Lists` (and the same closure from `Reals, Lists, Sets`) | 4,825 | L02.7, L03.1, L04.1–4 |
| `Functions, Lists` (and from `Functions, Sets, Lists`) | 4,825 | L05.1, L05.2, L06.1–3 |
| … 8 more | 3,513–4,828 | the rest |

(`out/plan/entries.json` lists all 13 with their sheets.) Each becomes one **snapshot entry**.
A sheet always gets the entry of exactly its own ordered closure, never a larger environment
that also contains its imports: a larger one would give students' proofs a different
environment than native Lean gives them (section 5 shows how).

A **snapshot** is not a memory image of a running Lean. It is one compacted region holding the
state Lean has after importing the header (the environment and every extension's state), plus
the list of modules whose `[init]` code must run again when it is loaded. It is tied to one
build of the WebAssembly runtime (`wasm64-f69cca24d0878a58`). Every boot also loads `init`
first: the snapshot of a file with no imports (Lean's `Init` library alone; 33 MB to download,
122 MB inflated).

## 2. The build

`website/build.sh` runs these lanes in order. `sources`, `release`, `compile` and `bake` (and
`fetch` on the quick path) skip work already done; `check-native`, `plan` and `site` run in
full every time. `bake` bakes an entry again whenever the compiled overlay, the runtime, the
QED64 pin or the Lean options changed, and checks it again whenever, in addition, the text of
one of its sheets or native Lean's messages for one changed; a re-check alone inflates the
staged snapshot instead of rebaking it (a rebake renames the snapshot, since baking is not
byte-deterministic, and every student would download it again). The two markers,
`out/check/browser/.<entry>.baked` and `.<entry>.ok`, hold the fingerprints
(`scripts/fingerprint.mjs`).

| Lane | What it does | Why |
|---|---|---|
| `sources` | Clones the upstream Verso, WaterproofGenre, Verbose and waterproof-vscode at the commits in `sources.json` and applies `patches/<fork>/` (`git am`, fixed identity); refuses a checkout that is not exactly base + patches. Fetches the pinned dependencies (SubVerso, MD4Lean, Illuminate, Lean4-Cli, a shallow Mathlib) into `out/src/`. Installs the site's npm packages, QED64 among them. | The forks carry the ports to Lean 4.34 as reviewable patches; nothing comes from the author's machine. |
| `release` | Fetches the toolchain release `lean-v4.34.0-e1a79c1` with its own tools, verified against the pinned digest: the WebAssembly runtime (kept in `out/release/mirror/runtime`, which the dev server serves), the native compiler `native64`, and the Lean and Mathlib oleans as packs, unpacked into a *fat* tree (to compile against) and a *slim* one (to bake from). | The browser runs exactly this runtime, and its Mathlib was compiled by exactly this compiler: the course's modules must be compiled by it too. |
| `compile` | Compiles, in Docker (the compiler is linux/arm64), the 284 modules the packs do not have: Verso, SubVerso, MD4Lean, Illuminate, WaterproofGenre, Verbose, the course's `Customlib`, and three Mathlib modules the packs lack (`scripts/compile.py`, raw `lean -o`, no Lake). | The overlay the environments are made of. |
| `check-native` | Checks that `Customlib/WeakInduction.lean` is still a verbatim copy of L07's preamble (`scripts/check-preambles.py`; L08 imports it), then elaborates every sheet with the native `lean`, in Docker like `compile` (`scripts/check-sheets.py`), with the course's `lakefile.toml` options. Every error must be in an exercise hole (the holes ship empty), except the known L08 issue (`expected/known-issues.json`). The messages are saved per sheet in `out/check/native434/`. | The reference the browser is held to. |
| `plan` | Assembles the bake tree (slim packs + overlay) and groups the sheets by ordered import closure (`scripts/plan-entries.mjs` → `out/plan/entries.json`): 13 entries, each baked from its group's shortest import list. | One environment per distinct closure (section 1). |
| `bake` | For `init` and every entry: QED64's `bake-snapshot.mjs` runs the WebAssembly runtime under Node, imports the entry's header, and writes the snapshot (`out/staging/snapshots/<name>.<digest>.snapz`, gzip; each entry 225–324 MB, 0.83–1.15 GB inflated) and its line in `index.json`. Then every sheet of the entry is elaborated **by the browser's own FileWorker under Node, in that snapshot** (`scripts/browser-check.mjs`), and its messages must equal native Lean's, message for message (`scripts/compare-checks.py`). | The browser's Lean must say what native Lean says. A sheet that differs stops the build. |
| `site` | Stages QED64's worker scripts (with the course's Lean options added to the FileWorker's command line), the InfoView, and the sheets with their catalogue (`site/scripts/stage.mjs`: title, exercises, imports, content hash, entry), type-checks, and builds the page with Vite. | |

From a fresh clone (2026-10-09, Apple silicon) the lanes took: `sources` 23 s, `release`
9.5 min, `compile` 9.5 min, `check-native` 2 min, `plan` 7 s, `bake` 92 min (about 70 of them
QED64's baker waiting 300 s per snapshot for its process to exit), `site` 3 s: 1 h 54 min. The
result matched the author's build: the same native messages, plan, compiled overlay and browser
messages, and 11 of the 14 snapshots byte for byte (the other 3 differ in about 35 bytes:
baking is not byte-deterministic).

A third check is run by hand, not by `build.sh` (`README.md`, the 4.31 baseline): every
sheet's messages on 4.34 equal native Lean 4.31's with the course's original libraries. All
three checks hold for all 28 sheets (`check-native` with L08's two known errors, which 4.31
has too).

### Publishing, and the quick path

The environments take two hours to make, but they are the same for everyone building the same
commit. `scripts/publish-prebuilt.sh` publishes them after a full build (again after every
rebake; a change to sheet text only needs no new publish):

1. `scripts/prebuilt.mjs pack` collects the 14 snapshots, `index.json` and the plan, refusing
   any entry whose sheets did not pass the browser check, and any sheet without an entry. It
   writes `prebuilt.json`: every file's size and sha256, the release, the runtime, the QED64
   commit, and a hash of the course inputs (Customlib, the forks' patches, the pins, the
   course's Lean options and the compiler options in `scripts/compile-args.sh`; not the sheets,
   whose text the environments do not depend on).
2. The files go up as a GitHub pre-release of this repository (with `gh`, logged in; the script
   refuses uncommitted course inputs or a HEAD that is not on a remote branch). The script
   writes the release's URL and the sha256 of `prebuilt.json` into `sources.json`. It does not
   commit: you commit that pin.

`website/build.sh --prebuilt` then runs `release` (the runtime only), `fetch` and `site`.
`fetch` downloads `prebuilt.json`, refuses it unless its sha256 is the pin and it is for this
release and runtime, then downloads every file, checks each one's sha256, and puts it where
the full build would have (the index last; snapshots the index does not name are removed). It
warns if this checkout's course inputs or QED64 pin differ from the ones the environments were
made from. Until `publish-prebuilt.sh` has run for this release (`sources.json`'s
`prebuilt.from` and `prebuilt.digest` are null until then), `--prebuilt` stops with a message,
and the full build is the only way to get Lean in the page.

Every file is checked against a hash committed in the repository, as in the full build, but the
hash vouches for something else. The full build makes the environments from pinned sources and
checks them against native Lean on your machine. The quick path takes the environments as the
publisher's full build made and checked them, and runs neither `check-native` nor the browser
check.

## 3. The page: opening a sheet

`site/src/main.ts` drives the page; `site/src/qed64.ts` (the `Checker`) owns Lean.

1. **The sheet.** The page reads the catalogue (`sheets/index.json`), opens the sheet named in
   the URL (or the last one), and shows it in the Waterproof editor: the student's saved text if
   there is one (`localStorage`, per sheet, tagged with the sheet's hash so an updated sheet is
   noticed), else the original.
2. **The browser floor.** Lean needs cross-origin isolation (the server's COOP/COEP headers) and
   WebAssembly Memory64. Without them the page says so and shows the sheet unchecked.
3. **The artifacts.** QED64's `installArtifacts` reads the runtime's manifest (`/runtime/`) and
   the snapshot index (`/snapshots/index.json`).
4. **The environment.** The Checker looks up the open sheet's import list in the catalogue to
   find its entry, and asks for `["init", <entry>]`. (An import list no sheet has, from an
   uploaded file or a teacher's edit, gets QED64's fallback (`chooseSnapshots`). It takes the
   entry whose import lists name the most of its imports (or a parent module of them), the
   smaller one on a tie, or `init` alone if none names any. The file is then checked in that
   entry's environment, not the one native Lean would build for its header, so section 1's
   guarantee does not hold for it. If that environment lacks one of the file's imports, Lean
   refuses the header and the page shows "Imports not available".)
5. **Lean starts** in a Web Worker (QED64's `LspRelay` makes a `ResidentSession`):
   - the runtime (`lean.js`, 49 MB, and `lean.wasm`, 110 MB) is fetched, or taken from the
     HTTP cache, and each chunk's sha256 checked;
   - a 64-bit WebAssembly memory is created (2 GiB to start, at most 6 GiB), `lean.wasm` is
     compiled, and 24 helper threads start;
   - the two snapshot regions are loaded. If a region is not yet in the browser's storage
     (OPFS), a separate worker first downloads the `.snapz`, inflates it and stores the ~1 GB
     `.raw` there ("preparing the environment", once per environment until it is evicted,
     section 4). The region is then copied into Lean's memory and the modules' `[init]` code
     runs. A stored region is recognised by its size and first bytes, not by its sha256.
     Without OPFS, or when storing fails (e.g. the disk quota is full), Lean's own Worker
     downloads and inflates the region on every start: nothing is cached then, and that Worker
     stays several GB heavier (QED64 measured ~4.6 GB);
   - Lean's FileWorker starts, as `lean --worker` with the course's options.
6. **Checking.** The page sends the sheet's whole text (`didOpen`, then a full-text `didChange`
   per edit). The FileWorker finds the environment for the header in its loaded snapshots (it
   reports `exact`, or `covered` for the 5 sheets whose import lines differ from the ones the
   entry was baked from but have the same ordered closure), and elaborates the file: the Verso
   document, with each `::::multilean` exercise elaborated as Lean code.
7. **What the student sees.** Lean's diagnostics become squiggles. Each exercise hole is marked
   as the VS Code extension marks it (`site/src/lean-client.ts`). It is incorrect (red) while
   Lean is still checking the file, if an error is in the hole, if no `QED` (or `□`) follows
   the hole before the next one, or if goals remain at that `QED`. It is invalid if Lean warns
   that the declaration uses `sorry`, and correct otherwise. The InfoView (goals, the genre's
   panel, Verbose's suggestions) talks to the same FileWorker over RPC. The editor's completions
   list the sheet's own declarations, read from its text (`site/src/declarations.ts`), not asked
   of Lean (section 4 says why).
8. **The stack, in Chrome.** A Chrome Worker gives Lean about 500 KiB of engine stack, far less
   than native Lean or Node has. The release's runtime guards it cautiously and reports "maximum
   recursion depth has been reached: the WebAssembly runtime's stack is exhausted" where a proof
   needs more: in Chrome, 16 of the 28 sheets get such errors on proofs that check natively (53
   in all, 19 on L07; `--lanes chrome-check`, 2026-10-10), and the build's own browser check,
   run under Node with its larger stack, does not see them. The Lean fork's kernel patch 0038
   (a guard by recursion depth) fixes it; it needs a new toolchain release and a rebake.

## 4. The page: switching sheets

### Same environment: no restart

If the next sheet's entry is the one Lean is running (L04.1 → L04.2, or L05.1 → L06.3), the
page sends the new text to the same FileWorker. Lean keeps the environment (and the processed
header, when the import lines are the same) and elaborates the new text: 1.6 s from the
selection to "Checked" for L04.1 → L04.2 in a browser. The squiggles clear, and every hole
shows as incorrect (red) until Lean has finished checking the new text, but no Lean is started.

### Another environment: Lean restarts

A running Lean cannot change its environment:
- **Lean itself** never unloads imports. Native Lean (VS Code) also restarts a file's worker
  process when its imports change. Imported regions cannot be freed once their extensions are
  live, and a module's `[init]` code runs at most once per process.
- **QED64** loads snapshots only while Lean starts; once the FileWorker runs, no other
  environment can be added, and memory is never given back.
- **A second Lean** in the same tab does not fit: one Lean's 25 Workers already take about
  3.2 GiB of the 4 GiB of JavaScript memory that a tab's Workers share (QED64 HARDENING #55),
  and a tab with one Lean already uses about 6 GB of the computer's memory.

So the Checker restarts Lean on the new entry (`relay.restart`). Requests in flight get an
error reply (the InfoView reconnects), and the old Worker is told to stop and is terminated
250 ms later. After a fixed 1.5 s settle (`site/src/qed64.ts`), step 5 runs again with the new
entry, and the relay then sends the new Lean `initialize` and the open sheet's text again.
While the new Worker fetches and checks the runtime, it waits (at most 6 s) until the old Lean
has at most 12 Workers still alive, and only then creates its memory and threads; if the 6 s
run out, it starts anyway, so the two Leans can briefly overlap. Nothing is reused from the old
Lean, only the browser's caches: the runtime from the HTTP cache, and the inflated regions from
OPFS.

Two things make this cheaper:
- **The download starts at the switch.** If the new environment is not in OPFS yet, the Checker
  starts its download and inflation the moment it restarts Lean (QED64's `prefetchRaw`), while
  the old Lean stops and the new runtime starts, instead of after. The new Lean's boot joins
  that download. In a browser on a local server the request went out within 0.2 s of the
  selection and was done before the new runtime needed it, so a switch to an environment never
  seen before took no longer than one to a cached environment. A switch made while Lean is
  still starting starts no download (that start is downloading its own environment); the new
  target's starts with the restart onto it. So at most one download runs at a time.
- **The cache keeps recent environments.** Each time a Lean starts (the first start, a switch,
  a restart after a crash), the page deletes from OPFS the inflated region (and any partial one
  a stopped download left) of every environment except that Lean's, the one started before it
  (remembered across visits), the open sheet's if different, the one being downloaded, and
  `init`, since each takes about 1 GB of the student's disk. Regions of snapshots the site no
  longer names (after a rebake or a new release renamed them) are deleted once per page. So at most two
  environments stay cached (up to about 2.4 GB with `init`); a third can exist for a while when
  a sheet is switched while Lean is still starting. Going back to an evicted environment
  downloads it again: the browser's HTTP cache did not keep a 324 MB snapshot.

### Switching while Lean is starting

The Checker keeps two things apart: the environment of the Lean that is starting or running
(*active*), and the environment the open sheet needs (*target*). As soon as the Lean that is
starting has loaded its environment and opened its FileWorker (the relay "serves", before
anything is checked), the Checker compares the two; if they differ, it restarts Lean on the
target. So a switch made while Lean is still starting waits for that start, then restarts once,
onto the last sheet chosen; switching back to the environment that is starting cancels the
pending restart; and typing in the new sheet neither loses nor repeats it. (Each of these was a
bug before 2fa58f5; `site/test/checker.test.mjs` and `checker-real-relay.test.mjs`, which uses
QED64's own relay, cover them.) The cost: a second choice made while Lean starts still pays for
the first one's start (two quick "Next" clicks took 25 s instead of 15 s in a browser), because
QED64's relay cannot replace a session that is still starting.

The Checker reads the import lines again on every edit, not only on a switch. So an uploaded
file, or a teacher's edit of the imports, restarts Lean whenever its import list maps to
another entry. An import list no sheet has gets QED64's fallback (section 3, step 4), so
retyping a module name can restart Lean once while the name is incomplete and again when it is
finished.

If Lean crashes, QED64 restarts it, after the same 1.5 s settle, and the Checker makes that new
Lean boot the open sheet's environment (not the one the relay remembers from the last switch,
which the student may have left). After three crashes (or failed starts) within two minutes it
stops, and the page says so; opening another sheet, editing, or a reload starts it again. One
such crash was systematic and is gone: the page used to ask Lean for the document's symbols
(for completions) after every check, and Verso's handler for that request walks every command of
the document in Lean's interpreter, which on L07 (~50 commands) overflowed a Worker's stack and
killed Lean on every new version of its text. The page reads the declarations from the text
instead; with that, the Chrome check of all 28 sheets saw no crash.

### What a switch costs

Measured in a browser (headless Chromium 151, the dev server on the same machine, so downloads
are much faster than over a network; the machine was busy with other work), from the selection
to "Checked":

| Switch | Lean restarts? | Time | Downloaded |
|---|---|---|---|
| First visit (nothing cached) | — | 17.7 s | 523 MB (runtime + environment) |
| Same environment (L04.1 → L04.2) | no | 1.6 s | nothing |
| Another environment, never seen | yes | 14.9 s | 324 MB, during the restart |
| Another environment, cached | yes | 13.6–15.1 s | nothing |
| Back to an evicted environment | yes | 14.0 s | 324 MB again |
| Reload, everything cached | — | 14.0 s | nothing |

Walking the catalogue in order, 18 of the 27 steps change environment. A restart's 14 s go to:

| Phase | Time |
|---|---|
| The 1.5 s settle, the wait for the old Lean (0–0.5 s), and the runtime from the HTTP cache | 1.9–2.1 s |
| Starting the new runtime | 3.4–4.3 s |
| Loading `init` | 0.1 s |
| Loading the ~1 GB environment from OPFS, until Lean serves | 2.2–3.2 s |
| Checking the sheet | 5.7–6.6 s (13 s for L07) |

Over a real network, a first visit and a switch to an environment not yet cached add the part of
the 225–324 MB download that the restart does not hide: the download starts at the switch, and
the new Lean needs it about 6 s later. At 100 Mbit/s it takes 18–26 s, at 10 Mbit/s 3–4.3 min.

## 5. Why not fewer environments

Fewer environments would mean fewer restarts and downloads. With one, walking the catalogue
would never restart Lean (it restarts 18 times today), and a student would download one
environment of about 324 MB instead of up to 3.73 GB for all 13 (an estimate: no union has been
baked). Tested natively with Lean 4.34 on the sheets as shipped (holes empty), the course's own
sheet text gives identical messages in a single environment holding the union of all imports
(once L07 imports `Customlib.WeakInduction` instead of carrying a copy of it), or in two
without that change (the union for the other 27 sheets, and L07's own entry).

But in the union, Verbose's automation knows more lemmas, and students' proofs behave
differently on every sheet that lacks the Customlib module behind each difference
(`WeakInduction`, which L07 copies; `Functions`; `Integers`): `Since n ≥ 4 we conclude that
2 ^ 4 ≤ 2 ^ n` succeeds where it fails natively, `f(1)` parses, and a type mismatch prints
`n is even` instead of `Even n`. On three sheets (L02.4, L02.6, L02.8) `We compute` also loses
three lemmas it has natively (`sum_icc_succ_top`, `sum_icc_zero_succ_top`,
`sum_icc_zero_succ_sq`); no proof is known whose verdict this changes. Exact environments are
what keeps a student's proof's verdict the same as in VS Code.

The safest merge is of the five entries with the same 4,825 modules in different orders (15
sheets, which also share one Verbose configuration): it adds no modules and no memory.
Natively, all 15 sheets give identical messages in one of those orders (`Reals, Lists`), and 18
restarts in the walk become 14. It is still not exact by construction (instances and simp
lemmas of equal priority depend on order), and only the shipped text was compared, not
students' proofs, so it is left out.

## 6. In production

The built page (`site/dist`) is served by a Cloudflare Worker (`site/edge/worker.js`, QED64's
edge library) with the cross-origin isolation headers. `/runtime/` comes from the toolchain
release's own copy in the shared R2 bucket (`lean4-wasm64/<release id>/`, uploaded once for
every site on that release), and `/snapshots/` from this site's prefix (`proof-sheets/`).
`site/scripts/deploy.sh` refuses to deploy unless every snapshot was baked against the
release's runtime and the release is already in the bucket. It then builds the page, uploads
the snapshots, then `index.json`, and deploys the Worker with the page last. The index goes up
after the snapshots so that a page never reads an index naming a snapshot that is not uploaded
yet. `rclone copy` never deletes, so older snapshots stay in R2 for pages opened before the
deploy.

Snapshot files are named by the sha256 of their `.snapz`, so a new bake gets a new name, and
they are served as immutable (never revalidated). `index.json`, the runtime manifest and the
page itself are revalidated on every load, so the first load after a deploy gets the new index,
and through it the new snapshots. The browser checks a downloaded snapshot's size, not its
hash.

The page never fetches from the GitHub release. `fetch` is a build lane that fills
`out/staging/snapshots`, and the page reads `/snapshots/` only from its own origin: the dev
server serves that directory, and production serves what `deploy.sh` uploaded from it to R2.
