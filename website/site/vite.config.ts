// The site's dev and preview servers. Three things a QED64 page needs (QED64 docs/EMBEDDING.md
// §6.1): cross-origin isolation on every response, QED64's library served as source (not
// pre-bundled), and the Lean artifacts on the page's own origin. In development and preview the
// artifacts come straight from the build's output, website/out: /runtime/ from the release
// mirror and /snapshots/ from the bake staging. Production serves the same paths from the
// edge (docs/DEPLOY.md in this folder).
import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";

const out = path.resolve(__dirname, "../out");
const ARTIFACT_DIRS: Record<string, string> = {
  "/runtime/": process.env.RUNTIME_DIR ?? path.join(out, "release/mirror/runtime"),
  "/snapshots/": process.env.SNAPSHOTS_DIR ?? path.join(out, "staging/snapshots"),
};
const TYPES: Record<string, string> = { ".json": "application/json", ".wasm": "application/wasm", ".js": "text/javascript" };

function isolate(_req: Connect.IncomingMessage, res: import("node:http").ServerResponse, next: Connect.NextFunction) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
}

/** /runtime/* and /snapshots/* from the build output: identity encoding, byte ranges, 404s. */
function artifacts(req: Connect.IncomingMessage, res: import("node:http").ServerResponse, next: Connect.NextFunction) {
  const url = (req.url ?? "").split("?")[0];
  const prefix = Object.keys(ARTIFACT_DIRS).find((p) => url.startsWith(p));
  if (!prefix) return next();
  const root = ARTIFACT_DIRS[prefix];
  const file = path.join(root, decodeURIComponent(url.slice(prefix.length)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  const size = fs.statSync(file).size;
  res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", /\.(snapz)$|chunks\//.test(url) || /\.[0-9a-f]{16}\./.test(url) ? "public, max-age=31536000, immutable" : "no-cache");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!(start >= 0 && start <= end)) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${size}`); res.end(); return; }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader("Content-Length", String(size));
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const serveForQed64: Plugin = {
  name: "proof-sheets-qed64",
  configureServer(server) { server.middlewares.use(isolate); server.middlewares.use(artifacts); },
  configurePreviewServer(server) { server.middlewares.use(isolate); server.middlewares.use(artifacts); },
};

export default defineConfig({
  plugins: [serveForQed64],
  optimizeDeps: { exclude: ["qed64"] },
  build: { target: "es2022", chunkSizeWarningLimit: 4096 },
  server: { port: 5197, strictPort: true, watch: { ignored: ["**/out/**"] } },
  preview: { port: 5198, strictPort: true },
});
