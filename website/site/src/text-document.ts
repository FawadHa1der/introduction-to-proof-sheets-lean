// The sheet's text as Lean sees it: the Verso file itself, edited by the Waterproof editor's
// document changes. Offsets and LSP positions are both UTF-16 code units (JavaScript string
// indices), as in VS Code's TextDocument, which the editor's offsets were made for.
import type { DocChange, WrappingDocChange } from "@impermeable/waterproof-editor";

export interface Position { line: number; character: number }
export interface Range { start: Position; end: Position }

export class TextDocument {
  readonly uri: string;
  version: number;
  private content: string;
  private lineStarts: number[] = [0];

  constructor(uri: string, content: string, version = 1) {
    this.uri = uri;
    this.content = content;
    this.version = version;
    this.reindex();
  }

  getText(): string { return this.content; }
  get lineCount(): number { return this.lineStarts.length; }

  /** Applies an editor change. Both halves of a wrapping change refer to the text before the
   * change, as in one VS Code WorkspaceEdit (waterproof-vscode applies them that way). */
  apply(change: DocChange | WrappingDocChange): void {
    const edits = "firstEdit" in change ? [change.firstEdit, change.secondEdit] : [change];
    const sorted = [...edits].sort((a, b) => b.startInFile - a.startInFile || b.endInFile - a.endInFile);
    let text = this.content;
    for (const e of sorted) {
      if (e.startInFile < 0 || e.endInFile < e.startInFile || e.endInFile > text.length) {
        throw new Error(`edit out of range: [${e.startInFile}, ${e.endInFile}) of ${text.length}`);
      }
      text = text.slice(0, e.startInFile) + e.finalText + text.slice(e.endInFile);
    }
    this.setText(text);
  }

  setText(text: string): void {
    this.content = text;
    this.version += 1;
    this.reindex();
  }

  offsetAt(p: Position): number {
    const line = Math.max(0, Math.min(p.line, this.lineStarts.length - 1));
    const start = this.lineStarts[line];
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] - 1 : this.content.length;
    return Math.min(start + Math.max(0, p.character), end);
  }

  positionAt(offset: number): Position {
    const o = Math.max(0, Math.min(offset, this.content.length));
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= o) lo = mid; else hi = mid - 1;
    }
    return { line: lo, character: o - this.lineStarts[lo] };
  }

  private reindex(): void {
    const starts = [0];
    for (let i = 0; i < this.content.length; i++) if (this.content.charCodeAt(i) === 10) starts.push(i + 1);
    this.lineStarts = starts;
  }
}

export const comparePos = (a: Position, b: Position): number => a.line - b.line || a.character - b.character;
/** Whether two ranges share a non-empty part, as `!a.intersection(b)?.isEmpty` in VS Code (an
 * empty range never intersects). */
export const intersects = (a: Range, b: Range): boolean => {
  const start = comparePos(a.start, b.start) >= 0 ? a.start : b.start;
  const end = comparePos(a.end, b.end) <= 0 ? a.end : b.end;
  return comparePos(start, end) < 0;
};
