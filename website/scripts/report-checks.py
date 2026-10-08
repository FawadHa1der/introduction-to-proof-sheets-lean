#!/usr/bin/env python3
"""Summarise the native and browser checks: per sheet, whether the messages agree, the native
check's time, and the browser FileWorker's elaboration time (from the first progress report to
the drain, after the snapshot is loaded).

usage: report-checks.py <native dir> <browser dir> [--markdown]"""
import json, os, sys

native_dir, browser_dir = sys.argv[1], sys.argv[2]
md = "--markdown" in sys.argv
rows = []
for name in sorted(os.listdir(native_dir)):
    if not name.endswith(".json"):
        continue
    n = json.load(open(os.path.join(native_dir, name)))
    bpath = os.path.join(browser_dir, name)
    b = json.load(open(bpath)) if os.path.exists(bpath) else None
    key = lambda m: (m["severity"], m["line"], m["col"], m["text"].strip())
    same = b is not None and sorted(map(key, n["messages"])) == sorted(map(key, b["messages"]))
    rows.append((name[:-5], len(n["messages"]), n["seconds"], b and b.get("elaborationSeconds"), "yes" if same else ("—" if b is None else "NO")))

if md:
    print("| Sheet | Messages | Native (s) | Browser (s) | Same messages |")
    print("|---|---:|---:|---:|---|")
    for r in rows:
        print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3] if r[3] is not None else '—'} | {r[4]} |")
else:
    for r in rows:
        print(f"{r[0]:60} msgs={r[1]:3} native={r[2]:6}s browser={str(r[3]):>6}s same={r[4]}")
checked = [r for r in rows if r[3] is not None]
if checked:
    nat = sum(r[2] for r in checked); bro = sum(r[3] for r in checked)
    print(f"\n{len(checked)} sheets checked in the browser runtime, {sum(r[4] == 'yes' for r in checked)} with native's messages; "
          f"elaboration {bro:.0f} s in the browser runtime against {nat:.0f} s natively ({bro / nat:.1f}x)")
