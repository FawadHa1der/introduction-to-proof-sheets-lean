#!/usr/bin/env node
// Elaborate one proof sheet with the browser's Lean: the toolchain release's wasm64 runtime
// under Node, its environment seeded from the baked snapshots, the real resident FileWorker
// (`--worker`) driven over LSP through the stdin ring, exactly as QED64's lean.worker.js does
// in the page. The sheet's final diagnostics are written in check-sheets.py's format, so
// compare-checks.py can hold the browser's verdict against native Lean's.
//
// Adapted from QED64's pipeline/snapshot/resident-probe.mjs (MIT, github.com/FawadHa1der/QED64):
// the boot sequence, the stdin ring and the per-byte stdout tap are that probe's.
//
//   node --stack-size=8192 browser-check.mjs --qed64 <QED64 checkout or package> --artifact <dir>
//        --lib <bake tree> --snap-dir <dir> --snapshots init,<entry> --sheet <file> --out <json>
//        [--opt k=v ...] [--budget-ms 900000] [--repo <course checkout>]
//
// Exit 0 when the sheet's elaboration finished (progress drained) and the JSON was written;
// 1 on a budget overrun, an abort or a runtime failure. It is not a verdict on the sheet.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const args = (n) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const need = (n) => { const v = arg(n); if (!v) { console.error(`browser-check: --${n} is required`); process.exit(2); } return v; };

const qed64 = path.resolve(need("qed64"));
const artifactDir = path.resolve(need("artifact"));
const libLean = path.resolve(need("lib"));
const snapDir = path.resolve(need("snap-dir"));
const snapshots = need("snapshots").split(",").filter(Boolean);
const sheet = path.resolve(need("sheet"));
const outFile = path.resolve(need("out"));
const repo = path.resolve(arg("repo", path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..")));
const budgetMs = Number(arg("budget-ms", "900000"));
const leanOpts = args("opt").map((o) => `-D${o}`);
const leanJs = path.join(artifactDir, "bin/lean.js");
for (const p of [leanJs, libLean, ...snapshots.map((s) => path.join(snapDir, `${s}.snap`)), sheet]) {
  if (!fs.existsSync(p)) { console.error(`browser-check: ${p} not found`); process.exit(2); }
}
// The worker's own frame decoder (one copy of the LSP framing rules).
await import(pathToFileURL(path.join(qed64, "public/workers/lsp-frames.js")).href);

const TEXT = fs.readFileSync(sheet, "utf8");
const URI = "file:///workspace/" + path.basename(sheet);
const t0 = Date.now();
const log = (s) => { if (!process.env.QUIET) console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); };
const enc = new TextEncoder();

// --- the result ---------------------------------------------------------------------------
const lines = TEXT.split("\n");
/** LSP positions count UTF-16 code units; `lean --json` counts code points. */
const cpCol = (line, ch) => {
  const s = lines[line] ?? "";
  return [...s.slice(0, ch)].length;
};
function holes(text) {
  // as check-sheets.py: in each ::::multilean block holding :::input blocks, from its first
  // hole to the block's closing fence
  const out = []; let block = null, first = null;
  text.split("\n").forEach((line, idx) => {
    const i = idx + 1, s = line.trim();
    if (block === null && /^::::+\s*multilean\b/.test(s)) { block = i; first = null; }
    else if (block !== null && first === null && /^:::+\s*input\b/.test(s)) first = i;
    else if (block !== null && /^::::+\s*$/.test(s)) { if (first !== null) out.push([first, i]); block = null; }
  });
  return out;
}
const HS = holes(TEXT);
const SEV = { 1: "error", 2: "warning", 3: "information", 4: "information" };
let lastDiagnostics = [];
let progressEvents = 0, drainedAt = 0, firstProgressAt = 0, sawProcessing = false;
let finished = false;
function finish(ok, why) {
  if (finished) return;
  finished = true;
  const messages = lastDiagnostics.map((d) => {
    const line = d.range.start.line + 1, endLine = d.range.end.line + 1;
    return { severity: SEV[d.severity] ?? String(d.severity), line, col: cpCol(d.range.start.line, d.range.start.character),
      endLine, endCol: cpCol(d.range.end.line, d.range.end.character), text: String(d.message),
      inHole: HS.some(([s, e]) => s <= line && line <= e) };
  });
  const rec = { sheet: path.relative(repo, sheet), rc: ok ? 0 : 1, why, seconds: Math.round((Date.now() - t0) / 100) / 10,
    elaborationSeconds: firstProgressAt && drainedAt ? Math.round((drainedAt - firstProgressAt) / 100) / 10 : null,
    holes: (TEXT.match(/^\s*:::+\s*input\b/gm) ?? []).length, messages, stderr: "", runtime: "wasm64 (QED64 resident FileWorker)",
    snapshots, leanOptions: leanOpts, peakRssGB: Math.round(peakRss / 1e7) / 100 };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(rec, null, 1));
  log(`${ok ? "DONE" : "FAILED"} (${why}): ${messages.length} diagnostics, elaboration ${rec.elaborationSeconds}s → ${outFile}`);
  process.exit(ok ? 0 : 1);
}
setTimeout(() => finish(false, "budget exceeded"), budgetMs).unref?.();
let peakRss = 0;
setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 1000).unref?.();

// --- LSP over the ring --------------------------------------------------------------------
const { LspFrameDecoder } = globalThis.Qed64LspFrames;
const frames = new LspFrameDecoder({
  onFrame(body) { try { onMessage(JSON.parse(body)); } catch { log(`unparseable frame: ${body.slice(0, 80)}`); } },
  onJunk(line) { log(`stdout-log: ${line.slice(0, 120)}`); },
});
function installStdoutTap() {
  const M = globalThis.Module;
  const tty = globalThis.TTY?.ttys?.[M.FS.makedev(5, 0)];
  if (!tty?.ops?.put_char) return finish(false, "stdout tap: TTY for /dev/stdout not in scope");
  const orig = tty.ops;
  tty.ops = { ...orig, put_char(t, val) {
    if (t.output?.length > 0) orig.fsync(t);
    if (val !== null) frames.push(val);
  } };
}
let settleTimer = null;
function onMessage(msg) {
  if (process.env.DUMP_MSGS) log(`MSG ${msg.method ?? `resp#${msg.id}`}: ${JSON.stringify(msg.params ?? msg.result ?? msg.error ?? null).slice(0, 300)}`);
  if (msg.id !== undefined && msg.method !== undefined) { send({ jsonrpc: "2.0", id: msg.id, result: null }); return; }
  if (msg.method === "$/lean/fileProgress") {
    progressEvents += 1;
    const processing = msg.params?.processing ?? [];
    if (processing.length > 0) {
      sawProcessing = true;
      if (!firstProgressAt) firstProgressAt = Date.now();
      drainedAt = 0;
      clearTimeout(settleTimer); // the drain was a gap between commands
    } else if (sawProcessing && !drainedAt) {
      drainedAt = Date.now();
      // diagnostics for the last commands can follow the drained progress, and a gap between
      // commands can look drained: finish only when it stays drained
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { closeRing(); setTimeout(() => finish(true, "progress drained"), 500); }, 5000);
    }
    return;
  }
  if (msg.method === "textDocument/publishDiagnostics" && msg.params?.uri === URI) {
    // The worker's notice that this harness closed its input ring replaces the whole set; it is
    // not the document's verdict, so the set before it stands.
    const ds = msg.params.diagnostics ?? [];
    if (ds.some((d) => /^Cannot read LSP message: Stream was closed/.test(String(d.message)))) return;
    lastDiagnostics = ds;
  }
}
const CAP = 64 << 20;
// The page's thread setup, read from the pinned lean.worker.js (absent in pins before QED64's
// HARDENING #69): the task manager's size cap and the parked dedicated threads.
let WORKERS_MAX = 0, PARKED = null;
{
  const src = fs.readFileSync(path.join(qed64, "public/workers/lean.worker.js"), "utf8");
  const m = /const RESIDENT_RING_CAP = (\d+) << (\d+);/.exec(src);
  if (!m || (Number(m[1]) << Number(m[2])) !== CAP) throw new Error("browser-check: ring size differs from lean.worker.js RESIDENT_RING_CAP");
  WORKERS_MAX = Number(/const LEAN_WORKERS_MAX = (\d+);/.exec(src)?.[1] ?? 0);
  PARKED = /const PARKED_DEDICATED = "(\d+)";/.exec(src)?.[1] ?? null;
}
let ring = null;
const IDX = { READ: 0, WRITE: 1, CLOSED: 2, WAKE: 3 };
function views() {
  const mem = globalThis.Module.wasmMemory ?? globalThis.wasmMemory ?? { buffer: globalThis.Module.HEAPU8?.buffer };
  return { ctrl: new Int32Array(mem.buffer, ring.ctrlPtr, 4), bytes: new Uint8Array(mem.buffer, ring.ctrlPtr + 16, CAP) };
}
function ringWrite(payload) {
  let off = 0;
  const pump = () => {
    const { ctrl, bytes } = views();
    while (off < payload.length) {
      const read = Atomics.load(ctrl, IDX.READ), write = Atomics.load(ctrl, IDX.WRITE);
      const free = (read - write - 1 + CAP) % CAP;
      if (free === 0) { setTimeout(pump, 2); return; }
      const n = Math.min(free, CAP - write, payload.length - off);
      bytes.set(payload.subarray(off, off + n), write);
      off += n;
      Atomics.store(ctrl, IDX.WRITE, (write + n) % CAP);
      Atomics.add(ctrl, IDX.WAKE, 1);
      Atomics.notify(ctrl, IDX.WAKE);
    }
  };
  pump();
}
function send(obj) {
  const body = enc.encode(JSON.stringify(obj));
  const header = enc.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const frame = new Uint8Array(header.length + body.length);
  frame.set(header, 0); frame.set(body, header.length);
  ringWrite(frame);
}
function closeRing() {
  const { ctrl } = views();
  Atomics.store(ctrl, IDX.CLOSED, 1);
  Atomics.add(ctrl, IDX.WAKE, 1);
  Atomics.notify(ctrl, IDX.WAKE);
}

// --- boot ---------------------------------------------------------------------------------
process.chdir("/");
process.argv[1] = "/bin/lean";
globalThis.Module = {
  noInitialRun: true,
  locateFile: (f) => path.join(path.dirname(leanJs), f),
  mainScriptUrlOrBlob: leanJs,
  print: (t) => { for (const l of String(t).split("\n")) if (l.trim()) log(`stdout-log: ${l.slice(0, 120)}`); },
  printErr: (t) => { if (process.env.VERBOSE && !/^\s*$/.test(t)) log(`stderr: ${String(t).slice(0, 160)}`); },
  preRun: [function mount() {
    const FS = globalThis.Module.FS;
    const NODEFS = FS.filesystems.NODEFS;
    const mkdirTree = (p) => { let c = ""; for (const part of p.split("/").filter(Boolean)) { c += `/${part}`; try { FS.mkdir(c); } catch { /* exists */ } } };
    for (const dir of ["/lib/lean", "/bin", "/workspace"]) mkdirTree(dir);
    FS.mount(NODEFS, { root: libLean }, "/lib/lean");
    mkdirTree(artifactDir);
    FS.mount(NODEFS, { root: artifactDir }, artifactDir);
    FS.writeFile("/workspace/" + path.basename(sheet), TEXT);
    globalThis.Module.ENV.LEAN_PATH = "/lib/lean";
    globalThis.Module.ENV.LEAN_SYSROOT = "/";
    if (PARKED !== null) globalThis.Module.ENV.LEAN_WASM_PARKED_DEDICATED = PARKED; // at preRun, where getenv reads it
    FS.chdir("/workspace");
  }],
  onRuntimeInitialized() {
    const M = globalThis.Module;
    M._lean_initialize_runtime_module();
    M._lean_initialize();
    M._lean_io_mark_end_initialization();
    if (WORKERS_MAX && M._lean_init_task_manager_using) M._lean_init_task_manager_using(Math.max(1, Math.min(os.availableParallelism(), WORKERS_MAX)));
    else if (M._lean_init_task_manager) M._lean_init_task_manager();
    if (M._lean_enable_initializer_execution) M._lean_enable_initializer_execution();
    M._lean_init_search_path();
    M._lean_wasm_shell_mark_preinitialized();
    for (const name of snapshots) {
      const host = path.join(snapDir, `${name}.snap`);
      const total = fs.statSync(host).size;
      const raw = M._malloc(BigInt(total));
      const ptr = typeof raw === "bigint" ? Number(raw) : raw;
      const fd = fs.openSync(host, "r");
      const CH = 64 * 1024 * 1024, b = new Uint8Array(CH);
      for (let at = 0; at < total;) {
        const n = fs.readSync(fd, b, 0, Math.min(CH, total - at), at);
        new Uint8Array((M.wasmMemory ?? globalThis.wasmMemory).buffer, ptr + at, n).set(b.subarray(0, n));
        at += n;
      }
      fs.closeSync(fd);
      M._lean_wasm_load_snapshot_mem(BigInt(ptr), BigInt(total), 1n);
      log(`${name}.snap loaded (${(total / 1e6).toFixed(0)} MB)`);
    }
    const raw = M._malloc(16 + CAP);
    ring = { ctrlPtr: typeof raw === "bigint" ? Number(raw) : raw };
    const status = M._lean_browser64_configure_input_ring(typeof raw === "bigint" ? raw : BigInt(raw), CAP);
    if (status !== 0) return finish(false, `ring rejected: ${status}`);
    installStdoutTap();
    // The page's worker passes -Dserver.reportDelayMs=0 (lean.worker.js); the worker options
    // follow as -D flags (stage.mjs workerOptions: the course's lakefile leanOptions), as the
    // website's staged worker passes them.
    M.callMain(["--worker", "-Dserver.reportDelayMs=0", ...leanOpts]);
    log(`--worker started with ${leanOpts.join(" ") || "no extra options"}; opening ${path.basename(sheet)}`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: null, capabilities: {} } });
    send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: {
      textDocument: { uri: URI, languageId: "lean4", version: 1, text: TEXT } } });
  },
  onExit: (code) => { if (!finished) finish(drainedAt > 0, `worker exited (${code})`); },
  onAbort: (what) => finish(false, `ABORT: ${what}`),
};
globalThis.require = createRequire(leanJs);
globalThis.__filename = "/bin/lean.js";
globalThis.__dirname = "/bin";
vm.runInThisContext(fs.readFileSync(leanJs, "utf8"), { filename: leanJs });
