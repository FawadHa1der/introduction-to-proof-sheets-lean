// stage.mjs's patch of QED64's lean.worker.js: the course's options reach the resident loop's
// callMain exactly once, in both known forms of that line, and a worker that sets the
// engine-stack probe is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { patchWorker } from "../scripts/stage.mjs";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = ["-Dpp.unicode.fun=true", "-DautoImplicit=false"];

test("the pinned QED64's worker gets the flags once", () => {
  const pkg = path.dirname(createRequire(path.join(site, "package.json")).resolve("qed64/package.json"));
  const out = patchWorker(fs.readFileSync(path.join(pkg, "public/workers/lean.worker.js"), "utf8"), flags);
  assert.equal(out.split('"-Dpp.unicode.fun=true"').length - 1, 1);
});

test("the RESIDENT_ARGV form: flags added, Elab.async left at Lean's default", () => {
  const src = 'const RESIDENT_ARGV = Object.freeze(["--worker", "-Dserver.reportDelayMs=0", "-DElab.async=false"]);\n  M.callMain([...RESIDENT_ARGV]);\n';
  const out = patchWorker(src, flags);
  const argv = new Function("M", "let got; M = { callMain: (a) => { got = a; } };" + out + "return got;")();
  assert.deepEqual(argv, ["--worker", "-Dserver.reportDelayMs=0", ...flags]);
});

test("an unknown form, two lines, or a probe override is refused", () => {
  assert.throws(() => patchWorker("M.callMain(args);", flags), /known form/);
  assert.throws(() => patchWorker('M.callMain(["--worker", "-Dserver.reportDelayMs=0"]);\nM.callMain([...RESIDENT_ARGV]);', flags), /found 2/);
  assert.throws(() => patchWorker('self.Module.ENV.LEAN_WASM_STACK_PROBE_SLOTS = "8192";\nM.callMain([...RESIDENT_ARGV]);', flags), /PROBE_SLOTS/);
});
