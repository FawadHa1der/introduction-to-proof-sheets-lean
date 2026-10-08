// The page's Lean language client: a port of waterproof-vscode's LeanLspClient and LspClient
// (src/lsp-client/lean/client.ts, src/lsp-client/client.ts; LGPL-2.1-only) without the VS Code
// API. It speaks JSON-RPC to QED64's relay (`relay.clientPort`), keeps the editor's diagnostics,
// progress and busy markers up to date, and computes each exercise hole's status the way the
// extension does: an error in the hole, then the goals at the QED that closes it, then a
// "declaration uses sorry" warning.
//
// Three deliberate changes from the extension, all for the browser's checker:
// - the goal requests for the holes run at most two at a time (QED64 answers at most six
//   requests at once, and the extension fans out one per hole);
// - every request for an older version of the text is dropped when it returns;
// - the document's symbols (the editor's completions) are asked for once per version, when
//   Lean is idle: in Lean 4.34 the request waits for the whole file, and the extension sends
//   one per keystroke.
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
  type MessageConnection,
} from "vscode-jsonrpc/browser";
import { InputAreaStatus, Severity, type OffsetDiagnostic } from "@impermeable/waterproof-editor";
import { TextDocument, comparePos, intersects, type Position, type Range } from "./text-document";

export interface LeanDiagnostic {
  range: Range;
  fullRange?: Range;
  severity?: number;
  message: string;
  source?: string;
  isSilent?: boolean;
  leanTags?: number[];
}
export interface PublishDiagnosticsParams { uri: string; version?: number; diagnostics: LeanDiagnostic[] }
interface FileProgressParams { textDocument: { uri: string; version: number }; processing: { range: Range; kind?: number }[] }
interface PlainGoal { rendered: string; goals: string[] }

/** What the client needs from the editor (a subset of the Waterproof editor's API). */
export interface EditorSink {
  setActiveDiagnostics(d: OffsetDiagnostic[]): void;
  handleCompletions(c: { label: string; detail: string; type: string; template: string }[]): void;
  setInputAreaStatus(s: InputAreaStatus[]): void;
  reportProgress(at: number, total: number, label: string): void;
  setBusyIndicator(from: number): void;
  removeBusyIndicators(): void;
}

const UNSOLVED_GOALS = 1; // LeanTag.UnsolvedGoals
const SORRY_PREFIX = "declaration uses ";

function toSeverity(s: number | undefined): Severity {
  switch (s) {
    case 1: return Severity.Error;
    case 2: return Severity.Warning;
    case 3: return Severity.Information;
    default: return Severity.Hint;
  }
}

export class LeanClient {
  readonly connection: MessageConnection;
  private doc: TextDocument | null = null;
  private diagnostics: LeanDiagnostic[] = [];
  private isBusy = true;
  private statusTimer: number | undefined;
  private statusRun = 0;
  private initialized = false;
  private symbolsVersion = -1;
  /** The server's answer to `initialize` (QED64's front door gives it): the InfoView needs it. */
  initializeResult: Promise<unknown> | null = null;
  /** Listeners the InfoView subscribes (raw LSP traffic). */
  readonly onDiagnostics = new Set<(p: PublishDiagnosticsParams) => void>();
  readonly onNotification = new Set<(method: string, params: unknown) => void>();
  readonly onStatus = new Set<(s: { busy: boolean; statuses: InputAreaStatus[] | null }) => void>();

  constructor(port: MessagePort, private readonly editor: EditorSink) {
    this.connection = createMessageConnection(new BrowserMessageReader(port), new BrowserMessageWriter(port));
    this.connection.onNotification("textDocument/publishDiagnostics", (p: PublishDiagnosticsParams) => this.onPublishDiagnostics(p));
    this.connection.onNotification("$/lean/fileProgress", (p: FileProgressParams) => {
      this.onFileProgress(p);
      for (const f of this.onNotification) f("$/lean/fileProgress", p);
    });
    this.connection.onNotification((method: string, params: unknown) => {
      for (const f of this.onNotification) f(method, params);
    });
    // Server-to-client requests (e.g. workspace/inlayHint/refresh) must be answered or the
    // reporter waits for ever (QED64's resident probe notes it).
    this.connection.onRequest(() => null);
    this.connection.listen();
  }

  get document(): TextDocument | null { return this.doc; }

  /** Opens (or, on a live checker, replaces) the document: QED64 serves one document, so a new
   * sheet with the same imports is a full-text change of the one it holds. */
  open(doc: TextDocument): void {
    if (!this.initialized) {
      this.initializeResult = this.connection.sendRequest("initialize", { processId: null, rootUri: null, capabilities: {} }).catch(() => null);
      this.connection.sendNotification("initialized", {});
      this.initialized = true;
    }
    this.doc = doc;
    this.diagnostics = [];
    this.isBusy = true;
    this.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri: doc.uri, languageId: "lean4", version: doc.version, text: doc.getText() },
    });
  }

  /** The editor changed the text: QED64 takes full-text changes only (change = 1). */
  changed(): void {
    const doc = this.doc;
    if (!doc) return;
    this.isBusy = true;
    this.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: doc.getText() }],
    });
  }

  goals(position: Position): Promise<PlainGoal | null> {
    const doc = this.doc;
    if (!doc) return Promise.resolve(null);
    return this.connection.sendRequest("$/lean/plainGoal", {
      textDocument: { uri: doc.uri, version: doc.version }, position,
    }) as Promise<PlainGoal | null>;
  }

  dispose(): void { this.connection.dispose(); }

  // --- diagnostics ---------------------------------------------------------------------------
  private onPublishDiagnostics(p: PublishDiagnosticsParams): void {
    const doc = this.doc;
    if (!doc || p.uri !== doc.uri) return;
    const areas = this.inputAreas(doc);
    // The extension's rewrite: an unsolved goal inside a hole is "not finished yet", not a
    // wall of goals (LeanLspClient.rewriteDiagnostics).
    this.diagnostics = p.diagnostics.map((d) =>
      d.leanTags?.includes(UNSOLVED_GOALS) && areas.some((a) => intersects(a, d.range))
        ? { ...d, message: "(Sub)proof is not finished yet." } : d);
    for (const f of this.onDiagnostics) f({ ...p, diagnostics: this.diagnostics });
    this.editor.setActiveDiagnostics(this.diagnostics.filter((d) => !d.isSilent).map((d) => ({
      message: d.message,
      severity: toSeverity(d.severity),
      startOffset: doc.offsetAt(d.range.start),
      endOffset: doc.offsetAt(d.range.end),
    })));
  }

  // --- progress ------------------------------------------------------------------------------
  private onFileProgress(p: FileProgressParams): void {
    const doc = this.doc;
    if (!doc || p.textDocument.uri !== doc.uri) return;
    const processing = p.processing.filter((x) => x.kind === undefined || x.kind === 1);
    const total = doc.lineCount;
    if (processing.length === 0) {
      this.editor.removeBusyIndicators();
      this.editor.reportProgress(total, total, "File verified");
    } else {
      const at = processing[0].range.start.line + 1;
      this.editor.reportProgress(at, total, `Verified file up to line: ${at}`);
      this.editor.setBusyIndicator(doc.offsetAt(processing[0].range.start));
    }
    this.isBusy = processing.length > 0;
    for (const f of this.onStatus) f({ busy: this.isBusy, statuses: null });
    this.scheduleInputAreaStatus();
    if (!this.isBusy) void this.updateCompletions(doc);
  }

  /** The document's symbols as completions (LspClient.updateCompletions). */
  private async updateCompletions(doc: TextDocument): Promise<void> {
    if (this.symbolsVersion === doc.version) return;
    this.symbolsVersion = doc.version;
    let symbols: { name: string; detail?: string; children?: unknown[] }[] | null;
    try {
      symbols = await this.connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri: doc.uri } }) as typeof symbols;
    } catch {
      return; // superseded by an edit (ContentModified): the next idle asks again
    }
    if (doc !== this.doc || doc.version !== this.symbolsVersion || !symbols) return;
    this.editor.handleCompletions(symbols.map((sym) => ({ label: sym.name, detail: sym.detail?.toLowerCase() ?? "", type: "variable", template: sym.name })));
  }

  // --- exercise holes ------------------------------------------------------------------------
  /** The holes: from each `:::input\n` to the next `:::\n` (LeanLspClient.getInputAreas). */
  inputAreas(doc: TextDocument): Range[] {
    const text = doc.getText();
    const out: Range[] = [];
    for (let i = text.indexOf(":::input\n"); i >= 0; i = text.indexOf(":::input\n", i + 9)) {
      const close = text.indexOf(":::\n", i);
      out.push({ start: doc.positionAt(i), end: doc.positionAt(close < 0 ? text.length : close) });
    }
    return out;
  }

  private scheduleInputAreaStatus(): void {
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => void this.computeInputAreaStatus(), 250);
  }

  private async computeInputAreaStatus(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const run = ++this.statusRun, version = doc.version;
    const areas = this.inputAreas(doc);
    const diags = this.diagnostics;
    const statuses: InputAreaStatus[] = new Array(areas.length);
    let next = 0;
    const worker = async () => {
      while (next < areas.length) {
        const i = next++;
        const lower = i === 0 ? { line: 0, character: 0 } : areas[i - 1].end;
        statuses[i] = await this.determineProofStatus(doc, areas[i], diags, lower);
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } catch {
      return; // a request the checker dropped (a newer version arrived): the next run decides
    }
    if (run !== this.statusRun || version !== doc.version || doc !== this.doc) return;
    this.editor.setInputAreaStatus(statuses);
    for (const f of this.onStatus) f({ busy: this.isBusy, statuses });
  }

  private async determineProofStatus(doc: TextDocument, area: Range, diags: LeanDiagnostic[], lower: Position): Promise<InputAreaStatus> {
    if (this.isBusy) return InputAreaStatus.Incorrect;
    if (diags.some((d) => d.severity === 1 && intersects(area, d.range))) return InputAreaStatus.Incorrect;
    const marker = this.findProofEndPosition(doc, area.end);
    if (!marker) return InputAreaStatus.Incorrect;
    const response = await this.goals(marker);
    if (!response || response.goals.length > 0) return InputAreaStatus.Incorrect;
    const hasSorry = diags.some((d) => d.severity === 2 && comparePos(d.range.start, lower) > 0
      && comparePos(d.range.start, area.end) <= 0 && d.message.startsWith(SORRY_PREFIX));
    return hasSorry ? InputAreaStatus.Invalid : InputAreaStatus.Correct;
  }

  /** The end of the first `QED` (or `□`) after the hole, before the next hole
   * (LeanLspClient.findProofEndPosition). */
  private findProofEndPosition(doc: TextDocument, from: Position): Position | undefined {
    const text = doc.getText();
    const start = doc.offsetAt(from);
    const nextArea = text.indexOf(":::input\n", start);
    const limit = nextArea >= 0 ? nextArea : text.length;
    let best: number | undefined, len = 0;
    for (const m of ["□", "QED"]) {
      const idx = text.indexOf(m, start);
      if (idx >= 0 && idx < limit && (best === undefined || idx < best)) { best = idx; len = m.length; }
    }
    return best === undefined ? undefined : doc.positionAt(best + len);
  }
}
