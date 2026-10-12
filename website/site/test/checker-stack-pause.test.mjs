// The Checker + QED64 62a06e2's real LspRelay across a stack pause (HARDENING #72),
// with the page's real message ordering (client -> relay goes through a MessagePort, so the
// relay sees openSheet's didOpen AFTER openSheet's synchronous rearm()).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = path.join(site, "test/stubs/qed64-embed-real.mjs");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "checker-review-")), "bundle.mjs");
await build({
  stdin: { contents: `export { Checker } from ${JSON.stringify(path.join(site, "src/qed64.ts"))};\nexport * as embed from ${JSON.stringify(stub)};`, resolveDir: site, loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "warning",
  plugins: [{ name: "embed", setup: (b) => b.onResolve({ filter: /^qed64\/embed$/ }, () => ({ path: stub })) }],
});
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, ms === 1500 ? 0 : ms, ...a);
globalThis.addEventListener ??= () => {};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { Checker, embed } = await import(pathToFileURL(out).href);
const { log, sessions } = embed;

const artifacts = { snapshots: { snapshots: ["init", "A", "B", "C"].map((name) => ({ name })) } };
const entryFor = (imports) => ({ "X.A": "A", "X.B": "B", "X.C": "C" })[imports.join("\n")] ?? null;
const statuses = [];
const view = { busy() {}, idle() {}, relay(s) { statuses.push(s); } };
const sheet = (e, body = "") => `import X.${e}\n-- sheet ${e}${body}`;
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => realSetTimeout(r, 2)); await new Promise((r) => setImmediate(r)); } };
const cur = () => sessions.at(-1);
const boots = () => log.filter((l) => l.startsWith("boot"));
let version = 0, made = [];
const URI = "file:///proofsheets/Sheet.lean";
const didOpen = (text) => ({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: URI, languageId: "lean4", version: ++version, text } } });
const didChange = (text) => ({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri: URI, version: ++version }, contentChanges: [{ text }] } });
/** main.ts's openSheet with the port's real ordering: prepare, (didOpen posted), rearm, then the relay receives the didOpen. */
const openSheetReal = async (c, text) => { c.prepare(text); const m = didOpen(text); c.relay.rearm(); await Promise.resolve(); c.relay.fromClient(m); };
/** main.ts's onEditorChange: prepare, then the didChange (also via the port). */
const edit = async (c, text) => { c.prepare(text); await Promise.resolve(); c.relay.fromClient(didChange(text)); };
const start = (text) => {
  const c = Reflect.construct(Checker, [artifacts, text, view, entryFor]);
  made.push(c);
  c.relay.fromClient({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
  c.relay.fromClient(didOpen(text));
  return c;
};
const toClient = (c) => { const got = []; const orig = c.relay.toClient.bind(c.relay); c.relay.toClient = (m) => { got.push(m); orig(m); }; return got; };
beforeEach(() => { log.length = 0; sessions.length = 0; store.clear(); statuses.length = 0; });
afterEach(() => { for (const c of made) c.relay.clientPort.close(); made = []; });

test("one stack death halts at once; the page sees halted + ENGINE_STACK_OVERFLOW; the note sits on cause.line", async () => {
  const c = start(sheet("A", "\nline2\nline3")); const got = toClient(c); cur().finish(); await flush();
  cur().stack(2); await flush();
  assert.equal(c.relay.state.kind, "halted");
  assert.equal(statuses.at(-1).relay, "halted");
  assert.equal(statuses.at(-1).lastDeath?.cause?.code, "ENGINE_STACK_OVERFLOW");
  const note = got.find((m) => m.method === "textDocument/publishDiagnostics");
  assert.equal(note.params.diagnostics[0].range.start.line, 2);
  assert.deepEqual(boots(), ["boot A"]);
});

test("halted, then openSheet onto ANOTHER entry (real port order): boots the new entry", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  cur().stack(1); await flush();
  await openSheetReal(c, sheet("B")); await flush(); cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot B"]);
  assert.equal(c.relay.state.kind, "serving");
  // the session for B got the replayed didOpen with B's text
  const opened = cur().sent.filter((m) => m.method === "textDocument/didOpen").map((m) => m.params.textDocument.text);
  assert.ok(opened.at(-1).startsWith("import X.B"), JSON.stringify(opened));
});

test("halted, then an edit that changes the entry (teacher mode): boots the new entry", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  cur().stack(1); await flush();
  await edit(c, sheet("C")); await flush(); cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot C"]);
  assert.equal(c.relay.state.kind, "serving");
});

test("stack death during a switch's boot (B), then back to A via openSheet: A", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  await openSheetReal(c, sheet("B")); await flush(); cur().finish(); await flush();
  cur().stack(1); await flush();
  assert.equal(c.relay.state.kind, "halted");
  await openSheetReal(c, sheet("A")); await flush(); cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot B", "boot A"]);
});

test("stack death while BOOTING (before serving): halted; restart is not attempted; openSheet resumes", async () => {
  const c = start(sheet("A"));
  cur().stack(); await flush();
  assert.equal(c.relay.state.kind, "halted");
  await openSheetReal(c, sheet("A")); await flush(); cur().finish(); await flush();
  assert.deepEqual(boots(), ["boot A", "boot A"]);
  assert.equal(c.relay.state.kind, "serving");
});

test("after the resume serves, the notice-clearing condition (lastDeath && serving) holds", async () => {
  const c = start(sheet("A")); cur().finish(); await flush();
  cur().stack(1); await flush();
  await edit(c, sheet("A", " typed")); await flush(); cur().finish(); await flush();
  const serving = statuses.filter((s) => s.relay === "serving").at(-1);
  assert.ok(serving.lastDeath, "lastDeath still set when the relay first serves again");
});
