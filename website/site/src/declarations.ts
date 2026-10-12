// The sheet's own declarations, read from its text: the editor's completions (what the VS Code
// extension gets from Lean's textDocument/documentSymbol). The page does not ask Lean for them:
// Verso answers documentSymbol with its own handler, which waits on every command snapshot of the
// document. On the browser runtime (wasm64-f69cca24d0878a58) that wait runs in Lean's interpreter
// at ~10 KiB of engine stack per command, so a sheet of ~50 commands (L07) overflows a Worker's
// stack and Lean dies on every new version of the text. Only a runtime with native exports for
// the wait would fix that (not planned), so the names come from here.
export interface Declaration { name: string; kind: string }

const DECL = /^[ \t]*(?:@\[[^\]\n]*\][ \t]*)?(?:(?:private|protected|noncomputable|partial|unsafe)[ \t]+)*(theorem|lemma|def|abbrev|instance|structure|inductive|class|axiom|opaque)[ \t]+([^\s:({[\]]+)/gm;

/** Each named declaration once, in order of appearance. */
export function declarationsOf(text: string): Declaration[] {
  const seen = new Set<string>();
  const out: Declaration[] = [];
  for (const m of text.matchAll(DECL)) {
    const [, kind, name] = m;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, kind });
  }
  return out;
}
