#!/usr/bin/env node
// Plan the course's snapshot entries: one per distinct environment the sheets elaborate in.
//
// Lean builds a file's environment by walking its header's imports depth-first, in order, and
// adding each module after its own imports (Init first). Environment extensions whose state is
// "the last module's" (Verbose's configuration) or that keep insertion order (instances and
// simp lemmas of equal priority) depend on that order, so two sheets share an environment only
// when their ordered import closures are identical. Sheets are grouped by exactly that; each
// group becomes one entry, baked from the group's shortest import list.
//
// usage: plan-entries.mjs --tree <olean tree> --out <plan.json>
// The tree must hold an .olean for every module the sheets reach (the bake tree does).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const tree = path.resolve(arg("tree") ?? "");
const out = path.resolve(arg("out") ?? "");
if (!arg("tree") || !arg("out")) { console.error("usage: plan-entries.mjs --tree <olean tree> --out <plan.json>"); process.exit(2); }

const { oleanImportEntries } = await import(path.join(here, "..", "out/tools/package/olean-imports.mjs"));
const { sheetCatalogue } = await import(path.join(here, "..", "site/scripts/stage.mjs"));

const importsCache = new Map();
function importsOf(mod) {
  if (importsCache.has(mod)) return importsCache.get(mod);
  const file = path.join(tree, ...mod.split(".")) + ".olean";
  if (!fs.existsSync(file)) throw new Error(`${mod}: no .olean in ${tree}`);
  const entries = oleanImportEntries(fs.readFileSync(file));
  if (!entries) throw new Error(`${mod}: unreadable olean header`);
  const mods = [];
  for (const e of entries) if (!mods.includes(e.module)) mods.push(e.module);
  importsCache.set(mod, mods);
  return mods;
}

/** The module order Lean imports a header in: depth-first, each module after its imports. */
function orderedClosure(headerImports) {
  const order = [], seen = new Set();
  const visit = (m) => {
    if (seen.has(m)) return;
    seen.add(m);
    for (const d of importsOf(m)) visit(d);
    order.push(m);
  };
  for (const m of ["Init", ...headerImports]) visit(m);
  return order;
}

const lectures = sheetCatalogue();
const groups = new Map();
for (const l of lectures) for (const s of l.sheets) {
  const order = orderedClosure(s.imports);
  const key = crypto.createHash("sha256").update(order.join("\n")).digest("hex");
  if (!groups.has(key)) groups.set(key, { key, order, sheets: [], importLists: [] });
  const g = groups.get(key);
  g.sheets.push({ id: s.id, lecture: l.number, imports: s.imports });
  if (!g.importLists.some((x) => x.join() === s.imports.join())) g.importLists.push(s.imports);
}

const entries = [...groups.values()].map((g) => {
  const imports = [...g.importLists].sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()))[0];
  const lecs = [...new Set(g.sheets.map((s) => s.lecture))].sort((a, b) => a - b);
  const roots = [...new Set(g.importLists.flat())];
  return {
    name: `sheets-${g.key.slice(0, 10)}`,
    imports,
    roots,
    label: `Lecture${lecs.length > 1 ? "s" : ""} ${lecs.join(", ")}`,
    modules: g.order.length,
    sheets: g.sheets.map((s) => s.id),
    alsoServes: g.importLists.filter((x) => x.join() !== imports.join()),
  };
}).sort((a, b) => a.modules - b.modules);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ schema: "proof-sheets.entries/v1", entries }, null, 1) + "\n");
for (const e of entries) {
  console.log(`${e.name}  ${String(e.modules).padStart(5)} modules  ${e.sheets.length} sheet(s)  imports: ${e.imports.join(" ")}${e.alsoServes.length ? `  (+${e.alsoServes.length} equivalent import list(s))` : ""}`);
}
console.log(`${entries.length} entries for ${lectures.reduce((n, l) => n + l.sheets.length, 0)} sheets`);
