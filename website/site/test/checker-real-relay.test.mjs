// The Checker (src/qed64.ts) with QED64's real LspRelay (test/stubs/qed64-embed-real.mjs): the
// relay's own rules decide when sessions are made — restart() only while serving, a crash or a
// failed boot reboots with the options of the last restart, three deaths stop it, an edit or
// rearm() starts it again. Each session boots the open sheet's entry, whatever those options say.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = path.join(site, "test/stubs/qed64-embed-real.mjs");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "checker-real-")), "bundle.mjs");
// One bundle holds the Checker, the stub and the real relay, so the test sees the stub's own log.
await build({
  stdin: { contents: `export { Checker } from ${JSON.stringify(path.join(site, "src/qed64.ts"))};\nexport * as embed from ${JSON.stringify(stub)};`, resolveDir: site, loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "warning",
  plugins: [{ name: "embed", setup: (b) => b.onResolve({ filter: /^qed64\/embed$/ }, () => ({ path: stub })) }],
});
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, ms === 1500 ? 0 : ms, ...a); // the Checker's settle: at once
globalThis.addEventListener ??= () => {};
const store = new Map();
let blocked = false;
globalThis.localStorage = {
  getItem: (k) => { if (blocked) throw new Error("SecurityError"); return store.get(k) ?? null; },
  setItem: (k, v) => { if (blocked) throw new Error("SecurityError"); store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
};
const { Checker, embed } = await import(pathToFileURL(out).href);
const { log, sessions } = embed;

const artifacts = { snapshots: { snapshots: ["init", "A", "B", "C"].map((name) => ({ name })) } };
const entryFor = (imports) => ({ "X.A": "A", "X.B": "B", "X.C": "C" })[imports.join("\n")] ?? null;
const view = { busy() {}, idle() {}, relay() {} };
const sheet = (e, body = "") => `import X.${e}\n-- sheet ${e}${body}`;
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => realSetTimeout(r, 2)); await new Promise((r) => setImmediate(r)); } };
const cur = () => sessions.at(-1);
const boots = () => log.filter((l) => l.startsWith("boot"));
let version = 0, made = [];
const didOpen = (text) => ({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///proofsheets/Sheet.lean", languageId: "lean4", version: ++version, text } } });
/** What main.ts's openSheet does: prepare, then the client's didOpen, then rearm. */
const openSheet = (c, text) => { c.prepare(text); c.relay.fromClient(didOpen(text)); c.relay.rearm(); };
const start = (text) => {
  const c = Reflect.construct(Checker, [artifacts, text, view, entryFor]);
  made.push(c);
  c.relay.fromClient({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
  c.relay.fromClient(didOpen(text));
  return c;
};
beforeEach(() => { log.length = 0; sessions.length = 0; store.clear(); blocked = false; });
afterEach(() => { for (const c of made) c.relay.clientPort.close(); made = []; });

test("a switch restarts once, onto the new sheet's entry", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  openSheet(c, sheet("B")); await flush(); cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot B"]);
  assert.equal(c.relay.state.kind, "serving");
});

test("back to A while B boots, and B's boot fails: Lean reboots onto A, not B", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  openSheet(c, sheet("B")); await flush();
  openSheet(c, sheet("A")); await flush();
  cur().fail("B's region failed to load"); await flush();
  cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot B", "boot A"]);
  assert.equal(c.relay.state.kind, "serving");
});

test("a crash after a switch reboots onto the open sheet's entry", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  openSheet(c, sheet("B")); await flush(); cur().finish(); await flush();
  cur().crash(); await flush(); cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot B", "boot B"]);
});

test("Lean stopped after repeated failures starts again when another sheet is opened", async () => {
  const c = start(sheet("A"));
  for (let i = 0; i < 3; i++) { cur().fail("boot failed"); await flush(); }
  assert.equal(c.relay.state.kind, "halted");
  openSheet(c, sheet("C")); await flush(); cur().finish(); await flush();
  assert.equal(boots().at(-1), "boot C");
  assert.equal(c.relay.state.kind, "serving");
});

test("with localStorage blocked the cache still keeps the previous environment", async () => {
  blocked = true;
  const c = start(sheet("A")); cur().finish(); await flush();
  openSheet(c, sheet("B")); await flush(); cur().finish(); await flush();
  assert.ok(!log.includes("evict A"), log.join(" | "));
  assert.ok(log.includes("evict C"));
});

test("a stored list of environments that is not a list does not stop Lean", async () => {
  store.set("proofsheets:v1:recentEnvironments", JSON.stringify("A"));
  const c = start(sheet("A")); cur().finish(); await flush();
  assert.equal(c.relay.state.kind, "serving");
});
