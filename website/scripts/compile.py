#!/usr/bin/env python3
"""Compile Lean modules from several source packages in dependency order with raw `lean`.

The website's olean overlay is built this way instead of with Lake: the toolchain release's
packs already hold Lean, Mathlib and their dependencies (compiled by the release's native
compiler), so only the modules the packs do not serve are compiled here, against the
unpacked packs, with the same native compiler. No Mathlib workspace, no network.

usage: compile.py --lean <lean> --out <dir> --base <dir>[:<dir>...]
                  --pkg <name>=<srcDir>[=<-Dk=v,-Dk=v>] [--pkg ...]
                  [--fill <name>=<srcDir>[=<opts>] ...]
                  --roots <Mod,Mod,...> [-j N] [--heavy-jobs N] [--plan]

A module is compiled when its source is found in a --pkg srcDir; otherwise it must already
have an .olean in a --base tree. A --fill package (an upstream library the packs serve only
part of, e.g. Mathlib) is compiled only for the modules no --base tree has. Lean looks a module
up in the first search-path entry holding its root directory (`Mathlib/`), so fill modules are
written to --fill-out, which first gets a hard-linked mirror of the base trees' copy of each
root they belong to (an unresolved import is an error, before anything runs).
Each compile writes every facet `lean -o` produces (.olean, .olean.server, .olean.private,
.ir, .ir.sig) and an .ilean into --out, mirroring the module path. A module is rebuilt when
its source, or any compiled dependency, is newer than its .olean.

Modules whose closure reaches Mathlib are "heavy" (each `lean` imports thousands of modules
and needs several GB): at most --heavy-jobs of them run at once, inside the overall -j.
"""
import argparse, os, re, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, FIRST_COMPLETED, wait

ap = argparse.ArgumentParser()
ap.add_argument("--lean", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--base", required=True)
ap.add_argument("--pkg", action="append", default=[])
ap.add_argument("--fill", action="append", default=[])
ap.add_argument("--fill-out")
ap.add_argument("--roots", required=True)
ap.add_argument("-j", type=int, default=4)
ap.add_argument("--heavy-jobs", type=int, default=1)
ap.add_argument("--plan", action="store_true")
ap.add_argument("--log-dir")
a = ap.parse_args()

pkgs = []  # (name, srcDir, opts, fill)
for fill, specs in ((False, a.pkg), (True, a.fill)):
    for spec in specs:
        parts = spec.split("=", 2)
        name, src = parts[0], os.path.abspath(parts[1])
        opts = [o for o in (parts[2].split(",") if len(parts) > 2 and parts[2] else []) if o]
        pkgs.append((name, src, opts, fill))
base = [os.path.abspath(b) for b in a.base.split(":") if b]
out = os.path.abspath(a.out)
fill_out = os.path.abspath(a.fill_out or os.path.join(out, "..", "fill"))

def in_base(mod):
    rel = mod.replace(".", "/") + ".olean"
    return any(os.path.isfile(os.path.join(b, rel)) for b in base)

_src = {}
def src_of(mod):
    if mod in _src:
        return _src[mod]
    rel = mod.replace(".", "/") + ".lean"
    hit = None
    for name, src, opts, fill in pkgs:
        p = os.path.join(src, rel)
        if os.path.isfile(p):
            if not (fill and in_base(mod)):
                hit = (name, src, opts, p)
            break
    _src[mod] = hit
    return hit

TOKEN = re.compile(r"[^\s]+")
def header_imports(path):
    """The modules a file's header imports (module system or legacy)."""
    text = open(path, encoding="utf-8").read()
    text = re.sub(r"/-.*?-/", " ", text, flags=re.S)       # block comments (headers do not nest them)
    imports = []
    for line in text.split("\n"):
        line = line.split("--", 1)[0].strip()
        if not line:
            continue
        toks = line.split()
        if toks[0] in ("module", "prelude"):
            continue
        i = 0
        while i < len(toks) and toks[i] in ("public", "private", "meta"):
            i += 1
        if i < len(toks) and toks[i] == "import":
            rest = [t for t in toks[i + 1:] if t not in ("all",)]
            imports += rest
            continue
        break
    return [m.strip("«»") if m.count(".") == 0 else m for m in imports]

graph, info, order, seen = {}, {}, [], set()
missing = []
def visit(mod, stack=()):
    if mod in seen:
        return
    s = src_of(mod)
    if s is None:
        if not in_base(mod):
            missing.append((mod, stack[-1] if stack else "<root>"))
        seen.add(mod)
        return
    if mod in stack:
        sys.exit(f"import cycle at {mod}: {' -> '.join(stack)}")
    deps = header_imports(s[3])
    for d in deps:
        visit(d, stack + (mod,))
    graph[mod] = [d for d in deps if d in info or src_of(d)]
    info[mod] = s
    seen.add(mod)
    order.append(mod)

for r in a.roots.split(","):
    if r:
        visit(r)
if missing:
    for m, by in missing:
        print(f"unresolved import {m} (imported by {by}): no source in any --pkg and no .olean in --base", file=sys.stderr)
    sys.exit(2)

heavy = {}
def is_heavy(mod):
    if mod in heavy:
        return heavy[mod]
    s = info[mod]
    h = any(d.startswith("Mathlib") for d in header_imports(s[3])) or any(is_heavy(d) for d in graph[mod])
    heavy[mod] = h
    return h
for m in order:
    is_heavy(m)

def is_fill(mod):
    return any(fill and src == info[mod][1] for _, src, _, fill in pkgs)

def olean(mod):
    return os.path.join(fill_out if is_fill(mod) else out, mod.replace(".", "/") + ".olean")

def mirror_roots():
    """Hard-link each base tree's copy of the fill modules' root directories into fill_out."""
    roots = sorted({m.split(".")[0] for m in order if is_fill(m)})
    for r in roots:
        stamp = os.path.join(fill_out, f".{r}.mirrored")
        if os.path.exists(stamp):
            continue
        n = 0
        for b in reversed(base):          # earlier base entries win, as on the search path
            top = os.path.join(b, r)
            if not os.path.isdir(top):
                continue
            for d, _, fs in os.walk(top):
                rel = os.path.relpath(d, b)
                os.makedirs(os.path.join(fill_out, rel), exist_ok=True)
                for f in fs:
                    dst = os.path.join(fill_out, rel, f)
                    if os.path.lexists(dst):
                        os.remove(dst)
                    os.link(os.path.join(d, f), dst)
                    n += 1
        open(stamp, "w").write(f"{n} files hard-linked from {':'.join(base)}\n")
        print(f"mirrored {r}/ from the base trees into {fill_out} ({n} files)", flush=True)

by_pkg = {}
for m in order:
    by_pkg[info[m][0]] = by_pkg.get(info[m][0], 0) + 1
print(f"{len(order)} modules to consider ({sum(heavy.values())} heavy): " +
      ", ".join(f"{k} {v}" for k, v in by_pkg.items()), flush=True)
if a.plan:
    for m in order:
        print(("H " if heavy[m] else "  ") + m + "  <- " + info[m][0])
    sys.exit(0)

if any(is_fill(m) for m in order):
    mirror_roots()
env = dict(os.environ)
env["LEAN_PATH"] = ":".join([out, fill_out] + base)
log_dir = a.log_dir or os.path.join(out, "..", "compile-logs")
os.makedirs(log_dir, exist_ok=True)

done, failed, rebuilt = set(), {}, set()
lock = threading.Lock()
heavy_sem = threading.Semaphore(max(1, a.heavy_jobs))

def stale(mod):
    o = olean(mod)
    if not os.path.exists(o):
        return True
    t = os.path.getmtime(o)
    if os.path.getmtime(info[mod][3]) > t:
        return True
    return any(d in rebuilt or (d in info and os.path.exists(olean(d)) and os.path.getmtime(olean(d)) > t)
               for d in graph[mod])

def build(mod):
    name, src, opts, path = info[mod]
    if not stale(mod):
        return mod, True, "up to date", 0.0
    o = olean(mod)
    os.makedirs(os.path.dirname(o), exist_ok=True)
    cmd = [a.lean, path, "-o", o, "-i", o[:-len(".olean")] + ".ilean", "--root", src] + opts
    sem = heavy_sem if heavy[mod] else None
    if sem:
        sem.acquire()
    t0 = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=src)
    finally:
        if sem:
            sem.release()
    dt = time.time() - t0
    logf = os.path.join(log_dir, mod + ".log")
    with open(logf, "w") as f:
        f.write(" ".join(cmd) + "\n\n" + r.stdout + "\n" + r.stderr)
    if r.returncode != 0:
        for ext in (".olean", ".olean.server", ".olean.private", ".ir", ".ir.sig", ".ilean"):
            p = o[:-len(".olean")] + ext
            if os.path.exists(p):
                os.remove(p)
        return mod, False, (r.stdout + r.stderr)[-4000:], dt
    with lock:
        rebuilt.add(mod)
    return mod, True, "ok", dt

pending = list(order)
running = {}
n = len(order)
k = 0
with ThreadPoolExecutor(max_workers=a.j) as ex:
    while pending or running:
        if not failed:
            for m in list(pending):
                if len(running) >= a.j:
                    break
                if all(d in done for d in graph[m]):
                    pending.remove(m)
                    running[ex.submit(build, m)] = m
        if not running:
            break
        fin, _ = wait(running, return_when=FIRST_COMPLETED)
        for f in fin:
            m = running.pop(f)
            mod, ok, msg, dt = f.result()
            k += 1
            if ok:
                done.add(mod)
                if msg != "up to date":
                    print(f"[{k}/{n}] ok {mod} ({dt:.0f}s)", flush=True)
            else:
                failed[mod] = msg
                print(f"[{k}/{n}] FAIL {mod} ({dt:.0f}s)\n{msg}", flush=True)
if failed:
    print(f"{len(failed)} module(s) failed: {', '.join(failed)}; {len(pending)} not attempted", flush=True)
    sys.exit(1)
print(f"complete: {len(rebuilt)} compiled, {n - len(rebuilt)} up to date", flush=True)
