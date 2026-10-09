// The Checker's environment switches (src/qed64.ts), against a stub relay (test/stubs): Lean
// restarts exactly when the open text needs another snapshot entry than the session serves, a
// switch during a boot is never lost and never repeated, and a switch starts its download.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = path.join(site, "test/stubs/qed64-embed.mjs");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "checker-")), "qed64.mjs");
// The stub stays external, so the test and the bundle share one instance of it.
const external = { name: "stub", setup: (b) => b.onResolve({ filter: /^qed64\/embed$/ }, () => ({ path: pathToFileURL(stub).href, external: true })) };
await build({ entryPoints: [path.join(site, "src/qed64.ts")], bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [external], logLevel: "warning" });
globalThis.addEventListener ??= () => {};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { Checker } = await import(pathToFileURL(out).href);
const { log, LspRelay, cached } = await import(pathToFileURL(stub).href);

const artifacts = { snapshots: { snapshots: ["init", "A", "B", "C"].map((name) => ({ name })) } };
const entryFor = (imports) => ({ "X.A": "A", "X.B": "B", "X.C": "C" })[imports.join("\n")] ?? null;
const view = { busy() {}, idle() {}, relay() {} };
const sheet = (e, body = "") => `import X.${e}\n-- sheet ${e}${body}`;
const make = (text) => Reflect.construct(Checker, [artifacts, text, view, entryFor]);
const relay = () => LspRelay.last;
const steps = () => log.filter((l) => /^(boot|serving|prefetch|abort)/.test(l));
beforeEach(() => { log.length = 0; store.clear(); cached.clear(); });

test("a sheet with the same entry is a text change: no restart, no download", () => {
  const c = make(sheet("A")); relay().serve();
  c.prepare(sheet("A", " (another sheet)")); c.prepare(sheet("A", " (typed)"));
  assert.deepEqual(steps(), ["boot A", "serving A"]);
});

test("another entry restarts Lean onto it and starts its download at once", () => {
  const c = make(sheet("A")); relay().serve();
  c.prepare(sheet("B"));
  assert.deepEqual(steps(), ["boot A", "serving A", "prefetch B", "boot B"]);
});

test("a switch during a boot waits for the boot, and typing does not lose it", () => {
  const c = make(sheet("A"));
  c.prepare(sheet("B")); c.prepare(sheet("B", " (typed)"));
  relay().serve(); relay().serve();
  assert.deepEqual(steps(), ["boot A", "prefetch B", "serving A", "boot B", "serving B"]);
});

test("switching away and back during a boot restarts nothing more", () => {
  const c = make(sheet("A")); relay().serve();
  c.prepare(sheet("B")); c.prepare(sheet("A")); c.prepare(sheet("B"));
  relay().serve();
  // B's boot fetches B itself: the switch back stops the other downloads and starts none.
  assert.deepEqual(steps(), ["boot A", "serving A", "prefetch B", "boot B", "abort B", "prefetch A", "abort A", "serving B"]);
});

test("back to the booting entry during a later switch's wait cancels that switch", () => {
  const c = make(sheet("A")); relay().serve();
  c.prepare(sheet("B")); c.prepare(sheet("C")); c.prepare(sheet("B"));
  relay().serve();
  assert.deepEqual(steps().filter((l) => /^(boot|serving)/.test(l)), ["boot A", "serving A", "boot B", "serving B"]);
});

test("a crash reboots onto the open text's entry", () => {
  const c = make(sheet("A")); relay().serve();
  c.prepare(sheet("B")); relay().serve();
  relay().crash(); relay().serve();
  c.prepare(sheet("B", " (typed)"));
  assert.deepEqual(steps().filter((l) => /^(boot|serving)/.test(l)), ["boot A", "serving A", "boot B", "serving B", "boot B", "serving B"]);
});

test("the cache keeps the two most recent environments and the target, across visits", async () => {
  cached.add("A"); cached.add("B"); cached.add("C");
  make(sheet("A")); relay().serve();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(log.filter((l) => l.startsWith("evict")).sort(), ["evict B", "evict C"]);
  assert.deepEqual(JSON.parse(store.get("proofsheets:v1:recentEnvironments")), ["A"]);
  cached.add("B"); cached.add("C"); log.length = 0;
  const c = make(sheet("B")); relay().serve(); // a later visit: A is still recent
  c.prepare(sheet("C")); relay().serve();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(store.get("proofsheets:v1:recentEnvironments")), ["C", "B"]);
  assert.ok(log.includes("evict A"));
});
