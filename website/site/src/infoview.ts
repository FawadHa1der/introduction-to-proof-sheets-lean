// The Lean InfoView in the page: goals, messages and the sheets' panel widgets (WaterproofGenre's
// "We need to show" GoalsPanel is a `show_panel_widgets` RPC widget). A port of the parts of
// waterproof-vscode's InfoProvider (src/infoview.ts, LGPL-2.1-only, itself adapted from
// vscode-lean4) that a page needs: the EditorApi is local, so an AbortSignal stays in this
// document (QED64 HARDENING #56: a signal passed across postMessage never cancels), and the RPC
// keep-alive is a timer here.
import { loadRenderInfoview } from "@leanprover/infoview/loader";
import type { EditorApi, InfoviewApi, InfoviewConfig, TextInsertKind } from "@leanprover/infoview-api";

type Location = Parameters<InfoviewApi["initialize"]>[0];
import { defaultInfoviewConfig } from "@leanprover/infoview-api";
import { CancellationTokenSource } from "vscode-jsonrpc/browser";
import type { LeanClient } from "./lean-client";
import type { Position } from "./text-document";

export interface InfoviewHost {
  /** The cursor moved (an offset into the sheet's text). */
  cursorAt(offset: number): void;
  /** A new client (a new checker session) took over the document. */
  attach(client: LeanClient): void;
  /** The document was replaced (another sheet) or changed. */
  documentChanged(): void;
}

export interface TextSink {
  /** Replace [from, to) of the sheet's text (offsets), through the editor so it stays in sync. */
  replace(from: number, to: number, text: string): boolean;
  cursor(): number;
}

const base = import.meta.env.BASE_URL;
const IMPORTS = {
  "@leanprover/infoview": `${base}infoview/index.production.min.js`,
  "react": `${base}infoview/react.production.min.js`,
  "react/jsx-runtime": `${base}infoview/react-jsx-runtime.production.min.js`,
  "react-dom": `${base}infoview/react-dom.production.min.js`,
};
const KEEP_ALIVE_MS = 10_000;

export function mountInfoview(el: HTMLElement, text: TextSink): InfoviewHost {
  let client: LeanClient | null = null;
  let api: InfoviewApi | null = null;
  let initialized = false;
  const serverSubs = new Map<string, number>();
  const clientSubs = new Map<string, number>();
  const keepAlive = new Map<string, number>();
  const pendingCursor: { offset: number | null } = { offset: null };
  let detach: (() => void) | null = null;

  const uri = () => client?.document?.uri ?? "";
  const location = (offset: number): Location | undefined => {
    const doc = client?.document;
    if (!doc) return undefined;
    const p = doc.positionAt(offset);
    return { uri: doc.uri, range: { start: p, end: p } };
  };
  const bump = (m: Map<string, number>, k: string, d: number) => {
    const n = (m.get(k) ?? 0) + d;
    if (n <= 0) m.delete(k); else m.set(k, n);
  };
  const offsetOf = (p: Position) => client?.document?.offsetAt(p) ?? 0;

  const editorApi: EditorApi = {
    async saveConfig(_c: InfoviewConfig) { /* the page keeps the defaults */ },
    async sendClientRequest(_uri, method, params, options) {
      if (!client) throw new Error("Lean is not running");
      const cts = new CancellationTokenSource();
      options?.abortSignal?.addEventListener("abort", () => cts.cancel(), { once: true });
      try {
        return await client.connection.sendRequest(method, params, cts.token);
      } finally {
        cts.dispose();
      }
    },
    async sendClientNotification(_uri, method, params) {
      client?.connection.sendNotification(method, params);
    },
    async subscribeServerNotifications(method) { bump(serverSubs, method, 1); },
    async unsubscribeServerNotifications(method) { bump(serverSubs, method, -1); },
    async subscribeClientNotifications(method) { bump(clientSubs, method, 1); },
    async unsubscribeClientNotifications(method) { bump(clientSubs, method, -1); },
    async copyToClipboard(t) { await navigator.clipboard.writeText(t); },
    async insertText(t: string, kind: TextInsertKind, pos) {
      const doc = client?.document;
      if (!doc) return;
      let at = pos ? offsetOf(pos.position) : text.cursor();
      if (kind === "above") {
        // a new line above the cursor's line, with its indentation (vscode-lean4's insertText)
        const p = doc.positionAt(at);
        const lineStart = doc.offsetAt({ line: p.line, character: 0 });
        const indent = /^\s*/.exec(doc.getText().slice(lineStart))?.[0] ?? "";
        at = lineStart;
        text.replace(at, at, `${indent}${t}\n`);
        return;
      }
      text.replace(at, at, t);
    },
    async applyEdit(te) {
      const doc = client?.document;
      if (!doc) return;
      const edits = [
        ...Object.entries(te.changes ?? {}).filter(([u]) => u === doc.uri).flatMap(([, es]) => es),
        ...(te.documentChanges ?? []).flatMap((c) => ("edits" in c && c.textDocument.uri === doc.uri ? c.edits : [])),
      ].map((e) => ({ from: doc.offsetAt(e.range.start), to: doc.offsetAt(e.range.end), text: "newText" in e ? e.newText : "" }));
      // later edits first, so earlier offsets stay valid
      for (const e of edits.sort((a, b) => b.from - a.from)) text.replace(e.from, e.to, e.text);
    },
    async showDocument() { /* one document: nothing to show */ },
    async restartFile() { client?.changed(); },
    async createRpcSession(u) {
      if (!client) throw new Error("Lean is not running");
      const r = await client.connection.sendRequest("$/lean/rpc/connect", { uri: u }) as { sessionId: string };
      const sessionId = r.sessionId;
      const c = client;
      keepAlive.set(sessionId, window.setInterval(() => {
        if (c !== client) return;
        c.connection.sendNotification("$/lean/rpc/keepAlive", { uri: u, sessionId });
      }, KEEP_ALIVE_MS));
      return sessionId;
    },
    async closeRpcSession(sessionId) {
      window.clearInterval(keepAlive.get(sessionId));
      keepAlive.delete(sessionId);
    },
  };

  loadRenderInfoview(IMPORTS, [editorApi, el], (a) => {
    api = a;
    void api.changedInfoviewConfig({ ...defaultInfoviewConfig, autoOpenShowsGoal: true });
    if (client) void restarted();
  });

  /** As the extension's InfoProvider.initInfoview/resetServerState: `initialize` once with the
   * cursor, then the server's (re)start with its `initialize` answer, then the cursor again. */
  async function restarted() {
    if (!api || !client) return;
    const c = client;
    const init = (await c.initializeResult) ?? { capabilities: {} };
    const loc = location(pendingCursor.offset ?? text.cursor());
    if (c !== client || !api || !loc) return;
    if (!initialized) { initialized = true; await api.initialize(loc); }
    await api.serverStopped(undefined);
    await api.serverRestarted(init as never);
    await api.changedCursorLocation(loc);
  }

  return {
    cursorAt(offset) {
      pendingCursor.offset = offset;
      const loc = location(offset);
      if (!api || !loc || !initialized) return; // restarted() initializes with the latest cursor
      void api.changedCursorLocation(loc);
    },
    attach(c) {
      detach?.();
      for (const id of keepAlive.values()) window.clearInterval(id);
      keepAlive.clear();
      client = c;
      const onNote = (method: string, params: unknown) => {
        if (serverSubs.has(method)) void api?.gotServerNotification(method, params);
      };
      const onDiag = (p: unknown) => {
        if (serverSubs.has("textDocument/publishDiagnostics")) void api?.gotServerNotification("textDocument/publishDiagnostics", p);
      };
      c.onNotification.add(onNote);
      c.onDiagnostics.add(onDiag);
      detach = () => { c.onNotification.delete(onNote); c.onDiagnostics.delete(onDiag); };
      void restarted();
    },
    documentChanged() {
      const doc = client?.document;
      if (!doc || !api) return;
      if (clientSubs.has("textDocument/didChange")) {
        void api.sentClientNotification("textDocument/didChange", {
          textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text: doc.getText() }],
        });
      }
      void uri;
    },
  };
}
