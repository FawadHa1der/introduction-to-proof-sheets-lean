// Every sheet through the editor's Lean file format (the vendored waterproof-vscode parser):
// it parses, and it has exactly one input area per exercise hole. Run after `npm run stage`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(fs.readFileSync(path.join(site, "public/sheets/index.json"), "utf8"));

async function parser() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lean-format-")), "bundle.mjs");
  await build({ entryPoints: [path.join(site, "src/lean-format/document-construction/construct-document.ts")],
    bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "warning" });
  return (await import(pathToFileURL(out).href)).topLevelBlocksLean;
}
const count = (blocks, type) => blocks.reduce((n, b) => n + (b.type === type ? 1 : 0) + (b.innerBlocks ? count(b.innerBlocks, type) : 0), 0);

test("every sheet parses into editor blocks with one input area per hole", async () => {
  const parse = await parser();
  const sheets = index.lectures.flatMap((l) => l.sheets);
  assert.equal(sheets.length, 28);
  for (const s of sheets) {
    const blocks = parse(fs.readFileSync(path.join(site, "public", s.path), "utf8"));
    assert.equal(count(blocks, "input"), s.holes, s.id);
  }
});

test("every sheet has a snapshot entry", () => {
  for (const s of index.lectures.flatMap((l) => l.sheets)) assert.match(s.entry ?? "", /^sheets-[0-9a-f]{10}$/, s.id);
});
