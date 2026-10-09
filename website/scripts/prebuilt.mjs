#!/usr/bin/env node
// The prebuilt environments: the baked, browser-checked snapshots and the plan that maps each
// sheet to its entry, published once (scripts/publish-prebuilt.sh) so that anyone can run the
// site without the two-hour build (website/build.sh --prebuilt).
//
//   prebuilt.mjs pack  --out <website/out> --dest <dir> --release <id> --runtime <build id> --qed64 <commit>
//       Collects out/staging/snapshots (every .snapz and index.json) and out/plan/entries.json
//       into <dir> with prebuilt.json, the record of every file (bytes, sha256, where it goes).
//       Refuses snapshots of another runtime, entries whose sheets were not browser-checked
//       (out/check/browser/.<entry>.ok), and a plan that has no entry for one of this
//       checkout's sheets. Prints the record's sha256: the pin.
//   prebuilt.mjs fetch --from <url|dir> --digest sha256:<hex> --out <website/out> --release <id> --runtime <build id> --qed64 <commit>
//       Fetches prebuilt.json, refuses it unless its sha256 is the pin and it was made for this
//       release and runtime, then fetches every file (by name, from a GitHub release URL or a
//       directory) into place, each verified; files already in place are kept, snapshots the
//       record does not list are removed. The index comes last, so a page never sees an index
//       that names a missing snapshot.
//   prebuilt.mjs inputs
//       Prints the hash of the course inputs the environments are made from.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
 * other inputs works, but their messages may differ from this checkout's: the fetch warns.
 * Only files git tracks or would track count (no .DS_Store, no editor backups), and Lean files
 * count with LF line ends, so the hash is the same on every machine. */
const INPUTS = ["Bewijzen/Customlib", "Bewijzen/Customlib.lean", "website/patches", "website/scripts/compile-args.sh"];
function inputFiles() {
  const git = spawnSync("git", ["-C", REPO, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...INPUTS], { encoding: "utf8" });
  if (git.status === 0) return git.stdout.split("\0").filter((f) => f && fs.existsSync(path.join(REPO, f))).sort();
  const files = []; // not a git checkout (a source archive): every file but dotfiles
  const walk = (rel) => {
    if (path.basename(rel).startsWith(".")) return;
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) for (const f of fs.readdirSync(abs)) walk(path.join(rel, f));
    else files.push(rel.split(path.sep).join("/"));
  };
  for (const rel of INPUTS) walk(rel);
  return files.sort();
}
async function inputsHash() {
  const files = inputFiles().map((f) => {
    let bytes = fs.readFileSync(path.join(REPO, f));
    if (f.endsWith(".lean")) bytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
    return [f, sha256(bytes)];
  });
  const { release, forks, deps } = JSON.parse(fs.readFileSync(path.join(W, "sources.json"), "utf8"));
  const pins = { release: { id: release.id, digest: release.digest, runtime: release.runtime },
    forks: Object.fromEntries(Object.entries(forks).map(([k, f]) => [k, { upstream: f.upstream, base: f.base }])),
    deps: Object.fromEntries(Object.entries(deps).map(([k, d]) => [k, { url: d.url, rev: d.rev }])) };
  const { leanOptions } = await import(pathToFileURL(path.join(W, "site/scripts/stage.mjs")).href);
  return "sha256:" + sha256(JSON.stringify({ files, pins, leanOptions: leanOptions() }));
}

/** This checkout's sheets that `plan` serves with no entry made for exactly their imports. */
async function unserved(plan) {
  const { sheetCatalogue } = await import(pathToFileURL(path.join(W, "site/scripts/stage.mjs")).href);
  const entryOf = new Map(plan.entries.flatMap((e) => e.sheets.map((id) => [id, e])));
  return sheetCatalogue().flatMap((l) => l.sheets).filter((s) => {
    const e = entryOf.get(s.id);
    return !e || ![e.imports, ...(e.alsoServes ?? [])].some((x) => x.join("\n") === s.imports.join("\n"));
  }).map((s) => s.id);
}

async function hashFile(file) {
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}

async function pack() {
  const out = need("out"), dest = need("dest"), release = need("release"), runtime = need("runtime"), qed64 = need("qed64");
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
  const missing = await unserved(plan);
  if (missing.length) die(`the plan has no environment for ${missing.join(", ")}: run the plan and bake lanes first`);
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
  const record = { schema: SCHEMA, release, runtime, qed64, inputs: await inputsHash(), files };
  const text = JSON.stringify(record, null, 2) + "\n";
  fs.writeFileSync(path.join(dest, "prebuilt.json"), text);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  console.error(`prebuilt: ${files.length} files, ${(total / 1e9).toFixed(2)} GB in ${dest}`);
  console.log(JSON.stringify({ digest: "sha256:" + sha256(text), inputs: record.inputs, files: files.length, bytes: total }));
}

const NAME = /^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]*$/;
const targetOf = (name) => (name === "entries.json" ? "plan/" : "staging/snapshots/") + name;

async function fetchAll() {
  const from = need("from"), digest = need("digest"), out = need("out"), release = need("release"), runtime = need("runtime"), qed64 = need("qed64");
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) die(`--digest must be sha256:<64 hex>, got ${digest}`);
  const isUrl = /^https?:\/\//.test(from);
  if (!isUrl && !fs.existsSync(path.join(from, "prebuilt.json"))) die(`no prebuilt.json in ${from}`);
  const locate = (name) => (isUrl ? from.replace(/\/?$/, "/") + name : path.join(from, name));
  const open = async (name) => {
    if (!isUrl) {
      if (!fs.existsSync(locate(name))) throw new Error(`${locate(name)} is missing`);
      return fs.createReadStream(locate(name));
    }
    const r = await fetch(locate(name));
    if (!r.ok) throw new Error(`${locate(name)}: HTTP ${r.status}`);
    return Readable.fromWeb(r.body);
  };
  const fail = (what, e) => die(`${what}: ${e?.cause?.code ?? ""} ${e?.message ?? e}`.replace(/: +/, ": "));
  const chunks = [];
  try { for await (const c of await open("prebuilt.json")) chunks.push(Buffer.from(c)); } catch (e) { fail("prebuilt.json", e); }
  const text = Buffer.concat(chunks);
  if ("sha256:" + sha256(text) !== digest) die(`prebuilt.json from ${from} has sha256:${sha256(text)}, pinned ${digest}`);
  const record = JSON.parse(text.toString("utf8"));
  if (record.schema !== SCHEMA) die(`prebuilt.json schema ${record.schema}, expected ${SCHEMA}`);
  if (record.release !== release || record.runtime !== runtime) die(`these environments are for ${record.release} (${record.runtime}); sources.json pins ${release} (${runtime})`);
  // Every record is checked before anything is written.
  for (const f of record.files) {
    if (!NAME.test(f.name) || f.to !== targetOf(f.name) || !Number.isSafeInteger(f.bytes) || !/^[0-9a-f]{64}$/.test(f.sha256)) die(`prebuilt.json: refusing the record ${JSON.stringify(f)}`);
  }
  if (!record.files.some((f) => f.name === "index.json") || !record.files.some((f) => f.name === "entries.json")) die("prebuilt.json lists no index.json or entries.json");
  if (record.qed64 !== qed64) console.error(`prebuilt: warning: these environments were baked with QED64 ${String(record.qed64).slice(0, 12)}, this checkout pins ${qed64.slice(0, 12)}`);
  if (record.inputs !== (await inputsHash())) console.error("prebuilt: warning: these environments were made from other course inputs (Customlib, patches, sources or options differ from this checkout); the page works, but its messages can differ from a full build of this checkout");
  const order = [...record.files].sort((a, b) => (a.name === "index.json") - (b.name === "index.json"));
  for (const f of order) {
    const target = path.join(out, f.to);
    if (fs.existsSync(target) && fs.statSync(target).size === f.bytes && (await hashFile(target)) === f.sha256) {
      console.error(`prebuilt: ${f.name} ✓ (in place)`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    const h = crypto.createHash("sha256");
    let n = 0;
    try {
      await pipeline(await open(f.name), async function* (src) { for await (const c of src) { h.update(c); n += c.length; yield c; } }, fs.createWriteStream(part));
    } catch (e) {
      fs.rmSync(part, { force: true });
      fail(f.name, e);
    }
    const got = h.digest("hex");
    if (n !== f.bytes || got !== f.sha256) { fs.rmSync(part, { force: true }); die(`${f.name}: ${n} bytes, sha256 ${got}; prebuilt.json says ${f.bytes} bytes, ${f.sha256}`); }
    fs.renameSync(part, target);
    console.error(`prebuilt: ${f.name} ✓ (${(f.bytes / 1e6).toFixed(0)} MB)`);
  }
  // Snapshots of an earlier prebuilt (or bake) that this index does not name, and partial files.
  const snaps = path.join(out, "staging/snapshots"), listed = new Set(record.files.map((f) => f.name));
  for (const name of fs.readdirSync(snaps)) {
    if ((name.endsWith(".snapz") && !listed.has(name)) || name.endsWith(".part")) fs.rmSync(path.join(snaps, name), { force: true });
  }
  const missing = await unserved(JSON.parse(fs.readFileSync(path.join(out, "plan/entries.json"), "utf8")));
  if (missing.length) console.error(`prebuilt: warning: no environment was made for the imports of ${missing.join(", ")}: they get the nearest one (publish again after a full build)`);
  console.error(`prebuilt: ${record.files.length} files in ${out} (${record.release}, ${record.runtime})`);
}

if (cmd === "pack") await pack();
else if (cmd === "fetch") await fetchAll();
else if (cmd === "inputs") console.log(await inputsHash());
else die("usage: prebuilt.mjs pack|fetch|inputs [--flags] (see the header)");
