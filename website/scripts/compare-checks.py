#!/usr/bin/env python3
"""Compare two check-sheets.py result directories message by message.

usage: compare-checks.py <dir A> <dir B> [--label-a A] [--label-b B]

For each sheet in both: the messages (severity, line, column, text) only A has and only B has,
counted as multisets: a message twice in A and once in B is one message only in A. The order
of messages is not compared (Lean publishes them per command, not in file order). Exit 0 when
every sheet's messages are identical, 1 otherwise. Used to compare the 4.31
baseline with the port (native), one Lean release with the next (native 4.34 with native
4.35), and the browser runtime with native Lean."""
import json, os, sys
from collections import Counter
args = [x for x in sys.argv[1:] if not x.startswith("--label")]
a, b = args[0], args[1]
la = sys.argv[sys.argv.index("--label-a") + 1] if "--label-a" in sys.argv else "A"
lb = sys.argv[sys.argv.index("--label-b") + 1] if "--label-b" in sys.argv else "B"
results = lambda d: {n for n in os.listdir(d) if n.endswith(".json") and not n.startswith(".")}
names = sorted(results(a) & results(b))
diff = 0
for n in names:
    ma = json.load(open(os.path.join(a, n)))["messages"]
    mb = json.load(open(os.path.join(b, n)))["messages"]
    key = lambda m: (m["severity"], m["line"], m["col"], m["text"].strip())
    ca, cb = Counter(key(m) for m in ma), Counter(key(m) for m in mb)
    onlya = sorted((ca - cb).elements())
    onlyb = sorted((cb - ca).elements())
    if onlya or onlyb:
        diff += 1
        print(f"== {n[:-5]}: {len(onlya)} only in {la}, {len(onlyb)} only in {lb}")
        for m in onlya: print(f"  - {la} {m[0]} {m[1]}:{m[2]} {m[3][:400]!r}")
        for m in onlyb: print(f"  + {lb} {m[0]} {m[1]}:{m[2]} {m[3][:400]!r}")
print(f"{len(names)} sheets compared, {diff} differ")
sys.exit(1 if diff else 0)
