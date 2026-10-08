// QED64 for the proof sheets: one resident Lean checker per page, booted from the course's
// snapshots only (no library packs), on the environment of exactly the open sheet's imports.
//
// Each distinct environment of the course (ordered import closure) has its own snapshot entry
// (website/build.sh plans and bakes them), and the catalogue names each sheet's entry. The
// checker boots exactly that entry for the sheet's import list, never a larger environment:
// when the next sheet needs another entry, it restarts onto it (the relay's restart, which waits
// for the old heap to be released first). Opening a sheet with the same imports is just a
// full-text change. An import list no sheet has (edited in teacher mode) falls back to QED64's
// own choice, the smallest entry whose roots cover the header.
import {
  DEFAULT_MAXIMUM_BYTES,
  LspRelay,
  MEMORY64_PROBE,
  ResidentSession,
  chooseSnapshots,
  importedModulesOf,
  initialBytesForEntries,
  installArtifacts,
  isRawCached,
  removeRawRegion,
  type ProgressInfo,
  type Qed64Artifacts,
  type RelayStatus,
  type ResidentPolicy,
  type SnapshotEntry,
  type StatusSink,
} from "qed64/embed";

export interface BootView {
  busy(label: string, info?: ProgressInfo): void;
  idle(label: string): void;
  relay(s: RelayStatus): void;
}

export class Capability extends Error {}

/** The browser floor: cross-origin isolation (SharedArrayBuffer) and WebAssembly Memory64. */
export function checkCapabilities(): void {
  if (!globalThis.crossOriginIsolated) throw new Capability("This page is not cross-origin isolated (the server must send COOP/COEP headers).");
  if (!WebAssembly.validate(MEMORY64_PROBE)) throw new Capability("This browser has no WebAssembly Memory64. Use a current Chrome, Edge (133 or later) or Firefox (134 or later) on a desktop computer.");
}

const KEEP_RAW_REGIONS = 2; // the browser cache holds the open sheet's environment and the previous one

export class Checker {
  readonly relay: LspRelay;
  private text: string;
  private current: string[];
  private serving = false;
  private pendingSnapshots: string[] | null = null;
  private recent: string[] = [];

  private constructor(private readonly artifacts: Qed64Artifacts, text: string, private readonly view: BootView,
    private readonly entryFor: (imports: string[]) => string | null) {
    this.text = text;
    const index = artifacts.snapshots!;
    const policy: ResidentPolicy = {
      snapshotsFor: (headerText) => this.snapshotsFor(headerText),
      initialBytesFor: (_header, snapshots) => initialBytesForEntries(index, snapshots),
      maximumBytes: DEFAULT_MAXIMUM_BYTES,
    };
    this.current = this.snapshotsFor(text);
    const ui: StatusSink = {
      busy: (label, info) => view.busy(label, info),
      progress: (label, info) => view.busy(label, info),
      idle: (label) => view.idle(label),
    };
    this.relay = new LspRelay(
      (opts) => new ResidentSession({ artifacts, ui, policy, headerText: this.text }, opts ?? {}),
      { status: (s) => this.onStatus(s) },
      () => new Promise((r) => setTimeout(r, 1500)),
    );
    addEventListener("pagehide", () => this.relay.unload(), { once: true });
    this.remember(this.current);
  }

  static async boot(text: string, view: BootView, entryFor: (imports: string[]) => string | null): Promise<Checker> {
    checkCapabilities();
    const artifacts = await installArtifacts({ busy: view.busy, progress: view.busy, idle: view.idle }, { overrides: "none", profiles: "none" });
    if (!artifacts.snapshots) throw new Error("The course's snapshot index (/snapshots/index.json) is missing.");
    return new Checker(artifacts, text, view, entryFor);
  }

  /** The entry list QED64 boots for this text: init plus the entry baked for exactly its imports. */
  snapshotsFor(text: string): string[] {
    const index = this.artifacts.snapshots!;
    const imports = importedModulesOf(text);
    const name = this.entryFor(imports);
    if (name && index.snapshots.some((e) => e.name === name)) return ["init", name];
    return chooseSnapshots(index, imports);
  }

  entryLabel(): string {
    const e = this.entryOf(this.current);
    return e?.label ?? e?.name ?? "Lean";
  }

  /** The page is about to send `text` (a new sheet, or an edit): restart onto its entry when
   * that differs from the running one. Call before sending the text to the client. */
  prepare(text: string): void {
    this.text = text;
    const want = this.snapshotsFor(text);
    if (same(want, this.current)) { this.pendingSnapshots = null; return; }
    this.current = want;
    this.remember(want);
    if (this.serving) this.relay.restart({ snapshots: want });
    else this.pendingSnapshots = want; // the boot in flight is for the old entry: switch when it serves
  }

  private onStatus(s: RelayStatus): void {
    this.serving = s.relay === "serving";
    if (this.serving && this.pendingSnapshots) {
      const want = this.pendingSnapshots;
      this.pendingSnapshots = null;
      this.relay.restart({ snapshots: want });
    }
    this.view.relay(s);
  }

  private entryOf(names: string[]): SnapshotEntry | undefined {
    return this.artifacts.snapshots?.snapshots.find((e) => e.name === names[names.length - 1] && e.name !== "init");
  }

  /** Keep the browser's raw-region cache to the last few environments (each is ~1 GB inflated). */
  private remember(names: string[]): void {
    const entry = this.entryOf(names);
    if (!entry) return;
    this.recent = [entry.name, ...this.recent.filter((n) => n !== entry.name)];
    const drop = this.recent.slice(KEEP_RAW_REGIONS);
    this.recent = this.recent.slice(0, KEEP_RAW_REGIONS);
    for (const name of drop) {
      const e = this.artifacts.snapshots?.snapshots.find((x) => x.name === name);
      if (!e) continue;
      void isRawCached(e).then((cached) => (cached ? removeRawRegion(e) : false)).catch(() => false);
    }
  }
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
