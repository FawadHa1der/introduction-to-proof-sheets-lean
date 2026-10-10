// The editor's completions from the sheet's own declarations (src/declarations.ts), read from the
// text: every named declaration once, with its kind; attributes and modifiers allowed; examples,
// comments and prose are not declarations.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { declarationsOf } from "../src/declarations.ts";

test("named declarations, once each, with their kind", () => {
  const text = [
    "theorem foo (n : Nat) : n = n := rfl",
    "  lemma bar : True := trivial",
    "@[simp] theorem baz : 1 = 1 := rfl",
    "private noncomputable def qux : Nat := 0",
    "example : True := trivial",
    "-- theorem commented : False",
    "The theorem below is in prose.",
    "theorem foo : 2 = 2 := rfl",
  ].join("\n");
  assert.deepEqual(declarationsOf(text), [
    { name: "foo", kind: "theorem" }, { name: "bar", kind: "lemma" },
    { name: "baz", kind: "theorem" }, { name: "qux", kind: "def" },
  ]);
});

test("L07's preamble lemmas are offered", () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const text = fs.readFileSync(path.join(repo, "Bewijzen/L07_Weak_Induction/sheet1_weak_induction.lean"), "utf8");
  const names = declarationsOf(text).map((d) => d.name);
  assert.ok(names.includes("two_pow_sub_one_step"), names.join(" "));
  assert.equal(new Set(names).size, names.length);
});
