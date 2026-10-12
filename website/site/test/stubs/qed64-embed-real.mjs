// qed64/embed for the real-relay tests: QED64's REAL LspRelay (the site's pinned
// lib/lsp-relay.ts, bundled with the test), so its rules apply as in the page: restart() only
// while serving, crash reboots with reusableOpts(), the three-deaths breaker, the stack pause
// (HARDENING #72), rearm. Only the session is a stand-in: start() resolves when the test calls
// finish(), rejects on fail(); crash() and stack(line) are its deaths.
export { LspRelay } from "../../node_modules/qed64/lib/lsp-relay.ts";
export const log = [];
export const sessions = [];
export const DEFAULT_MAXIMUM_BYTES = 6 * 2 ** 30;
export const MEMORY64_PROBE = new Uint8Array();
export class ResidentSession {
  constructor(host, opts) {
    this.snapshots = opts.snapshots ?? host.policy.snapshotsFor(host.headerText);
    this.opts = opts;
    this.header = host.headerText.split("\n")[0];
    this.id = `s${sessions.length + 1}`;
    this.p = new Promise((res, rej) => { this.res = res; this.rej = rej; });
    this.p.catch(() => {});
    this.sent = [];
    this.onLsp = () => {}; this.onStatus = () => {}; this.onDied = () => {};
    log.push(`boot ${this.snapshots.at(-1)}`);
    sessions.push(this);
  }
  start() { return this.p; }
  arm() { return Promise.resolve(); }
  lsp(m) { this.sent.push(m); }
  dispose() { log.push(`dispose ${this.id}`); }
  terminate() {}
  finish() { this.res(); }
  fail(why) { this.rej(new Error(why)); }
  crash() { this.onDied(1, "crash", "the worker died"); }
  stack(line) {
    this.onDied(null, "crash", "a Lean thread ran out of the browser's stack (RangeError: Maximum call stack size exceeded)",
      { kind: "other", code: "ENGINE_STACK_OVERFLOW", message: "x", ...(line === undefined ? {} : { line }) });
  }
  status(phase) { this.onStatus({ phase, version: 1, header: null, ring: { bytesQueued: 0, refused: 0 }, pool: { unused: 0, running: 0 }, dropped: 0 }); }
}
export function chooseSnapshots() { return ["init", "FALLBACK"]; }
export function importedModulesOf(text) { return text.split("\n").filter((l) => /^import\s+/.test(l)).map((l) => l.split(/\s+/)[1]); }
export const initialBytesForEntries = () => 2 ** 31;
export const installArtifacts = async () => ({});
export const removeRawRegion = async (e) => { log.push(`evict ${e.name}`); return true; };
export const prefetchRaw = (e, opts) => {
  log.push(`prefetch ${e.name}`);
  opts?.signal?.addEventListener("abort", () => log.push(`abort ${e.name}`), { once: true });
  return new Promise(() => {});
};
export const SNAPSHOT_CACHE_DIR = "qed64-snapshots";
export const isCacheKeyOf = () => true;
