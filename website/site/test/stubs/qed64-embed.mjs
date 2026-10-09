// A stand-in for qed64/embed that drives the site's Checker (src/qed64.ts) without a browser:
// the relay keeps QED64's rules that matter here (it makes its first session at once, and
// restart() is refused unless it serves); serve() ends the boot in flight. Everything it is
// asked to do is logged.
export const log = [];
export const DEFAULT_MAXIMUM_BYTES = 6 * 2 ** 30;
export const MEMORY64_PROBE = new Uint8Array();
export class ResidentSession {
  constructor(host, opts) { this.snapshots = opts.snapshots ?? host.policy.snapshotsFor(host.headerText); log.push(`boot ${this.snapshots.at(-1)}`); }
}
export class LspRelay {
  static last = null;
  constructor(make, sink) { this.make = make; this.sink = sink; this.state = "rebooting"; this.session = make(); LspRelay.last = this; }
  restart(opts) {
    if (this.state !== "serving") throw new Error("restart while not serving (QED64 ignores it)");
    this.state = "rebooting"; this.session = this.make(opts); this.sink.status({ relay: "rebooting" });
  }
  crash() { this.state = "rebooting"; this.session = this.make(undefined); this.sink.status({ relay: "rebooting" }); }
  serve() { this.state = "serving"; log.push(`serving ${this.session.snapshots.at(-1)}`); this.sink.status({ relay: "serving", phase: "ready" }); }
  unload() {}
}
export function chooseSnapshots() { return ["init", "FALLBACK"]; }
export function importedModulesOf(text) { return text.split("\n").filter((l) => /^import\s+/.test(l)).map((l) => l.split(/\s+/)[1]); }
export const initialBytesForEntries = () => 2 ** 31;
export const installArtifacts = async () => ({});
export const cached = new Set();
export const isRawCached = async (e) => cached.has(e.name);
export const removeRawRegion = async (e) => { log.push(`evict ${e.name}`); cached.delete(e.name); return true; };
const downloads = new Map();
/** A download settles when the test says so (or when it is aborted). */
export const finishDownload = (name) => downloads.get(name)?.({ status: "done" });
export const prefetchRaw = (e, opts) => {
  log.push(`prefetch ${e.name}`);
  return new Promise((resolve) => {
    downloads.set(e.name, resolve);
    opts?.signal?.addEventListener("abort", () => { log.push(`abort ${e.name}`); resolve({ status: "aborted" }); }, { once: true });
  });
};
export const SNAPSHOT_CACHE_DIR = "qed64-snapshots";
export const isCacheKeyOf = () => true;
