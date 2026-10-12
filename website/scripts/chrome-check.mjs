#!/usr/bin/env node
// Every sheet in real Chrome, held against native Lean: the check the build's browser lane
// (browser-check.mjs, the browser's FileWorker under Node) cannot make, because Node's thread
// stacks are larger than a Chrome Worker's (~500 KiB) and Lean's stack limits differ with them.
//
// It opens each sheet with a fresh page load (a cold Lean, as on a student's first visit) on a
// running dev or preview server, waits until the page shows "Checked" and a few seconds more,
// and compares Lean's final messages with out/check/native434/<sheet>.json as compare-checks.py
// does (a multiset of severity, line, column, text). Any difference, any Lean death (a Worker
// that overflowed its stack) or a sheet that never checks fails it.
//
//   npm --prefix website/site run dev          (or preview), then:
//   node website/scripts/chrome-check.mjs [--url http://localhost:5197/] [--sheets all|id,id]
//        [--out website/out/check/chrome] [--cap-s 360] [--settle-s 6]
//
// Needs Playwright's Chromium: `npx --prefix website/site playwright install chromium-headless-shell`
// (Playwright is a devDependency of the site), or PLAYWRIGHT=<path to playwright's index.mjs>.
// Writes <out>/<sheet>.json in check-sheets.py's format (so compare-checks.py reads it too) and
// <out>/summary.json; exits 1 unless every sheet equals native with no death.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("url", "http://localhost:5197/").replace(/\/?$/, "/");
const OUT = path.resolve(arg("out", path.join(W, "out/check/chrome")));
const CAP_MS = Number(arg("cap-s", "360")) * 1000;
const SETTLE_MS = Number(arg("settle-s", "6")) * 1000;
const NATIVE = path.join(W, "out/check/native434");

let playwright;
try {
  playwright = process.env.PLAYWRIGHT
    ? await import(pathToFileURL(process.env.PLAYWRIGHT).href)
    : await import(pathToFileURL(createRequire(path.join(W, "site/package.json")).resolve("playwright")).href);
} catch (e) {
  die(`no Playwright (${e.message.split("\n")[0]}): npm --prefix website/site ci, then npx --prefix website/site playwright install chromium-headless-shell`);
}
const { chromium } = playwright.default ?? playwright;

const catalogue = await (await fetch(new URL("sheets/index.json", BASE))).json();
const all = catalogue.lectures.flatMap((l) => l.sheets);
const pick = arg("sheets", "all");
const sheets = pick === "all" ? all : pick.split(",").map((id) => all.find((s) => s.id === id) ?? die(`no sheet ${id}`));
function die(m) { console.error(`chrome-check: ${m}`); process.exit(2); }

// Lean's LSP positions: 0-based lines, UTF-16 columns; check-sheets.py's: 1-based lines, code points.
const SEVERITY = { 1: "error", 2: "warning", 3: "information", 4: "information" };
const asNative = (diags, text) => {
  const lines = text.split("\n");
  return diags.map((d) => ({
    severity: SEVERITY[d.severity] ?? String(d.severity), line: d.range.start.line + 1,
    col: [...(lines[d.range.start.line] ?? "").slice(0, d.range.start.character)].length, text: String(d.message),
  }));
};
const key = (m) => JSON.stringify([m.severity, m.line, m.col, m.text.trim()]);
function difference(a, b) { // a minus b, as multisets
  const left = new Map();
  for (const m of b) left.set(key(m), (left.get(key(m)) ?? 0) + 1);
  return a.filter((m) => { const n = left.get(key(m)) ?? 0; if (n > 0) { left.set(key(m), n - 1); return false; } return true; });
}

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(OUT, ".profile-"));
const context = await chromium.launchPersistentContext(profile, { headless: true });
const results = [];
try {
  for (const s of sheets) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    const t0 = Date.now();
    await page.goto(new URL(`?sheet=${encodeURIComponent(s.id)}`, BASE).href);
    // Checked, on a serving relay, with nothing pending: the final state for this text.
    let state = null, maxRunning = -1;
    while (Date.now() - t0 < CAP_MS) {
      state = await page.evaluate(() => {
        const p = globalThis.__proofsheets;
        const st = p?.checker?.relay?.status();
        return { pill: document.getElementById("status")?.textContent ?? "", relay: st?.relay ?? null, running: st?.pool?.running ?? -1 };
      }).catch(() => null);
      maxRunning = Math.max(maxRunning, state?.running ?? -1); // the pool under Lean's default Elab.async (stage.mjs workerOptions)
      if (state?.pill === "Checked" && state.relay === "serving") break;
      if (state?.relay === "halted") break;
      await page.waitForTimeout(250);
    }
    const checkedAt = state?.pill === "Checked" ? (Date.now() - t0) / 1000 : null;
    if (checkedAt !== null) await page.waitForTimeout(SETTLE_MS);
    const final = await page.evaluate(() => {
      const p = globalThis.__proofsheets;
      const r = p.checker.relay;
      return { text: p.doc.getText(), diagnostics: p.client.diagnostics, relay: r.status(), deaths: r.stats.workerDeaths, stackPauses: r.stats.stackPauses ?? 0 };
    });
    await page.close();
    const text = fs.readFileSync(path.join(W, "site/public", s.path), "utf8");
    if (final.text !== text) die(`${s.id}: the page shows other text than the sheet (saved work in the profile?)`);
    const chrome = asNative(final.diagnostics, text);
    const native = JSON.parse(fs.readFileSync(path.join(NATIVE, `${s.id}.json`), "utf8")).messages;
    const onlyChrome = difference(chrome, native), onlyNative = difference(native, chrome);
    // A halt is not a death of its own: a stack pause (HARDENING #72) is one counted death, the breaker three.
    const deaths = final.deaths;
    const cause = final.relay.lastDeath?.cause ? { code: final.relay.lastDeath.cause.code, line: final.relay.lastDeath.cause.line ?? null } : null;
    const pool = { maxRunning: Math.max(maxRunning, final.relay.pool?.running ?? -1), grown: final.relay.pool?.grown ?? null };
    const ok = checkedAt !== null && final.relay.relay === "serving" && deaths === 0 && !onlyChrome.length && !onlyNative.length;
    fs.writeFileSync(path.join(OUT, `${s.id}.json`), JSON.stringify({ sheet: s.id, rc: ok ? 0 : 1, seconds: checkedAt, runtime: "Chrome (website/scripts/chrome-check.mjs)", messages: chrome }, null, 1));
    results.push({ sheet: s.id, ok, checkedSeconds: checkedAt, deaths, relay: final.relay.relay, onlyChrome, onlyNative, stackPauses: final.stackPauses, cause, pool, pageErrors: errors.length });
    console.log(`${ok ? "✓" : "✗"} ${s.id}: ${checkedAt === null ? "never Checked" : `${checkedAt.toFixed(1)} s`}` +
      `${deaths ? `, ${deaths} Lean death(s)` : ""}${cause && deaths ? ` (${cause.code}${cause.line !== null ? ` at line ${cause.line + 1}` : ""})` : ""}` +
      `${final.stackPauses ? `, checking paused (stack)` : ""}${pool.grown ? `, thread pool grew ${pool.grown}× (max ${pool.maxRunning} running)` : ""}${onlyChrome.length || onlyNative.length ? `, ${onlyChrome.length} only in Chrome, ${onlyNative.length} only native` : ""}`);
    for (const m of onlyChrome) console.log(`    + ${m.line}:${m.col} ${m.text.split("\n")[0].slice(0, 140)}`);
    for (const m of onlyNative) console.log(`    - ${m.line}:${m.col} ${m.text.split("\n")[0].slice(0, 140)}`);
  }
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ url: BASE, sheets: results.length, failing: bad.map((r) => r.sheet), results }, null, 1));
console.log(`${results.length} sheets in Chrome: ${results.length - bad.length} equal native Lean, ${bad.length} differ or die`);
process.exit(bad.length ? 1 : 0);
