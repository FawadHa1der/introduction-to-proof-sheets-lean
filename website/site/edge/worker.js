// The proof-sheets site on Cloudflare (QED64's edge library: "Using qed64/edge" in
// https://github.com/FawadHa1der/QED64/blob/8c461a869b03388c12d7ff68d83a4c621cfb728c/docs/DEPLOY.md).
// Static assets (the built page, website/site/dist) come from the ASSETS binding with
// cross-origin isolation headers. /runtime/* is the toolchain release's own upload under
// lean4-wasm64/<release id>/ in the shared bucket (the release record below routes it);
// /snapshots/* and /profiles/index.json are this site's, under R2_PREFIX.
import { createWorker } from "qed64/edge";
import release from "./lean4-wasm64-release.json" with { type: "json" };

export default createWorker({
  r2Prefix: (env) => env.R2_PREFIX,
  release,
});
