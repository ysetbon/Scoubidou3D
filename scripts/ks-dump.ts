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
import { bandSlot, type AtlasDump } from "../src/mxn-ks/shelf";

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
  for (const hd of HAND_DIRECTIONS) {
    for (const m of SIDES) {
      for (const n of SIDES) {
        const prefix = `run/${CACHE_VERSION}/${hd}/${m}x${n}/`;
        const query = new URLSearchParams({ prefix, limit: String(PAGE) });
        const body = await getArtifact(`/catalogue?${query}`) as
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

  for (const entry of entries) {
    const parsed = parseRunKey(entry.key);
    if (!parsed || parsed.cacheVersion !== CACHE_VERSION) continue;
    const run = await getArtifact(`/cache/${entry.key}`) as RunArtifact | null;
    if (!run?.result) continue;
    const rows = recordsFromRun(
      entry.key, parsed.descriptor, run.computedAt ?? entry.computedAt,
      run.result as Parameters<typeof recordsFromRun>[3],
    );
    records.push(...rows);

    for (const record of rows) {
      for (const band of ["h", "v"] as Band[]) {
        const key = `trace/${entry.key.replace(/^run\//, "")}/L${record.level}-${band}`;
        const trace = await getArtifact(`/cache/${key}`).catch(() => null) as TraceArtifact | null;
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
  return { records, bands, truncated, runs: entries.length, source: url };
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
  return { records, bands, truncated: [] as string[], runs, source: `local engine sweep (${from})` };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(url ? `Reading ${url}` : `Reading ${from}`);
  const { records, bands, truncated, runs, source } = url
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

  if (text.length > SIZE_WARNING && !flag("force")) {
    console.error(`\nRefusing to write ${(text.length / 1e6).toFixed(1)} MB to ${out} `
      + "— this file is committed. Pass --force if you mean it.");
    process.exit(1);
  }
  writeFileSync(out, `${text}\n`);
  console.log(`\nWrote ${out}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
