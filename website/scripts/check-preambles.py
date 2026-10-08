#!/usr/bin/env python3
"""Check that each library copy of a sheet preamble is still verbatim.

Bewijzen/Customlib/WeakInduction.lean is L07's preamble (from its first `import` to its
`#doc` line) as a module, so that L08 can import it (a sheet with empty holes never
compiles). Exit 1 when the copy and the sheet differ."""
import os, sys
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
COPIES = {"Bewijzen/Customlib/WeakInduction.lean": "Bewijzen/L07_Weak_Induction/sheet1_weak_induction.lean"}

def preamble(text):
    lines = text.split("\n")
    start = next(i for i, l in enumerate(lines) if l.startswith("import "))
    end = next((i for i, l in enumerate(lines) if l.startswith("#doc ")), len(lines))
    return "\n".join(lines[start:end]).rstrip("\n")

bad = 0
for copy, sheet in COPIES.items():
    a = preamble(open(os.path.join(REPO, copy), encoding="utf-8").read())
    b = preamble(open(os.path.join(REPO, sheet), encoding="utf-8").read())
    if a != b:
        print(f"{copy} is not {sheet}'s preamble any more: copy it again", file=sys.stderr)
        bad = 1
    else:
        print(f"ok {copy} == preamble of {sheet}")
sys.exit(bad)
