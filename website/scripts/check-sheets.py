#!/usr/bin/env python3
"""Elaborate every proof sheet with a native Lean and judge its messages.

usage: check-sheets.py --lean <lean> --lean-path <a:b:...> --out <dir> [--opts=-Dk=v,...]
                       [--repo <course checkout>] [--sheets <glob-or-path> ...] [-j N]

Writes <out>/<sheet id>.json: {sheet, rc, seconds, messages: [{severity, line, col, endLine,
endCol, text, inHole}]} where a sheet id is its path under Bewijzen/ without `.lean`, `/` as `.`.
Prints one line per sheet and a summary. A sheet's exercise holes (`:::input` blocks) ship
empty, so the errors of a `::::multilean` block from its first hole on (the unsolved goal is
reported at the QED after the hole) are expected; an error anywhere else is unexpected and
makes the run exit 1. The JSON files are what the browser lane and the 4.31 baseline compare against.
"""
import argparse, glob, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument("--lean", required=True)
ap.add_argument("--lean-path", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--opts", default="")
ap.add_argument("--sheets", nargs="*")
ap.add_argument("-j", type=int, default=1)
ap.add_argument("--repo")
ap.add_argument("--known", help="known-issues JSON (expected/known-issues.json): errors reported as known, not unexpected")
a = ap.parse_args()
REPO = os.path.abspath(a.repo or os.path.join(os.path.dirname(__file__), "..", ".."))

def sheets():
    if a.sheets:
        out = []
        for g in a.sheets:
            out += sorted(glob.glob(g if os.path.isabs(g) else os.path.join(REPO, g)))
        return out
    return sorted(p for p in glob.glob(os.path.join(REPO, "Bewijzen", "L*", "*.lean")))

def holes(text):
    """1-based line ranges where an error belongs to an exercise hole: in each `::::multilean`
    block that holds `:::input` blocks, from its first hole to the block's closing fence."""
    lines = text.split("\n")
    out, block, first = [], None, None
    for i, line in enumerate(lines, 1):
        s = line.strip()
        if block is None and re.match(r"^::::+\s*multilean\b", s):
            block, first = i, None
        elif block is not None and first is None and re.match(r"^:::+\s*input\b", s):
            first = i
        elif block is not None and re.match(r"^::::+\s*$", s):
            if first is not None:
                out.append((first, i))
            block = None
    return out

def hole_count(text):
    return len(re.findall(r"^\s*:::+\s*input\b", text, re.M))

def sheet_id(path):
    rel = os.path.relpath(path, os.path.join(REPO, "Bewijzen"))
    return rel[:-len(".lean")].replace("/", ".")

opts = [o for o in a.opts.split(",") if o]
KNOWN = json.load(open(a.known))["issues"] if a.known else []
def known(sid, m):
    return any(k["sheet"] == sid and k["line"] == m["line"] and m["text"].startswith(k["textStartsWith"]) for k in KNOWN)
env = dict(os.environ, LEAN_PATH=a.lean_path)
os.makedirs(a.out, exist_ok=True)

def check(path):
    t0 = time.time()
    r = subprocess.run([a.lean, "--json", path] + opts, capture_output=True, text=True, env=env, cwd=REPO)
    dt = time.time() - t0
    text = open(path, encoding="utf-8").read()
    hs = holes(text)
    msgs = []
    for line in r.stdout.splitlines():
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            continue
        pos, end = m.get("pos") or {}, m.get("endPos") or m.get("pos") or {}
        ln = pos.get("line", 0)
        msgs.append({"severity": m.get("severity"), "line": ln, "col": pos.get("column", 0),
                     "endLine": end.get("line", ln), "endCol": end.get("column", 0),
                     "text": m.get("data", ""), "inHole": any(s <= ln <= e for s, e in hs)})
    rec = {"sheet": os.path.relpath(path, REPO), "rc": r.returncode, "seconds": round(dt, 1),
           "holes": hole_count(text), "messages": msgs, "stderr": r.stderr[-2000:]}
    json.dump(rec, open(os.path.join(a.out, sheet_id(path) + ".json"), "w"), indent=1, ensure_ascii=False)
    return path, rec

bad = 0
with ThreadPoolExecutor(max_workers=a.j) as ex:
    for path, rec in ex.map(check, sheets()):
        errs = [m for m in rec["messages"] if m["severity"] == "error"]
        holeErr = sum(1 for m in errs if m["inHole"])
        sid = sheet_id(path)
        stray = [m for m in errs if not m["inHole"] and not known(sid, m)]
        nknown = sum(1 for m in errs if not m["inHole"] and known(sid, m))
        warns = sum(1 for m in rec["messages"] if m["severity"] == "warning")
        status = "ok" if not stray and not rec["stderr"].strip() else "UNEXPECTED"
        if status != "ok":
            bad += 1
        print(f"{status:10} {sheet_id(path):60} {rec['seconds']:6.1f}s holes={rec['holes']} "
              f"hole-errors={holeErr} other-errors={len(stray)}{f' known={nknown}' if nknown else ''} warnings={warns}", flush=True)
        for m in stray[:5]:
            print(f"    {m['line']}:{m['col']} {m['text'][:300]!r}")
        if rec["stderr"].strip():
            print("    stderr: " + rec["stderr"].strip()[-300:])
print(f"{bad} sheet(s) with unexpected errors" if bad else "every error is inside an exercise hole")
sys.exit(1 if bad else 0)
