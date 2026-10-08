// The production Worker (edge/worker.js) against fake bindings: where each path is read from,
// and the headers a QED64 page needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../edge/worker.js";
import release from "../edge/lean4-wasm64-release.json" with { type: "json" };

function fakeBucket(objects) {
  const meta = (key, bytes) => ({
    size: bytes.length,
    httpEtag: `"${key.length}-${bytes.length}"`,
    writeHttpMetadata(h) { h.set("content-type", key.endsWith(".json") ? "application/json" : "application/octet-stream"); },
  });
  return {
    reads: [],
    async head(key) { return objects.has(key) ? meta(key, objects.get(key)) : null; },
    async get(key, opts) {
      this.reads.push(key);
      if (!objects.has(key)) return null;
      let bytes = objects.get(key), range = null;
      const m = /^bytes=(\d+)-(\d*)$/.exec(opts?.range?.get?.("range") ?? "");
      if (m) {
        const start = Number(m[1]), end = m[2] ? Number(m[2]) : bytes.length - 1;
        range = { offset: start, length: end - start + 1 };
        bytes = bytes.subarray(start, end + 1);
      }
      return { ...meta(key, objects.get(key)), body: new Response(bytes).body, range };
    },
  };
}
const assets = { async fetch(req) { return new URL(req.url).pathname === "/" ? new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 }); } };

const RID = release.id;
const objects = new Map([
  [`lean4-wasm64/${RID}/runtime/runtime-manifest.json`, new TextEncoder().encode('{"buildId":"x"}')],
  ["proof-sheets/snapshots/index.json", new TextEncoder().encode('{"snapshots":[]}')],
  ["proof-sheets/snapshots/sheets-abc.0123456789abcdef.snapz", new Uint8Array(1000).fill(7)],
]);
const env = { ASSETS: assets, ARTIFACTS: fakeBucket(objects), R2_PREFIX: "proof-sheets/" };
const get = (path, headers = {}) => worker.fetch(new Request(`https://sheets.example${path}`, { headers }), env, {});

test("the page is served with cross-origin isolation", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(r.headers.get("cross-origin-embedder-policy"), "require-corp");
});

test("/runtime/ is the toolchain release's upload, shared by every site on it", async () => {
  const r = await get("/runtime/runtime-manifest.json");
  assert.equal(r.status, 200);
  assert.equal(env.ARTIFACTS.reads.at(-1), `lean4-wasm64/${RID}/runtime/runtime-manifest.json`);
});

test("/snapshots/ is this site's, under R2_PREFIX", async () => {
  const r = await get("/snapshots/index.json");
  assert.equal(r.status, 200);
  assert.equal(env.ARTIFACTS.reads.at(-1), "proof-sheets/snapshots/index.json");
  assert.equal(await r.text(), '{"snapshots":[]}');
});

test("a snapshot region is immutable and served in ranges", async () => {
  const r = await get("/snapshots/sheets-abc.0123456789abcdef.snapz", { range: "bytes=100-199" });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 100-199/1000");
  assert.match(r.headers.get("cache-control") ?? "", /immutable/);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
});

test("a missing snapshot is a 404 that is not cached", async () => {
  const r = await get("/snapshots/missing.0123456789abcdef.snapz");
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
