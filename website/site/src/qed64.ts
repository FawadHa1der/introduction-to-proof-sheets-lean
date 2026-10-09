// QED64 for the proof sheets: one resident Lean checker per page, booted from the course's
// snapshots only (no library packs), on the environment of exactly the open sheet's imports.
//
// Each distinct environment of the course (ordered import closure) has its own snapshot entry
// (website/build.sh plans and bakes them), and the catalogue names each sheet's entry. The
// checker boots exactly that entry for the sheet's import list, never a larger environment:
// when the next sheet needs another entry, it restarts onto it (the relay's restart, which waits
// for the old heap to be released first). Lean cannot change the environment of a running
// process, so a different entry is a new runtime; opening a sheet with the same entry is just a
// full-text change. An import list no sheet has (edited in teacher mode) falls back to QED64's
// own choice, the smallest entry whose roots cover the header.
//
// The checker keeps two entry lists apart: `active`, what the relay's session was made for
// (booting or serving; set where the relay makes a session, so crash reboots count too), and
// `target`, what the open text needs. Whenever the relay serves and they differ, it restarts
// onto the target; a switch made during a boot waits for that boot, and a switch back to the
// active entry cancels it. The target's region is downloaded from the moment it is chosen.
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
  prefetchRaw,
  removeRawRegion,
  type ProgressInfo,
  type Qed64Artifacts,
  type RelayStatus,
  type ResidentPolicy,
  type SnapshotEntry,
  type StatusSink,
} from "qed64/embed";
import { recentEnvironments, setRecentEnvironments } from "./storage";

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

/** The browser cache keeps the inflated regions of this many recently used environments (each
 * ~1 GB), plus the one being switched to. */
const KEEP_RAW_REGIONS = 2;

export class Checker {
  readonly relay: LspRelay;
  private text: string;
  /** The entry list of the relay's current session (booting or serving). */
  private active: string[] = [];
  /** The entry list the open text needs. */
  private target: string[];
  private serving = false;
  private prefetching: AbortController | null = null;

  private constructor(private readonly artifacts: Qed64Artifacts, text: string, private readonly view: BootView,
    private readonly entryFor: (imports: string[]) => string | null) {
    this.text = text;
    this.target = this.snapshotsFor(text);
    const index = artifacts.snapshots!;
    const policy: ResidentPolicy = {
      snapshotsFor: (headerText) => this.snapshotsFor(headerText),
      initialBytesFor: (_header, snapshots) => initialBytesForEntries(index, snapshots),
      maximumBytes: DEFAULT_MAXIMUM_BYTES,
    };
    const ui: StatusSink = {
      busy: (label, info) => view.busy(label, info),
      progress: (label, info) => view.busy(label, info),
      idle: (label) => view.idle(label),
    };
    // Every session the relay makes (the first boot, a restart, a crash reboot) passes here: what
    // it boots is `opts.snapshots`, or the policy's choice for the current text.
    this.relay = new LspRelay(
      (opts) => {
        this.active = opts?.snapshots ?? this.snapshotsFor(this.text);
        this.remember(this.active);
        return new ResidentSession({ artifacts, ui, policy, headerText: this.text }, opts ?? {});
      },
      { status: (s) => this.onStatus(s) },
      () => new Promise((r) => setTimeout(r, 1500)),
    );
    addEventListener("pagehide", () => this.relay.unload(), { once: true });
  }

  /** Boots for the text `currentText()` returns once the artifacts are installed: a sheet opened
   * while they install is the one Lean starts on. */
  static async boot(currentText: () => string, view: BootView, entryFor: (imports: string[]) => string | null): Promise<Checker> {
    checkCapabilities();
    const artifacts = await installArtifacts({ busy: view.busy, progress: view.busy, idle: view.idle }, { overrides: "none", profiles: "none" });
    if (!artifacts.snapshots) throw new Error("The course's snapshot index (/snapshots/index.json) is missing.");
    return new Checker(artifacts, currentText(), view, entryFor);
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
    const e = this.entryOf(this.active);
    return e?.label ?? e?.name ?? "Lean";
  }

  /** The page is about to send `text` (a new sheet, or an edit): Lean restarts onto its entry
   * when that differs from the running one. Call before sending the text to the client. */
  prepare(text: string): void {
    this.text = text;
    const want = this.snapshotsFor(text);
    if (same(want, this.target)) return;
    this.target = want;
    this.prefetchTarget();
    this.reconcile();
  }

  /** Restart onto the target if the relay serves another entry; during a boot, the boot's
   * serving status calls this again. */
  private reconcile(): void {
    if (!this.serving || same(this.target, this.active)) return;
    this.relay.restart({ snapshots: this.target }); // the session factory records it as active
  }

  /** Download (and inflate into the browser cache) the target's region now, while the old Lean
   * stops and the new runtime starts; the boot joins this download instead of starting its own.
   * The previous switch's download stops unless the boot is using it. */
  private prefetchTarget(): void {
    this.prefetching?.abort();
    this.prefetching = null;
    const entry = this.entryOf(this.target);
    if (!entry || same(this.target, this.active)) return;
    const ctl = new AbortController();
    this.prefetching = ctl;
    void prefetchRaw(entry, { signal: ctl.signal, onBusy: "return" }).catch(() => undefined);
  }

  private onStatus(s: RelayStatus): void {
    this.serving = s.relay === "serving";
    this.view.relay(s);
    if (this.serving) this.reconcile();
  }

  private entryOf(names: string[]): SnapshotEntry | undefined {
    return this.artifacts.snapshots?.snapshots.find((e) => e.name === names[names.length - 1] && e.name !== "init");
  }

  /** An environment was booted: it becomes the most recent, and the browser's cache keeps the
   * regions of only the KEEP_RAW_REGIONS most recent ones (across visits) and the target. */
  private remember(names: string[]): void {
    const entry = this.entryOf(names);
    if (!entry) return;
    const recent = [entry.name, ...recentEnvironments().filter((n) => n !== entry.name)].slice(0, KEEP_RAW_REGIONS);
    setRecentEnvironments(recent);
    const keep = new Set([...recent, "init", this.entryOf(this.target)?.name]);
    for (const e of this.artifacts.snapshots?.snapshots ?? []) {
      if (keep.has(e.name)) continue;
      void isRawCached(e).then((cached) => (cached ? removeRawRegion(e) : false)).catch(() => false);
    }
  }
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
