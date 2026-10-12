#!/usr/bin/env node
// What a snapshot entry's bake and its browser check depend on, besides its imports' names
// (which its name already hashes). The bake lane keeps each only while its marker holds the
// current fingerprint:
// - bake (out/check/browser/.<entry>.baked): the compiled overlay's contents (out/build/lib, and
//   the Mathlib modules compiled into out/build/fill: those that are not hard links into the
//   packs), the runtime, and the bake's runner (QED64's pipeline/snapshot/node-runner.mjs, or
//   $QED64_RUNNER): a snapshot is the runtime's state after the runner imported them, so the
//   rest of QED64 (its page, its bake-snapshot.mjs bookkeeping) does not rebake (the bake takes
//   no Lean options either);
// - check (out/check/browser/.<entry>.ok): the bake fingerprint, the QED64 pin, the page's
//   FileWorker options, the staged snapshot's digest, and the text of each of the entry's sheets
//   with native Lean's messages for it. A changed sheet, option or QED64 is checked again without
//   a rebake (a rebake renames the snapshot: baking is not byte-deterministic, and every student
//   would download it again).
//
//   fingerprint.mjs --out <website/out> --runtime <id> --qed64 <commit> --runner <node-runner.mjs> --opts <-Dk=v,...> [--entry <name>]
//     prints "<entry>\t<bake>\t<check>" for every entry of out/plan/entries.json (or one)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** [{ entry, bake, check }] for the entries of out/plan/entries.json (or the one named). */
export function fingerprints({ out, runtime, qed64, runner, opts = "", entry = null }) {
  const files = [];
  const walk = (root, dir, keep) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(root, p, keep);
      else if (e.name.endsWith(".olean") && keep(p, path.relative(root, p))) files.push([path.relative(root, p), sha256(fs.readFileSync(p))]);
    }
  };
  const lib = path.join(out, "build/lib"), fill = path.join(out, "build/fill"), fat = path.join(out, "trees/fat");
  if (fs.existsSync(lib)) walk(lib, lib, () => true);
  const ino = (p) => { try { return fs.statSync(p).ino; } catch { return -1; } };
  if (fs.existsSync(fill)) walk(fill, fill, (p, rel) => ino(path.join(fat, rel)) !== fs.statSync(p).ino);
  files.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const bake = sha256(JSON.stringify({ files, runtime, runner: sha256(fs.readFileSync(runner)) }));

  const indexFile = path.join(out, "staging/snapshots/index.json");
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { snapshots: [] };
  const plan = JSON.parse(fs.readFileSync(path.join(out, "plan/entries.json"), "utf8"));
  return plan.entries.filter((e) => !entry || e.name === entry).map((e) => {
    const sheets = e.sheets.map((id) => {
      const text = fs.readFileSync(path.join(REPO, "Bewijzen", id.replace(".", "/") + ".lean"));
      const nativeFile = path.join(out, "check/native434", `${id}.json`);
      const native = fs.existsSync(nativeFile)
        ? JSON.parse(fs.readFileSync(nativeFile, "utf8")).messages.map((m) => [m.severity, m.line, m.col, m.text.trim()]).sort()
        : null;
      return [id, sha256(text), sha256(JSON.stringify(native))];
    });
    const staged = index.snapshots.find((x) => x.name === e.name && x.runtime === runtime)?.digest ?? null;
    return { entry: e.name, bake, check: sha256(JSON.stringify({ bake, qed64, opts, staged, sheets })) };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!arg("out") || !arg("runtime") || !arg("qed64") || !arg("runner")) {
    console.error("usage: fingerprint.mjs --out <dir> --runtime <id> --qed64 <commit> --runner <node-runner.mjs> --opts <csv> [--entry <name>]");
    process.exit(2);
  }
  for (const f of fingerprints({ out: path.resolve(arg("out")), runtime: arg("runtime"), qed64: arg("qed64"), runner: path.resolve(arg("runner")), opts: arg("opts") ?? "", entry: arg("entry") ?? null })) {
    console.log(`${f.entry}\t${f.bake}\t${f.check}`);
  }
}
