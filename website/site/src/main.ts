// The proof-sheets page: the Waterproof editor showing a sheet's Verso file, Lean 4.34 in this
// tab (QED64) checking that file as it is, and the Lean InfoView beside it.
import "@impermeable/waterproof-editor/styles.css";
import "@impermeable/waterproof-editor/waterproof-defaults.css";
import "./style.css";
import "./lean-format/infoview-trim.css";
import {
  ThemeStyle,
  WaterproofEditor,
  wrapInContainer,
  type DocChange,
  type WaterproofEditorConfig,
  type WrappingDocChange,
} from "@impermeable/waterproof-editor";
import * as langVerbose from "./lean-format/codemirror-lang-verbose";
import leanTactics from "./lean-format/tacticsLean.json";
import symbols from "./lean-format/symbols-lean.json";
import { topLevelBlocksLean } from "./lean-format/document-construction/construct-document";
import { tagConfigurationLean } from "./lean-format/leanFileConfiguration";
import { LeanSerializer } from "./lean-format/leanSerializer";
import { versoMarkdownToMarkdown } from "./lean-format/versoMarkdownSupport";
import { TextDocument } from "./text-document";
import { LeanClient, type EditorSink } from "./lean-client";
import { mountInfoview } from "./infoview";
import { Capability, Checker, checkCapabilities } from "./qed64";
import type { RelayStatus } from "qed64/embed";
import * as store from "./storage";

// --- the catalogue ----------------------------------------------------------------------------
interface Sheet { id: string; path: string; title: string; exercises: string[]; holes: number; imports: string[]; sha256: string; entry: string | null }
interface Lecture { id: string; number: number; title: string; sheets: Sheet[] }
interface Catalogue { course: string; lectures: Lecture[]; fixtures?: Sheet[] }

/** QED64 serves one document; every sheet is opened under this URI (a new sheet replaces it). */
const URI = "file:///proofsheets/Sheet.lean";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  select: $<HTMLSelectElement>("sheet"),
  prev: $<HTMLButtonElement>("prev"),
  next: $<HTMLButtonElement>("next"),
  status: $<HTMLSpanElement>("status"),
  notice: $<HTMLDivElement>("notice"),
  editor: $<HTMLDivElement>("editor"),
  infoview: $<HTMLDivElement>("infoview"),
  boot: $<HTMLDivElement>("boot"),
  bootTitle: $<HTMLHeadingElement>("boot-title"),
  bootLabel: $<HTMLParagraphElement>("boot-label"),
  bootProgress: $<HTMLProgressElement>("boot-progress"),
  teacher: $<HTMLInputElement>("teacher"),
  about: $<HTMLDialogElement>("about"),
};

function setStatus(text: string, kind: "" | "ok" | "busy" | "bad" = ""): void {
  ui.status.textContent = text;
  ui.status.className = `pill ${kind}`;
}
function notice(html: string | null, kind: "" | "bad" = ""): void {
  ui.notice.hidden = html === null;
  ui.notice.className = `notice ${kind}`;
  if (html !== null) ui.notice.innerHTML = html;
}

// --- the editor --------------------------------------------------------------------------------
let doc = new TextDocument(URI, "", 0);
let sheet: Sheet;
let client: LeanClient | null = null;
let checker: Checker | null = null;
let cursorOffset = 0;
let saveTimer: number | undefined;

const themeStyle = matchMedia("(prefers-color-scheme: dark)").matches ? ThemeStyle.Dark : ThemeStyle.Light;
const editorRef: { current?: WaterproofEditor } = {};
const infoview = mountInfoview(ui.infoview, {
  replace: (from, to, text) => editorRef.current?.replaceRange(from, to, text) ?? false,
  cursor: () => cursorOffset,
});
const config: WaterproofEditorConfig = {
  // The Lean configuration of waterproof-vscode's editor (editor/src/index.ts, FileFormat.Lean).
  completions: leanTactics,
  symbols,
  documentConstructor: topLevelBlocksLean,
  toMarkdown: versoMarkdownToMarkdown,
  markdownName: "Markdown",
  templates: {
    example: 'Example "example"\nGiven:\nAssume:\nConclusion:\nProof:\n\nQED',
    exercise: { statement: 'Exercise "exercise"\nGiven:\nAssume:\nConclusion:\nProof:', closing: "QED" },
    containerOpenTag: "multilean",
  },
  tagConfiguration: tagConfigurationLean,
  serializer: new LeanSerializer(),
  languageConfig: {
    highlightDark: langVerbose.highlight_dark,
    highlightLight: langVerbose.highlight_light,
    languageSupport: langVerbose.verbose(),
  },
  menubarEntries: [{
    title: "M...",
    hoverText: "Wrap selection in a container (groups math evaluation)",
    callback: () => editorRef.current?.executeProsemirrorCommand(wrapInContainer(tagConfigurationLean, "multilean")),
    isActive: (state) => wrapInContainer(tagConfigurationLean, "multilean")(state, undefined),
    buttonVisibility: { teacherModeOnly: true },
  }],
  api: {
    executeHelp() { /* Verbose's help is a tactic in the sheet ("Help"); nothing to run here */ },
    executeCommand() { /* Rocq only */ },
    editorReady() { /* the page drives the editor */ },
    documentChange(change: DocChange | WrappingDocChange) { onEditorChange(change); },
    applyStepError(message: string) { notice(`The editor lost track of the document (${escapeHtml(message)}). Reload the page; your last saved work is kept.`, "bad"); },
    cursorChange(offset: number) { cursorOffset = offset; infoview.cursorAt(offset); },
    viewportHint() { /* Lean checks the whole file */ },
  },
};
const editor = new WaterproofEditor(ui.editor, config, themeStyle);
editorRef.current = editor;

const editorSink: EditorSink = {
  setActiveDiagnostics: (d) => editor.setActiveDiagnostics(d),
  handleCompletions: (c) => editor.handleCompletions(c as never),
  setInputAreaStatus: (s) => editor.setInputAreaStatus(s),
  reportProgress: (at, total, label) => editor.reportProgress(at, total, label),
  setBusyIndicator: (from) => editor.setBusyIndicator(from),
  removeBusyIndicators: () => editor.removeBusyIndicators(),
};

function onEditorChange(change: DocChange | WrappingDocChange): void {
  doc.apply(change);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => store.saveSheet(sheet.id, doc.getText(), sheet.sha256), 400);
  checker?.prepare(doc.getText());
  client?.changed();
  infoview.documentChanged();
}

// --- sheets ------------------------------------------------------------------------------------
let catalogue: Catalogue;
let sheets: Sheet[] = [];

async function originalText(s: Sheet): Promise<string> {
  const r = await fetch(s.path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${s.path}: HTTP ${r.status}`);
  return r.text();
}

async function openSheet(s: Sheet, opts: { reset?: boolean; text?: string } = {}): Promise<void> {
  if (sheet && doc.getText()) store.saveSheet(sheet.id, doc.getText(), sheet.sha256);
  sheet = s;
  let text = opts.text;
  notice(null);
  if (text === undefined) {
    const saved = opts.reset ? null : store.loadSheet(s.id);
    if (opts.reset) store.forgetSheet(s.id);
    text = saved ? saved.text : await originalText(s);
    if (saved && saved.sha256 !== s.sha256) {
      notice(`This sheet was updated on the site after you started it. You are seeing your saved version. <button id="take-new">Start from the new version</button>`);
      document.getElementById("take-new")?.addEventListener("click", () => void openSheet(s, { reset: true }));
    }
  }
  store.setLastSheet(s.id);
  ui.select.value = s.id;
  const i = sheets.indexOf(s);
  ui.prev.disabled = i <= 0;
  ui.next.disabled = i >= sheets.length - 1;
  history.replaceState(null, "", s.id.startsWith("fixture.") ? `?fixture=${encodeURIComponent(s.id.slice(8))}` : `?sheet=${encodeURIComponent(s.id)}`);
  document.title = `${s.title} · Proof sheets`;
  doc = new TextDocument(URI, text, doc.version + 1);
  editor.init(text, doc.version);
  editor.setTeacherMode(ui.teacher.checked);
  checker?.prepare(text);
  client?.open(doc);
  infoview.documentChanged();
}

function fillSelect(): void {
  for (const l of catalogue.lectures) {
    const group = document.createElement("optgroup");
    group.label = `${l.number}. ${l.title}`;
    for (const s of l.sheets) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = `${l.number}.${l.sheets.indexOf(s) + 1} ${s.title}`;
      group.append(o);
    }
    ui.select.append(group);
  }
}

// --- Lean ----------------------------------------------------------------------------------------
const MB = 1024 * 1024;
let firstReady = false;
/** Boot progress: the start-up card until Lean has checked something once; after that (another
 * sheet's environment loading) the status pill, so the page stays usable. */
function bootBusy(label: string, info?: { loaded?: number; total?: number; unit?: string; stage?: string }): void {
  let text = label;
  if (info?.total && (info.unit === "bytes" || info.total > 1e6)) text = `${label} — ${Math.round((info.loaded ?? 0) / MB)} of ${Math.round(info.total / MB)} MB`;
  if (firstReady) { setStatus(`Loading Lean for this sheet… ${info?.total ? Math.round(100 * (info.loaded ?? 0) / info.total) + "%" : ""}`, "busy"); return; }
  ui.boot.hidden = false;
  ui.bootLabel.textContent = text;
  if (info?.total) {
    ui.bootProgress.max = info.total;
    ui.bootProgress.value = info.loaded ?? 0;
  } else {
    ui.bootProgress.removeAttribute("value");
  }
  setStatus("Starting Lean…", "busy");
}
function bootIdle(): void { ui.boot.hidden = true; }

function onRelay(s: RelayStatus): void {
  if (s.relay === "halted") {
    setStatus("Lean stopped", "bad");
    notice("Lean crashed repeatedly on this sheet and was stopped. Edit the sheet to start it again, or reload the page.", "bad");
    return;
  }
  if (s.relay === "rebooting") { setStatus("Restarting Lean…", "busy"); return; }
  switch (s.phase) {
    case "booting": case "starting": setStatus("Starting Lean…", "busy"); break;
    case "elaborating": setStatus("Checking…", "busy"); bootIdle(); firstReady = true; break;
    case "ready": setStatus("Checked", "ok"); bootIdle(); firstReady = true; break;
    case "headerRefused": setStatus("Imports not available", "bad"); bootIdle(); break;
    case "dead": setStatus("Lean stopped", "bad"); break;
  }
  if (s.lastDeath && s.relay === "serving") notice(null);
}

async function startLean(text: string): Promise<void> {
  try {
    checkCapabilities();
  } catch (e) {
    setStatus("Lean unavailable", "bad");
    notice(`${escapeHtml((e as Error).message)} You can read the sheet, but it cannot be checked in this browser.`, "bad");
    return;
  }
  ui.bootTitle.textContent = "Starting Lean in your browser";
  bootBusy("Preparing…");
  const entryOf = new Map<string, string>();
  for (const s of sheets) if (s.entry) entryOf.set(s.imports.join("\n"), s.entry);
  try {
    checker = await Checker.boot(text, { busy: bootBusy, idle: bootIdle, relay: onRelay }, (imports) => entryOf.get(imports.join("\n")) ?? null);
  } catch (e) {
    bootIdle();
    setStatus("Lean failed to start", "bad");
    notice(`Lean could not start: ${escapeHtml(e instanceof Capability ? e.message : String((e as Error).message ?? e))}. Reload the page to try again.`, "bad");
    return;
  }
  client = new LeanClient(checker.relay.clientPort, editorSink);
  client.onStatus.add(({ busy }) => { if (busy) setStatus("Checking…", "busy"); });
  client.open(doc); // first: it sends `initialize`, whose answer the InfoView waits for
  infoview.attach(client);
}

// --- page actions ---------------------------------------------------------------------------------
function download(): void {
  const blob = new Blob([doc.getText()], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = sheet.path.split("/").pop() ?? "sheet.lean";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function wireSplitter(): void {
  const splitter = $<HTMLDivElement>("splitter");
  const pane = document.querySelector<HTMLElement>(".info-pane")!;
  splitter.addEventListener("pointerdown", (e) => {
    splitter.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 240), window.innerWidth - 320);
      pane.style.flexBasis = `${w}px`;
    };
    const up = () => { splitter.removeEventListener("pointermove", move); splitter.removeEventListener("pointerup", up); };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
  });
}

async function main(): Promise<void> {
  const r = await fetch("sheets/index.json", { cache: "no-cache" });
  catalogue = await r.json();
  sheets = catalogue.lectures.flatMap((l) => l.sheets);
  fillSelect();
  ui.teacher.checked = store.teacherMode();
  // Waterproof's InfoView default: Lean's own tactic state hidden ("none"), the genre's
  // "We need to show" panel and the messages shown (setting waterproof.visibilityOfHypotheses).
  const hyps = $<HTMLInputElement>("hyps");
  hyps.checked = store.showTacticState();
  const applyHyps = () => document.documentElement.setAttribute("data-wp-hyp-visibility", hyps.checked ? "all" : "none");
  applyHyps();
  hyps.addEventListener("change", () => { store.setShowTacticState(hyps.checked); applyHyps(); });
  wireSplitter();

  const params = new URLSearchParams(location.search);
  const fixture = catalogue.fixtures?.find((f) => f.id === `fixture.${params.get("fixture")}`);
  const wanted = params.get("sheet") ?? store.lastSheet();
  if (fixture) {
    // a test fixture: open it (fresh, never saved over) instead of a sheet
    sheets = [...sheets, fixture];
    const o = document.createElement("option");
    o.value = fixture.id; o.textContent = fixture.title;
    ui.select.append(o);
    store.forgetSheet(fixture.id);
    await openSheet(fixture, { reset: true });
  } else {
    await openSheet(sheets.find((s) => s.id === wanted) ?? sheets[0]);
  }

  ui.select.addEventListener("change", () => { const s = sheets.find((x) => x.id === ui.select.value); if (s) void openSheet(s); });
  ui.prev.addEventListener("click", () => { const i = sheets.indexOf(sheet); if (i > 0) void openSheet(sheets[i - 1]); });
  ui.next.addEventListener("click", () => { const i = sheets.indexOf(sheet); if (i < sheets.length - 1) void openSheet(sheets[i + 1]); });
  $<HTMLButtonElement>("download").addEventListener("click", download);
  $<HTMLButtonElement>("reset").addEventListener("click", () => {
    if (confirm(`Reset “${sheet.title}” to the original sheet? Your work on it will be lost.`)) void openSheet(sheet, { reset: true });
  });
  $<HTMLInputElement>("upload").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const text = await f.text();
    (e.target as HTMLInputElement).value = "";
    await openSheet(sheet, { text });
    store.saveSheet(sheet.id, text, sheet.sha256);
  });
  ui.teacher.addEventListener("change", () => { store.setTeacherModeStored(ui.teacher.checked); editor.setTeacherMode(ui.teacher.checked); });
  $<HTMLAnchorElement>("about-link").addEventListener("click", (e) => { e.preventDefault(); ui.about.showModal(); });
  addEventListener("pagehide", () => store.saveSheet(sheet.id, doc.getText(), sheet.sha256));

  await startLean(doc.getText());
}

if (import.meta.env.DEV) {
  // a handle for the browser checks (development builds only)
  Object.assign(globalThis, { __proofsheets: { get doc() { return doc; }, get client() { return client; }, get checker() { return checker; }, get cursor() { return cursorOffset; }, editor, infoview } });
}

void main().catch((e) => {
  setStatus("Error", "bad");
  notice(`The page failed to load: ${escapeHtml(String((e as Error)?.message ?? e))}`, "bad");
  console.error(e);
});
