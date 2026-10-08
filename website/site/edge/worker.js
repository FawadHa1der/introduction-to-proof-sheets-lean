// The proof-sheets site on Cloudflare (QED64's edge library, docs/DEPLOY.md "Using qed64/edge").
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
