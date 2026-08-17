// The JS -> Python boundary, in a real Pyodide.
//
//   npm run check:boundary
//
// Everything the lab and the farm compute crosses one seam: values set with
// `runtime.globals.set` on the JS side, read by name inside a `runPythonAsync`
// string on the Python side. No other test in this repository executes that
// seam. `npm run qa:cache` drives the real page against a real Worker but
// asserts the engine is NEVER woken -- that is the whole point of a cache test
// -- and the one path that does wake it fetches Pyodide from a CDN a sandbox
// blocks. So a marshalling bug is invisible to green CI.
//
// One reached a reader, and it is the reason this file exists:
//
//     level1_pin=mxn_l1.to_py() if mxn_l1 is not None else None
//
// A JS `null` handed to globals.set does not arrive as Python `None`. It
// arrives as `JsNull`, which IS NOT None and has no `.to_py()`, so that line
// reads as obviously correct and raises on every run, replayed or not:
//
//     AttributeError: 'JsNull' object has no attribute 'to_py'
//
// Pyodide comes off npm rather than the CDN, so this needs no network at run
// time and no browser. It boots in a couple of seconds; the engine's own .py
// files are never loaded, because what is under test is the seam and not the
// search.

import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const py = await loadPyodide();

// ---------------------------------------------------------------------------
console.log("=========== what a JS null actually becomes ===========");
//
// Pinned as a FACT about the runtime rather than as a rule to remember. If a
// future Pyodide starts mapping null to None this goes red, and the rule the
// workers follow can be relaxed on purpose instead of by accident.

py.globals.set("probe", null);
check("a JS null is not Python None",
  py.runPython("probe is not None"), py.runPython("type(probe).__name__"));
check("and it has no .to_py()",
  !py.runPython("hasattr(probe, 'to_py')"));
check("so the shipped-and-broken expression still raises here", (() => {
  try {
    py.runPython("probe.to_py() if probe is not None else None");
    return false;
  } catch (error) {
    return /JsNull/.test(String(error));
  }
})());
check("while a JS empty string is an ordinary Python str",
  (py.globals.set("probe", ""), py.runPython("type(probe).__name__")) === "str");

// ---------------------------------------------------------------------------
console.log("\n=========== the real l1_from_json, on the real seam ===========");
//
// The function itself, lifted out of bridge.py rather than restated: a copy
// here would be the second spelling of a boundary that exists to have one.

const bridgeSource = readFileSync("public/mxn/py/bridge.py", "utf8");
const start = bridgeSource.indexOf("def l1_from_json(");
const end = bridgeSource.indexOf("\ndef ", start + 1);
check("l1_from_json is findable in bridge.py", start !== -1 && end > start);
py.runPython(`import json\n${bridgeSource.slice(start, end)}`);

for (const [label, value, want] of [
  ["absent, as the workers send it", "", null],
  ["a pair", JSON.stringify([[0], [30, 80]]), [[0], [30, 80]]],
  ["a square pair", JSON.stringify([[40, 70], [40, 70]]), [[40, 70], [40, 70]]],
]) {
  py.globals.set("mxn_l1", value);
  let got;
  try {
    const raw = py.runPython("l1_from_json(mxn_l1)");
    got = raw === undefined || raw === null ? null : raw.toJs();
    raw?.destroy?.();
  } catch (error) {
    got = `threw ${error}`;
  }
  check(`  ${label}`, JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got));
}

for (const bad of ["[[0]]", "[1,2]", "[]", "\"x\"", "null"]) {
  py.globals.set("mxn_l1", bad);
  let threw = false;
  try { py.runPython("l1_from_json(mxn_l1)"); } catch { threw = true; }
  check(`  it refuses ${bad}`, threw);
}

// ---------------------------------------------------------------------------
console.log("\n=========== nothing dereferences a global that can be null ===========");
//
// The rule, stated exactly. It is NOT "no global may be JsNull" — `mxn_step`
// has been one since the day the step picker gained an "auto", and it is
// harmless because the Python side only ever tests it for truth, which JsNull
// answers false to. What is fatal is DEREFERENCING one: `.to_py()` on a JsNull
// is the crash that shipped, and it would be the same crash for any attribute.
//
// So: every `mxn_x.something(...)` in a worker's Python call string is looked
// up against the `globals.set` that supplies it, and that value must not be
// null or undefined when the caller omits the optional field. Read out of the
// sources rather than transcribed, so it cannot drift from what ships.

const CALL = /runPythonAsync\(([\s\S]*?)\n\s*\)\);/;
const SET_ONE = name =>
  new RegExp(`runtime\\.globals\\.set\\(\\s*"${name}"\\s*,\\s*([\\s\\S]*?)\\);`);

// A worker's own scope, modelled the way the bug happened: everything REQUIRED
// present, everything OPTIONAL absent. Size and ks are required — a job or a
// message without them is not one — while the search knobs and the level-1 pin
// are all "omit and take the default", which is exactly when `?? null` fires.
const REQUIRED = { m: 2, n: 1, ks: [-1] };
const scope = {
  data: { ...REQUIRED }, job: { ...REQUIRED }, ...REQUIRED,
  preferShortArms: undefined, extStep: undefined, comboBudget: undefined,
  reachFromPrevious: undefined, level1Extensions: undefined,
};
const evaluate = expression => Function(
  ...Object.keys(scope), `return (${expression});`)(...Object.values(scope));

for (const file of ["exact-worker.js", "farm-worker.js"]) {
  const source = readFileSync(`public/mxn/${file}`, "utf8");
  const call = CALL.exec(source);
  check(`${file} · its Python call string is findable`, !!call);
  if (!call) continue;

  const dereferenced = [...new Set(
    [...call[1].matchAll(/\b(mxn_[a-z0-9_]+)\s*\./gi)].map(hit => hit[1]))];
  check(`  it dereferences ${dereferenced.length || "no"} global(s)`,
    true, dereferenced.join(", ") || "none");

  for (const name of dereferenced) {
    const setter = SET_ONE(name).exec(source);
    check(`  ${name} is set somewhere`, !!setter);
    if (!setter) continue;
    let value;
    try {
      value = evaluate(setter[1]);
    } catch (error) {
      check(`  ${name}'s setter evaluates`, false, String(error));
      continue;
    }
    check(`  ${name} is never null with everything optional omitted`,
      value !== null && value !== undefined,
      `${JSON.stringify(value) ?? String(value)}`);
    // And prove it in the runtime rather than trusting the JS check.
    py.globals.set(name, value);
    check(`    Python sees a ${py.runPython(`type(${name}).__name__`)}, not a JsNull`,
      py.runPython(`type(${name}).__name__`) !== "JsNull");
  }
}

// ---------------------------------------------------------------------------
console.log("\n=========== the fitter's two bands, on the real seam ===========");
//
// The same bug, in the other direction, and this one shipped too: `fit-weave`
// set four globals and guarded them with `None if mxn_h_ext is None else
// mxn_h_ext.to_py()`. A band a fit does not move is sent as null — that is what
// "hold it where the engine left it" IS — so the guard was false for exactly
// the band it was written for, and the else branch dereferenced a JsNull.

{
  const start = bridgeSource.indexOf("def fit_bands_from_json(");
  const end = bridgeSource.indexOf("\ndef ", start + 1);
  check("fit_bands_from_json is findable in bridge.py", start !== -1 && end > start);
  py.runPython(`import json\n${bridgeSource.slice(start, end)}`);

  // The worker's own encoder, lifted the same way, so what is tested is what
  // the page actually sends rather than a second spelling of it.
  const workerSource = readFileSync("public/mxn/exact-worker.js", "utf8");
  const encoder = /function fitBands\(data\) \{([\s\S]*?)\n\}/.exec(workerSource);
  check("the worker's fitBands is findable", !!encoder);
  const fitBands = new Function("data", encoder[1]);

  for (const [label, data, want] of [
    ["both bands held — the flush case that crashed",
      { level: 2 }, [null, null, null, null]],
    ["one band placed, one held",
      { level: 2, vExt: [30, 80], vAngle: 60.62 },
      [null, null, [30, 80], 60.62]],
    ["both placed, off the grid as a fit leaves them",
      { level: 1, hExt: [84.37], hAngle: 126.8, vExt: [34.22], vAngle: 12 },
      [[84.37], 126.8, [34.22], 12]],
  ]) {
    py.globals.set("mxn_fit_bands", fitBands(data));
    let got;
    try {
      const raw = py.runPython("fit_bands_from_json(mxn_fit_bands)");
      got = raw?.toJs ? raw.toJs() : raw;
      raw?.destroy?.();
    } catch (error) {
      got = `threw ${String(error).split("\n")[0]}`;
    }
    check(`  ${label}`, JSON.stringify(got) === JSON.stringify(want),
      JSON.stringify(got));
  }

  // And the rule that keeps it fixed: the fit handlers must hand Python one
  // string and dereference nothing else. A `mxn_x.to_py()` creeping back into
  // one of them is the crash returning.
  for (const name of ["fit-weave", "fit-adopt"]) {
    const handler = new RegExp(`"${name}": async[\\s\\S]*?\\n  \\},`).exec(workerSource);
    check(`  the ${name} handler is findable`, !!handler);
    if (!handler) continue;
    const call = /runPythonAsync\(([\s\S]*?)\n\s*\)\];/.exec(handler[0]);
    const derefs = [...new Set([...(call?.[1] ?? "")
      .matchAll(/\b(mxn_[a-z0-9_]+)\s*\./gi)].map(hit => hit[1]))];
    check(`  ${name} dereferences no mxn_ global`, derefs.length === 0,
      derefs.join(", ") || "none");
  }
}

console.log(`\n${fail ? `${fail} check(s) failed, ${pass} passed`
                      : `all ${pass} checks passed`}`);
process.exit(fail ? 1 : 0);
