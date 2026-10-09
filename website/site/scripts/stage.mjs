#!/usr/bin/env node
// Generated inputs of the site, re-staged before every dev start and build (`npm run stage`):
//
// 1. public/workers/: QED64's five worker scripts, exactly closure.json's set (docs/EMBEDDING.md
//    §6.1 step 3). lean.worker.js gets one edit: the course's lakefile `leanOptions` are appended
//    to its `callMain(["--worker", …])` as -D flags. Native Lake passes them to Lean the same way;
//    QED64 has no option channel yet (website/README.md, Requests to QED64), so the staged copy
//    carries them. The edit must apply exactly once or the stage fails.
// 2. public/infoview/: @leanprover/infoview's dist (the InfoView ESM, its React builds, CSS).
// 3. public/sheets/: the course's sheets, verbatim, and public/sheets/index.json, the catalogue
//    (lectures, sheets, titles from `#doc`, exercise ids, imports, a content hash).
//
// The runtime and the snapshots are not staged: the dev and preview servers serve them from
// website/out (vite.config.ts), and production serves them from the edge (website/README.md, Deploy).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(site, "..", "..");
const pub = path.join(site, "public");
const require = createRequire(path.join(site, "package.json"));

// --- the course's Lean options (lakefile.toml [leanOptions], the one source) ----------------
export function leanOptions(lakefile = path.join(repo, "lakefile.toml")) {
  const opts = {};
  let inTable = false;
  for (const raw of fs.readFileSync(lakefile, "utf8").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("[")) { inTable = line === "[leanOptions]"; continue; }
    if (!inTable) continue;
    const m = /^([A-Za-z0-9_.]+)\s*=\s*(.+)$/.exec(line);
    if (!m) throw new Error(`lakefile.toml [leanOptions]: cannot read ${JSON.stringify(raw)}`);
    const v = m[2].trim();
    opts[m[1]] = v === "true" || v === "false" ? v === "true" : /^-?\d+$/.test(v) ? Number(v) : JSON.parse(v);
  }
  return opts;
}
const asFlags = (opts) => Object.entries(opts).map(([k, v]) => `-D${k}=${v}`);

// --- 1. workers -----------------------------------------------------------------------------
function stageWorkers(flags) {
  const pkg = path.dirname(require.resolve("qed64/package.json"));
  const closure = JSON.parse(fs.readFileSync(path.join(pkg, "embedding/closure.json"), "utf8"));
  if (closure.schema !== "qed64.closure/v1") throw new Error(`closure schema ${closure.schema}`);
  fs.rmSync(path.join(pub, "workers"), { recursive: true, force: true });
  for (const { path: from, serveAs } of closure.workers) {
    if (!serveAs.startsWith("/workers/")) throw new Error(`unexpected serveAs ${serveAs}`);
    const dst = path.join(pub, serveAs);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(pkg, from), dst);
  }
  const worker = path.join(pub, "workers/lean.worker.js");
  const src = fs.readFileSync(worker, "utf8");
  const needle = 'M.callMain(["--worker", "-Dserver.reportDelayMs=0"]);';
  const hits = src.split(needle).length - 1;
  if (hits !== 1) throw new Error(`lean.worker.js: expected the resident callMain line once, found it ${hits} times — re-check the option patch against this QED64 pin`);
  const patched = src.replace(needle,
    `M.callMain(["--worker", "-Dserver.reportDelayMs=0", ...${JSON.stringify(flags)}]); // proof-sheets: the course's lakefile leanOptions (site/scripts/stage.mjs)`);
  fs.writeFileSync(worker, patched);
  return { pin: JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8")).version ?? "?", workers: closure.workers.length };
}

// --- 2. InfoView ----------------------------------------------------------------------------
function stageInfoview() {
  const dist = path.join(path.dirname(require.resolve("@leanprover/infoview/package.json")), "dist");
  const dst = path.join(pub, "infoview");
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(dist, dst, { recursive: true });
}

// --- 3. sheets ------------------------------------------------------------------------------
const LECTURE = /^L(\d+)_(.+)$/;
export function sheetCatalogue() {
  const root = path.join(repo, "Bewijzen");
  const order = fs.readFileSync(path.join(repo, "Bewijzen.lean"), "utf8").split("\n")
    .map((l) => /^import Bewijzen\.(L\d+_[^.]+)\.(\S+)$/.exec(l.trim())).filter(Boolean).map((m) => `${m[1]}/${m[2]}`);
  const lectures = [];
  for (const dir of fs.readdirSync(root).filter((d) => LECTURE.test(d)).sort()) {
    const [, num, name] = LECTURE.exec(dir);
    const sheets = [];
    for (const file of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".lean")).sort()) {
      const rel = `${dir}/${file.slice(0, -5)}`;
      const text = fs.readFileSync(path.join(root, dir, file), "utf8");
      const title = /^#doc\s*\(WaterproofGenre\)\s*"([^"]*)"\s*=>/m.exec(text)?.[1] ?? file;
      const imports = text.split("\n").filter((l) => l.startsWith("import ")).map((l) => l.slice(7).trim());
      sheets.push({
        id: rel.replace(/\//g, "."), path: `sheets/${rel}.lean`, file: `Bewijzen/${rel}.lean`, title,
        exercises: [...text.matchAll(/^\s*Exercise\s+"([^"]+)"/gm)].map((m) => m[1]),
        holes: (text.match(/^\s*:::+\s*input\b/gm) ?? []).length,
        imports, sha256: crypto.createHash("sha256").update(text).digest("hex"),
        order: order.indexOf(rel),
      });
    }
    sheets.sort((a, b) => a.order - b.order);
    lectures.push({ id: dir, number: Number(num), title: name.replace(/_/g, " "), sheets: sheets.map(({ order: _o, ...s }) => s) });
  }
  return lectures;
}
/** The snapshot entry of each sheet (website/out/plan/entries.json, the bake plan): the page
 * boots exactly that environment for the sheet. Absent before the first plan: the page then
 * falls back to QED64's root matching. */
function entryOfSheets() {
  const plan = path.join(repo, "website/out/plan/entries.json");
  if (!fs.existsSync(plan)) return new Map();
  const { entries } = JSON.parse(fs.readFileSync(plan, "utf8"));
  return new Map(entries.flatMap((e) => e.sheets.map((id) => [id, e.name])));
}
function stageSheets() {
  const dst = path.join(pub, "sheets");
  fs.rmSync(dst, { recursive: true, force: true });
  fs.rmSync(path.join(pub, "fixtures"), { recursive: true, force: true });
  const entries = entryOfSheets();
  const lectures = sheetCatalogue();
  for (const l of lectures) for (const s of l.sheets) s.entry = entries.get(s.id) ?? null;
  for (const l of lectures) for (const s of l.sheets) {
    fs.mkdirSync(path.dirname(path.join(pub, s.path)), { recursive: true });
    fs.copyFileSync(path.join(repo, s.file), path.join(pub, s.path));
  }
  // Test fixtures (website/test/fixtures): sheet-shaped files with their own exercises, opened
  // with ?fixture=<name> by the browser checks. Not course content, not in the sheet list.
  const fixtures = [];
  const fdir = path.join(repo, "website/test/fixtures");
  if (fs.existsSync(fdir)) for (const f of fs.readdirSync(fdir).filter((x) => x.endsWith(".lean")).sort()) {
    fs.mkdirSync(path.join(pub, "fixtures"), { recursive: true });
    fs.copyFileSync(path.join(fdir, f), path.join(pub, "fixtures", f));
    const text = fs.readFileSync(path.join(fdir, f), "utf8");
    const imports = text.split("\n").filter((l) => l.startsWith("import ")).map((l) => l.slice(7).trim());
    const twin = lectures.flatMap((l) => l.sheets).find((s) => s.imports.join() === imports.join());
    fixtures.push({ id: `fixture.${f.slice(0, -5)}`, path: `fixtures/${f}`, title: `Fixture: ${f.slice(0, -5)}`, exercises: [], holes: 0,
      imports, sha256: crypto.createHash("sha256").update(text).digest("hex"), entry: twin?.entry ?? null });
  }
  const index = { schema: "proof-sheets.catalogue/v1", course: "Bewijzen in de Wiskunde", lectures, fixtures };
  fs.writeFileSync(path.join(dst, "index.json"), JSON.stringify(index, null, 1) + "\n");
  return lectures.reduce((n, l) => n + l.sheets.length, 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = leanOptions();
  const w = stageWorkers(asFlags(opts));
  stageInfoview();
  const n = stageSheets();
  console.log(`staged ${w.workers} QED64 workers (lean.worker.js with ${asFlags(opts).join(" ")}), the InfoView, ${n} sheets`);
}
