/*
 * A dump of the shelf, small enough to commit.
 *
 * /mxn/ks/ reads a Cloudflare Worker. Its offline mock reads what this writes,
 * and the two go through the same arithmetic on purpose: every number in the
 * fixture is produced by src/mxn-ks/model.ts, which is the module the live page
 * uses. A fixture derived by a second implementation would make the mock a lie
 * about the page, which is the one thing a mock must never be.
 *
 * Two sources, one output.
 *
 *   npm run dump:ks -- --url https://mxn-solutions-api.ysetbon.workers.dev
 *
 *     …writing public/mxn/ks-atlas.json by default, which is what both
 *     /mxn/ks/?data=mock and mocks/ks-atlas.html read.
 *
 *     The real thing. Cache reads are public (CACHE_PUBLIC_READS), so no token
 *     is needed; pass --token if the deployment has closed them.
 *
 *   npm run dump:ks -- --from node_modules/.cache/ks-raw
 *
 *     Artifacts written by scripts/ks-fixtures.py, for a machine with no Worker.
 *
 * What it prunes, and why it can:
 *
 *   result.stages  the strand geometry, and 238 kB of a 240 kB run. The atlas
 *                  reads rows and nothing else.
 *   the censuses   megabytes each. Their derived BandStat is a few hundred
 *                  bytes and is what the grid, the charts and the fit all read.
 *
 * So a shelf of hundreds of runs lands in a fixture measured in tens of kB.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

import {
  CACHE_VERSION, parseRunKey,
  type CatalogueEntry, type RunArtifact, type TraceArtifact,
} from "../src/mxn-lab/cache";
import type { Band } from "../src/mxn-lab/trace-band";
import {
  bandStatFrom, recordsFromRun, type AtlasRecord, type BandStat,
} from "../src/mxn-ks/model";
import { bandSlot, type AtlasDump, type GeometryDump } from "../src/mxn-ks/shelf";
import type { Stage } from "../src/mxn-lab/exact-draw";

const SIDES = [1, 2, 3, 4];
const HAND_DIRECTIONS = ["lh-cw", "lh-ccw", "rh-cw", "rh-ccw"];
const PAGE = 1000;
/** Refuse to write more than this without --force. A fixture is committed. */
const SIZE_WARNING = 2_000_000;

function arg(name: string, fallback = "") {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--")
    ? process.argv[at + 1]
    : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const url = arg("url").replace(/\/+$/, "");
const from = arg("from");
const token = arg("token");
// public/ rather than mocks/fixtures/: one copy serves both the mock page and
// the live page's ?data=mock, and vite copies public/ into the build untouched.
const out = arg("out", "public/mxn/ks-atlas.json");
/**
 * The drawings, beside the dump rather than inside it.
 *
 * A run's stages are the bulk of it — 28 kB for a 1x1, 231 kB for a three-level
 * 2x2, against 1 kB once they are gone — and most readers never open a drawing.
 * Two files means the grid arrives instantly and the rings arrive on demand.
 * Only cells matching --geometry-only get one; the whole shelf's strands are
 * tens of megabytes and do not belong in a repository.
 */
const geometryOut = arg("geometry-out", "public/mxn/ks-atlas-geometry.json");
const geometryOnly = arg("geometry-only", "ks=1");

if (!url && !from) {
  console.error("usage: npm run dump:ks -- --url <worker> | --from <dir> [--out <file>]");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Reading a live Worker.
//
// The same transport cache.ts uses: the client gzips and the client gunzips,
// under a private header rather than Content-Encoding, so what arrives is
// deterministic. Node's fetch will not have touched it.
// ---------------------------------------------------------------------------

const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

async function getArtifact(path: string): Promise<unknown | null> {
  const response = await fetch(`${url}${path}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  const codec = (response.headers.get("x-mxn-codec") || "identity").toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());
  return JSON.parse((codec === "gzip" ? gunzipSync(body) : body).toString("utf8"));
}

/**
 * The same, with the tolerance a long walk over a domestic connection needs.
 *
 * This makes hundreds of requests, and docs/mxn-farm.md is explicit that over
 * hours on a home line a dropped one is the expected case rather than the
 * exception. Losing an entire dump to a single blip -- and, worse, losing it at
 * request 300 of 400 -- would be the same failure the farm's upload retry
 * exists to prevent. Three tries with backoff, then the caller decides.
 */
async function tryGet(path: string, label: string): Promise<unknown | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getArtifact(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 2) {
        console.log(`  ! ${label} — ${message}`);
        failures.push(label);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

/** Everything that could not be read, reported at the end rather than thrown. */
const failures: string[] = [];

/**
 * Walk narrow prefixes, never one broad one.
 *
 * /catalogue clamps limit at 1000 and its D1 branch answers `truncated: false`
 * unconditionally, so one `run/v3/` prefix over a full shelf silently returns
 * the first thousand keys as if they were all of them. Thirty-two bounded
 * requests instead, and any prefix that does come back exactly full is reported.
 */
async function listLive() {
  const entries: CatalogueEntry[] = [];
  const truncated: string[] = [];
  // One probe before the walk. Without it a wrong URL or a Worker that is down
  // spends 64 prefixes x 3 retries getting the same answer before saying so,
  // and buries the one line that would have explained it. Same request the
  // runbook tells an operator to curl.
  const health = await getArtifact("/health").catch(error => {
    throw new Error(`${url}/health is not answering — ${error.message}\n`
      + "Check the URL, and that the Worker is deployed (worker-api/README.md).");
  }) as Record<string, unknown> | null;
  console.log(`  /health: ${JSON.stringify(health ?? {})}`);

  for (const hd of HAND_DIRECTIONS) {
    for (const m of SIDES) {
      for (const n of SIDES) {
        const prefix = `run/${CACHE_VERSION}/${hd}/${m}x${n}/`;
        const query = new URLSearchParams({ prefix, limit: String(PAGE) });
        const body = await tryGet(`/catalogue?${query}`, `catalogue ${prefix}`) as
          { entries?: CatalogueEntry[] } | null;
        const page = body?.entries ?? [];
        if (page.length >= PAGE) truncated.push(prefix);
        entries.push(...page);
      }
    }
  }
  return { entries, truncated };
}

async function fromWorker() {
  const { entries, truncated } = await listLive();
  console.log(`  ${entries.length} run keys across ${HAND_DIRECTIONS.length * 16} prefixes`);
  const records: AtlasRecord[] = [];
  const bands: Record<string, BandStat> = {};
  const stages: Record<string, Stage[]> = {};

  for (const entry of entries) {
    const parsed = parseRunKey(entry.key);
    if (!parsed || parsed.cacheVersion !== CACHE_VERSION) continue;
    const run = await tryGet(`/cache/${entry.key}`, entry.key) as RunArtifact | null;
    if (!run?.result) continue;
    const rows = recordsFromRun(
      entry.key, parsed.descriptor, run.computedAt ?? entry.computedAt,
      run.result as Parameters<typeof recordsFromRun>[3],
    );
    records.push(...rows);
    if (wantsGeometry(parsed.descriptor.ks)) {
      const drawn = (run.result as { stages?: Stage[] }).stages;
      if (Array.isArray(drawn)) stages[entry.key] = roundStages(drawn);
    }

    for (const record of rows) {
      for (const band of ["h", "v"] as Band[]) {
        const key = `trace/${entry.key.replace(/^run\//, "")}/L${record.level}-${band}`;
        const trace = await tryGet(`/cache/${key}`, key) as TraceArtifact | null;
        if (!trace) continue;
        bands[bandSlot(record, band)] = bandStatFrom(
          band, record.m, record.n,
          trace.plan as Parameters<typeof bandStatFrom>[3],
          trace.census as Parameters<typeof bandStatFrom>[4],
        );
      }
    }
    console.log(`  ${entry.key} · ${rows.length} level${rows.length === 1 ? "" : "s"}`);
  }
  return { records, bands, stages, truncated, runs: entries.length, source: url };
}

/**
 * Which cells get a drawing, matched the way ks-fixtures.py's --only matches.
 *
 * The default is `ks=1`, which is every size at k = 1 plus any sequence that
 * starts there — one row across the whole grid for the contact sheet, and the
 * multi-level sequences for the filmstrip, which is exactly what the two
 * drawings need and nothing else.
 */
function wantsGeometry(ks: number[]) {
  return `ks=${ks.join(" ")}`.startsWith(geometryOnly);
}

/** Strand coordinates to two decimals; see ks-fixtures.py's round_stages. */
function roundStages(stages: Stage[]): Stage[] {
  const fix = (value: unknown): unknown => {
    if (typeof value === "number") return Math.round(value * 100) / 100;
    if (Array.isArray(value)) return value.map(fix);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fix(v)]));
    }
    return value;
  };
  return fix(stages) as Stage[];
}

// ---------------------------------------------------------------------------
// Reading what scripts/ks-fixtures.py wrote.
// ---------------------------------------------------------------------------

function fromDirectory() {
  const files = readdirSync(from);
  const read = (name: string) => JSON.parse(readFileSync(join(from, name), "utf8"));
  const records: AtlasRecord[] = [];
  const bands: Record<string, BandStat> = {};
  let runs = 0;

  for (const file of files.filter(name => name.startsWith("run__")).sort()) {
    const run = read(file) as RunArtifact;
    const key = `run/${run.cacheVersion}/${[
      `${run.descriptor.hand}-${run.descriptor.direction}`,
      `${run.descriptor.m}x${run.descriptor.n}`,
      run.descriptor.ks.join("_"),
      `s${run.descriptor.shortArms ? 1 : 0}-e${run.descriptor.step}-b${run.descriptor.budget}`,
    ].join("/")}`;
    // Round-tripped through the parser so a fixture cannot carry a key the live
    // page would not recognise.
    if (!parseRunKey(key)) throw new Error(`${file} produced an unreadable key: ${key}`);
    runs += 1;
    const rows = recordsFromRun(
      key, run.descriptor, run.computedAt,
      run.result as Parameters<typeof recordsFromRun>[3],
    );
    records.push(...rows);
  }

  for (const file of files.filter(name => name.startsWith("trace__")).sort()) {
    const trace = read(file) as TraceArtifact;
    const record = records.find(r =>
      r.m === trace.descriptor.m && r.n === trace.descriptor.n
      && r.ks.join("_") === trace.descriptor.ks.join("_")
      && r.level === trace.level);
    if (!record) continue;
    const band = trace.band as Band;
    bands[bandSlot(record, band)] = bandStatFrom(
      band, record.m, record.n,
      trace.plan as Parameters<typeof bandStatFrom>[3],
      trace.census as Parameters<typeof bandStatFrom>[4],
    );
  }
  // The geometry ks-fixtures.py --geometry wrote alongside, for the cells it
  // was asked to keep drawings for.
  const stages: Record<string, Stage[]> = {};
  for (const file of files.filter(name => name.startsWith("geom__")).sort()) {
    const geom = read(file) as { runKey: string; stages: Stage[] };
    if (geom?.runKey && Array.isArray(geom.stages)) stages[geom.runKey] = geom.stages;
  }
  return {
    records, bands, stages, truncated: [] as string[], runs,
    source: `local engine sweep (${from})`,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(url ? `Reading ${url}` : `Reading ${from}`);
  const { records, bands, stages, truncated, runs, source } = url
    ? await fromWorker()
    : fromDirectory();

  // Newest first, so a truncated read of the file is still the current shelf.
  records.sort((a, b) =>
    b.computedAt.localeCompare(a.computedAt) || a.runKey.localeCompare(b.runKey));

  const dump: AtlasDump = {
    // Stamped after the walk rather than during it, so the file says when it
    // was written and not when the first request went out.
    generatedAt: new Date().toISOString(),
    source,
    cacheVersion: CACHE_VERSION,
    runs,
    truncated,
    records,
    bands,
  };
  const text = JSON.stringify(dump);

  const sizes = new Set(records.map(r => `${r.m}×${r.n}`));
  const ks = new Set(records.map(r => r.k));
  const flags = new Set(records.map(r => `s${r.shortArms ? 1 : 0}-e${r.step}-b${r.budget}`));
  const measured = Object.values(bands).filter(b => b.state === "measured").length;
  console.log("");
  console.log(`  runs        ${runs}`);
  console.log(`  records     ${records.length} (one per level)`);
  console.log(`  sizes       ${[...sizes].sort().join(", ")}`);
  console.log(`  ks          ${[...ks].sort((a, b) => a - b).join(", ")}`);
  console.log(`  flags       ${[...flags].join(", ")}`);
  console.log(`  bands       ${Object.keys(bands).length}, of which ${measured} measured`);
  console.log(`  size        ${(text.length / 1024).toFixed(1)} kB`);
  if (truncated.length) {
    console.log(`  ⚠ ${truncated.length} prefix(es) came back full — this dump may be short:`);
    truncated.forEach(prefix => console.log(`      ${prefix}`));
  }
  if (failures.length) {
    // Reported, never swallowed. A dump that is quietly missing a size looks
    // exactly like a shelf that never had it, and the whole page is an argument
    // from absence as much as from what is there.
    console.log(`  ⚠ ${failures.length} read(s) failed after three tries and are missing:`);
    failures.slice(0, 10).forEach(key => console.log(`      ${key}`));
    if (failures.length > 10) console.log(`      …and ${failures.length - 10} more`);
  }

  if (!records.length) {
    console.error("\nNothing was read. Refusing to write an empty dump over a good one.");
    process.exit(1);
  }

  if (text.length > SIZE_WARNING && !flag("force")) {
    console.error(`\nRefusing to write ${(text.length / 1e6).toFixed(1)} MB to ${out} `
      + "— this file is committed. Pass --force if you mean it.");
    process.exit(1);
  }
  writeFileSync(out, `${text}\n`);
  console.log(`\nWrote ${out}`);

  const geometry: GeometryDump = { generatedAt: dump.generatedAt, source, stages };
  const drawings = Object.keys(stages).length;
  if (drawings) {
    const geometryText = JSON.stringify(geometry);
    writeFileSync(geometryOut, `${geometryText}\n`);
    console.log(`Wrote ${geometryOut} — ${drawings} run(s), `
      + `${(geometryText.length / 1024 / 1024).toFixed(2)} MB, matched by ${geometryOnly}`);
  } else {
    // Said out loud rather than left as an empty file: a snapshot with no
    // drawings looks identical to a page whose drawings are broken.
    console.log(`No geometry matched ${geometryOnly} — ${geometryOut} left as it was. `
      + (url ? "" : "Regenerate the raw sweep with --geometry."));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
