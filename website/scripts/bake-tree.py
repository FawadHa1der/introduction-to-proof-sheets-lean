#!/usr/bin/env python3
"""Assemble the olean tree the snapshot bakes mount: the release's slim packs, plus the
course overlay (out/build/lib) and the Mathlib modules compiled to fill the packs' gaps
(the files of out/build/fill that are not hard links into the base trees), all without
*.olean.private facets (the slim rule, as QED64's and lean4game's bakes) or *.ilean files.
Everything is hard-linked; the tree is rebuilt from scratch.

usage: bake-tree.py <slim tree> <overlay lib> <fill dir> <out>"""
import os, shutil, sys
slim, lib, fill, out = map(os.path.abspath, sys.argv[1:5])
if os.path.exists(out):
    shutil.rmtree(out)
counts = {}
def link_tree(src, label, only=lambda p, st: True):
    n = 0
    for d, _, fs in os.walk(src):
        rel = os.path.relpath(d, src)
        for f in fs:
            if f.endswith(".olean.private") or f.endswith(".ilean") or f.startswith("."):
                continue
            p = os.path.join(d, f)
            st = os.stat(p)
            if not only(p, st):
                continue
            dst = os.path.join(out, rel, f)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.lexists(dst):
                os.remove(dst)
            os.link(p, dst)
            n += 1
    counts[label] = n
link_tree(slim, "slim packs")
link_tree(lib, "overlay")
# fill: only what was compiled here (a file mirrored from the base trees has more links)
link_tree(fill, "mathlib fill", only=lambda p, st: st.st_nlink == 1)
print(", ".join(f"{v} files from the {k}" for k, v in counts.items()), "->", out)
