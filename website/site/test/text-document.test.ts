// node --test test/  (Node strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { TextDocument, intersects } from "../src/text-document.ts";

test("a plain change replaces [start, end) and bumps the version", () => {
  const d = new TextDocument("file:///a.lean", "abc\ndef\n", 1);
  d.apply({ startInFile: 4, endInFile: 7, finalText: "XY" });
  assert.equal(d.getText(), "abc\nXY\n");
  assert.equal(d.version, 2);
});

test("both halves of a wrapping change refer to the text before it (as one VS Code WorkspaceEdit)", () => {
  // wrap "def" in :::input … ::: — the editor sends the opening and closing tag as two edits
  const d = new TextDocument("file:///a.lean", "abc\ndef\nghi", 1);
  d.apply({ firstEdit: { startInFile: 4, endInFile: 4, finalText: ":::input\n" }, secondEdit: { startInFile: 7, endInFile: 7, finalText: "\n:::" } });
  assert.equal(d.getText(), "abc\n:::input\ndef\n:::\nghi");
});

test("positions are UTF-16 code units, lines split at \\n", () => {
  const d = new TextDocument("file:///a.lean", "∀ x ∈ s, 𝒰\nQED", 1);
  const at = d.getText().indexOf("QED");
  assert.deepEqual(d.positionAt(at), { line: 1, character: 0 });
  assert.equal(d.offsetAt({ line: 1, character: 3 }), d.getText().length);
  const u = d.getText().indexOf("𝒰"); // a surrogate pair: two code units, as LSP counts it
  assert.deepEqual(d.positionAt(u + 2), { line: 0, character: u + 2 });
  assert.equal(d.offsetAt({ line: 0, character: 99 }), d.getText().indexOf("\n"), "a character past the line end clamps to it");
});

test("ranges intersect only when they share a non-empty part (VS Code's Range.intersection)", () => {
  const r = (a: number, b: number, c: number, e: number) => ({ start: { line: a, character: b }, end: { line: c, character: e } });
  assert.equal(intersects(r(1, 0, 3, 0), r(2, 0, 2, 5)), true);
  assert.equal(intersects(r(1, 0, 3, 0), r(3, 0, 4, 0)), false, "touching");
  assert.equal(intersects(r(1, 0, 3, 0), r(2, 1, 2, 1)), false, "an empty range");
});

test("an edit outside the text is refused", () => {
  const d = new TextDocument("file:///a.lean", "abc", 1);
  assert.throws(() => d.apply({ startInFile: 2, endInFile: 9, finalText: "" }));
});
