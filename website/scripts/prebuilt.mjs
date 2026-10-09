#!/usr/bin/env node
// The prebuilt environments: the baked, browser-checked snapshots and the plan that maps each
// sheet to its entry, published once (scripts/publish-prebuilt.sh) so that anyone can run the
// site without the two-hour build (website/build.sh --prebuilt).
//
//   prebuilt.mjs pack  --out <website/out> --dest <dir> --release <id> --runtime <build id>
//       Collects out/staging/snapshots (every .snapz and index.json) and out/plan/entries.json
//       into <dir> with prebuilt.json, the record of every file (bytes, sha256, where it goes).
//       Refuses snapshots of another runtime and entries whose sheets were not browser-checked
//       (out/check/browser/.<entry>.ok). Prints the record's sha256: the pin.
//   prebuilt.mjs fetch --from <url|dir> --digest sha256:<hex> --out <website/out> --release <id> --runtime <build id>
//       Fetches prebuilt.json, refuses it unless its sha256 is the pin and it was made for this
//       release and runtime, then fetches every file (by name, from a GitHub release URL or a
//       directory) into place, each verified; files already in place are kept. The index comes
//       last, so a page never sees an index that names a missing snapshot.
//   prebuilt.mjs inputs
//       Prints the hash of the course inputs the environments are made from.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(W, "..");
const SCHEMA = "proof-sheets.prebuilt/v1";
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const die = (m) => { console.error(`prebuilt: ${m}`); process.exit(1); };
const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i].startsWith("--") || rest[i + 1] === undefined) die(`bad arguments: ${rest.join(" ")}`);
  args[rest[i].slice(2)] = rest[i + 1];
}
const need = (k) => args[k] ?? die(`--${k} is required`);

/** The course inputs the environments are made from: Customlib, the course's Lean options, the
 * forks' patches, the pinned sources and the compiler options. Fetching environments made from
 * other inputs works, but their messages may differ from this checkout's: the fetch warns. */
async function inputsHash() {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(REPO, rel);
    if (fs.statSync(abs).isDirectory()) for (const f of fs.readdirSync(abs).sort()) walk(path.join(rel, f));
    else files.push([rel.split(path.sep).join("/"), sha256(fs.readFileSync(abs))]);
  };
  for (const rel of ["Bewijzen/Customlib", "Bewijzen/Customlib.lean", "website/patches", "website/scripts/compile-args.sh"]) walk(rel);
  const { release, forks, deps } = JSON.parse(fs.readFileSync(path.join(W, "sources.json"), "utf8"));
  const { leanOptions } = await import(pathToFileURL(path.join(W, "site/scripts/stage.mjs")).href);
  return "sha256:" + sha256(JSON.stringify({ files, release, forks, deps, leanOptions: leanOptions() }));
}

async function hashFile(file) {
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}

async function pack() {
  const out = need("out"), dest = need("dest"), release = need("release"), runtime = need("runtime");
  const snaps = path.join(out, "staging/snapshots"), planFile = path.join(out, "plan/entries.json");
  const indexFile = path.join(snaps, "index.json");
  if (!fs.existsSync(indexFile) || !fs.existsSync(planFile)) die(`no ${indexFile} or ${planFile}: run the full build first`);
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const other = index.snapshots.filter((e) => e.runtime !== runtime);
  if (other.length) die(`snapshots not baked against ${runtime}: ${other.map((e) => e.name).join(", ")}`);
  const names = new Set(index.snapshots.map((e) => e.name));
  for (const e of plan.entries) {
    if (!names.has(e.name)) die(`plan entry ${e.name} is not baked`);
    if (!fs.existsSync(path.join(out, "check/browser", `.${e.name}.ok`))) die(`plan entry ${e.name}: its sheets were not browser-checked (the bake lane does it)`);
  }
  if (!names.has("init")) die("no init snapshot");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const files = [];
  const add = async (from, name, to) => {
    const target = path.join(dest, name);
    try { fs.linkSync(from, target); } catch { fs.copyFileSync(from, target); }
    files.push({ name, to, bytes: fs.statSync(from).size, sha256: await hashFile(from) });
  };
  for (const e of index.snapshots) {
    const name = path.posix.basename(e.url);
    if (!fs.existsSync(path.join(snaps, name))) die(`${name} (${e.name}) is missing from ${snaps}`);
    await add(path.join(snaps, name), name, `staging/snapshots/${name}`);
  }
  await add(planFile, "entries.json", "plan/entries.json");
  await add(indexFile, "index.json", "staging/snapshots/index.json");
  const record = { schema: SCHEMA, release, runtime, inputs: await inputsHash(), files };
  const text = JSON.stringify(record, null, 2) + "\n";
  fs.writeFileSync(path.join(dest, "prebuilt.json"), text);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  console.error(`prebuilt: ${files.length} files, ${(total / 1e9).toFixed(2)} GB in ${dest}`);
  console.log(JSON.stringify({ digest: "sha256:" + sha256(text), inputs: record.inputs, files: files.length, bytes: total }));
}

async function fetchAll() {
  const from = need("from"), digest = need("digest"), out = need("out"), release = need("release"), runtime = need("runtime");
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) die(`--digest must be sha256:<64 hex>, got ${digest}`);
  const isUrl = /^https?:\/\//.test(from);
  const locate = (name) => (isUrl ? from.replace(/\/?$/, "/") + name : path.join(from, name));
  const open = async (name) => {
    if (!isUrl) return { body: fs.createReadStream(locate(name)), bytes: fs.statSync(locate(name)).size };
    const r = await fetch(locate(name));
    if (!r.ok) die(`${locate(name)}: HTTP ${r.status}`);
    return { body: Readable.fromWeb(r.body), bytes: Number(r.headers.get("content-length") ?? NaN) };
  };
  const chunks = [];
  for await (const c of (await open("prebuilt.json")).body) chunks.push(Buffer.from(c));
  const text = Buffer.concat(chunks);
  if ("sha256:" + sha256(text) !== digest) die(`prebuilt.json from ${from} has sha256:${sha256(text)}, pinned ${digest}`);
  const record = JSON.parse(text.toString("utf8"));
  if (record.schema !== SCHEMA) die(`prebuilt.json schema ${record.schema}, expected ${SCHEMA}`);
  if (record.release !== release || record.runtime !== runtime) die(`these environments are for ${record.release} (${record.runtime}); sources.json pins ${release} (${runtime})`);
  const inputs = await inputsHash();
  if (record.inputs !== inputs) console.error("prebuilt: warning: these environments were made from other course inputs (Customlib, patches, sources or options differ from this checkout); the page works, but its messages can differ from a full build of this checkout");
  const order = [...record.files].sort((a, b) => (a.name === "index.json") - (b.name === "index.json"));
  for (const f of order) {
    if (!/^[A-Za-z0-9._-]+$/.test(f.name) || !/^(staging\/snapshots|plan)\/[A-Za-z0-9._-]+$/.test(f.to)) die(`refusing file ${f.name} → ${f.to}`);
    const target = path.join(out, f.to);
    if (fs.existsSync(target) && fs.statSync(target).size === f.bytes && (await hashFile(target)) === f.sha256) {
      console.error(`prebuilt: ${f.name} ✓ (in place)`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    const h = crypto.createHash("sha256");
    let n = 0;
    const { body } = await open(f.name);
    await pipeline(body, async function* (src) { for await (const c of src) { h.update(c); n += c.length; yield c; } }, fs.createWriteStream(part));
    const got = h.digest("hex");
    if (n !== f.bytes || got !== f.sha256) { fs.rmSync(part, { force: true }); die(`${f.name}: ${n} bytes, sha256 ${got}; prebuilt.json says ${f.bytes} bytes, ${f.sha256}`); }
    fs.renameSync(part, target);
    console.error(`prebuilt: ${f.name} ✓ (${(f.bytes / 1e6).toFixed(0)} MB)`);
  }
  // Sheets of this checkout without an entry boot QED64's nearest environment instead.
  const { sheetCatalogue } = await import(pathToFileURL(path.join(W, "site/scripts/stage.mjs")).href);
  const plan = JSON.parse(fs.readFileSync(path.join(out, "plan/entries.json"), "utf8"));
  const served = new Set(plan.entries.flatMap((e) => e.sheets));
  const missing = sheetCatalogue().flatMap((l) => l.sheets).filter((s) => !served.has(s.id)).map((s) => s.id);
  if (missing.length) console.error(`prebuilt: warning: no environment was made for ${missing.join(", ")} (they get the nearest one)`);
  console.error(`prebuilt: ${record.files.length} files in ${out} (${record.release}, ${record.runtime})`);
}

if (cmd === "pack") await pack();
else if (cmd === "fetch") await fetchAll();
else if (cmd === "inputs") console.log(await inputsHash());
else die("usage: prebuilt.mjs pack|fetch|inputs [--flags] (see the header)");
