// The repeatable half of docs/outreach/README.md: sweep GitHub for the people
// and projects most likely to use, contribute to, or link this repo.
//
//   node scripts/prospect-github.mjs                 # sweep, merge, write the CSV
//   node scripts/prospect-github.mjs --dry           # print the table, write nothing
//   node scripts/prospect-github.mjs --people        # also walk kin stargazers/forkers
//   GITHUB_TOKEN=ghp_... node scripts/prospect-github.mjs --people
//
// Why a script and not a search box. The searching itself is the cheap part —
// the expensive part is remembering, month after month, which of the hits you
// already wrote to. So this writes into docs/outreach/pipeline.csv and NEVER
// overwrites a row whose `status` has been touched by a human. Re-running it is
// safe by construction: a lead you rejected in March stays rejected in June and
// does not come back to the top of the list, and a lead you contacted keeps the
// date you contacted it. Only genuinely new handles get appended.
//
// Two sweeps, and the second is the good one.
//
//   NEIGHBOURS — repository search over the query list in docs/outreach/prospect.json.
//     Finds projects in the same subject: weaving, braiding, knots, looms, textile
//     CAD, interlacement. Their maintainers are the natural first contributors.
//
//   KIN (--people) — the stargazers and forkers of the repos in `kin`, which are
//     this project's own ancestors (OpenStrandStudio, OpenStrandJS) plus whatever
//     neighbours scored highest. Someone who starred a strand editor has already
//     told you they care about the exact thing this repo does. That is a warmer
//     signal than any keyword match, which is why it gets the larger weight.
//
// Scoring is deliberately blunt and printed, so a bad ranking can be argued with
// rather than guessed at: subject-keyword hits, recency, audience size, and a
// location boost for the regions in `boost.locations` — Israel by default,
// because the author is there and a meeting that costs a train ticket converts
// at a different rate than a cold email to another continent.
//
// Unauthenticated this works but is tight: 10 search requests a minute and 60
// core requests an hour, so --people will run out and say so. Set GITHUB_TOKEN
// (any classic token with no scopes, or a fine-grained one with public read) and
// the ceilings become 30/min and 5,000/hour.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CONFIG = `${ROOT}docs/outreach/prospect.json`;
const PIPELINE = `${ROOT}docs/outreach/pipeline.csv`;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const DRY = has('--dry');
const PEOPLE = has('--people');
const MAX_QUERIES = Number(arg('--limit', '0')) || Infinity;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

if (!existsSync(CONFIG)) {
  console.error(`No config at ${CONFIG}. See docs/outreach/README.md.`);
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));

// ---- the API, with the rate limit treated as a fact rather than an error ----

let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { search = false } = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'scoubidou3d-prospect',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    calls++;
    if (res.ok) {
      // The search endpoint is metered per minute, the rest per hour. Pacing
      // here rather than after a 403 keeps a long --people run alive.
      await sleep(search ? (TOKEN ? 2100 : 6500) : (TOKEN ? 80 : 400));
      return res.json();
    }
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 5000), 65000);
      if (remaining === '0' && !TOKEN) {
        throw Object.assign(new Error('rate-limited'), { rateLimited: true });
      }
      console.error(`  … rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return null;
    throw new Error(`GitHub ${res.status} on ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

// ---- scoring ---------------------------------------------------------------

// Software has stolen every word this subject owns. "Loom" is a Java concurrency
// project and a screen recorder, "weaving" is what AspectJ does to bytecode,
// "fabric" is a Minecraft mod loader, "textile" is a markup language, "yarn" is
// a package manager, "warp" is a terminal. A bare keyword match is therefore
// worthless, and the first sweep of this script returned mostly JVM tooling.
//
// So the vocabulary is tiered and corroboration is required:
//   strong — only ever means the craft (kumihimo, macrame, weft, braid group)
//   weak   — means the craft about half the time (loom, weave, textile, fabric)
//   subject— supporting words that mean nothing alone (3d, geometry, pattern)
//   veto   — proves the other meaning; the repo is dropped outright
// A repo survives on two strong hits, or one strong plus any other hit. A pile
// of weak hits with nothing strong behind them is exactly the JVM noise.
const STRONG = (cfg.signals.strong || []).map((s) => s.toLowerCase());
const WEAK = (cfg.signals.weak || []).map((s) => s.toLowerCase());
const SUBJECT = (cfg.signals.subject || []).map((s) => s.toLowerCase());
const VETO = (cfg.signals.veto || []).map((s) => s.toLowerCase());
const BOOST_LOC = cfg.boost.locations.map((s) => s.toLowerCase());
const STOP = new Set((cfg.stop || []).map((s) => s.toLowerCase()));

const monthsSince = (iso) => (Date.now() - Date.parse(iso)) / (1000 * 60 * 60 * 24 * 30.4);

function subjectHits(text) {
  const t = ` ${(text || '').toLowerCase()} `;
  const veto = VETO.filter((w) => t.includes(w));
  const strong = STRONG.filter((w) => t.includes(w));
  const weak = WEAK.filter((w) => t.includes(w));
  const subject = SUBJECT.filter((w) => t.includes(w));
  const hits = [...strong.map((w) => `!${w}`), ...weak, ...subject];
  const corroborated = strong.length >= 2 || (strong.length === 1 && hits.length >= 2);
  return { hits, strong, weak, subject, veto, corroborated };
}

function scoreRepo(repo) {
  const blob = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`;
  const h = subjectHits(blob);
  if (h.veto.length || !h.corroborated) return { score: 0, hits: [], vetoed: h.veto };
  let score = 0;
  for (const w of h.strong) score += 14;
  for (const w of h.weak) score += 6;
  for (const w of h.subject) score += 4;
  const age = monthsSince(repo.pushed_at);
  score += age < 6 ? 18 : age < 12 ? 12 : age < 24 ? 6 : age < 48 ? 2 : 0;
  score += Math.min(Math.round(Math.log10((repo.stargazers_count || 0) + 1) * 9), 22);
  if (repo.fork) score -= 8;
  if (repo.archived) score -= 14;
  return { score, hits: h.hits, vetoed: [] };
}

function scoreUser(user, provenance) {
  // A person carries their own provenance — they starred an OpenStrand repo —
  // so unlike a repo they do not have to prove the subject in their bio, and a
  // veto word there is not disqualifying. The bio is a bonus, not the evidence.
  let score = provenance.base;
  const where = (user.location || '').toLowerCase();
  const boosted = BOOST_LOC.find((l) => where.includes(l));
  if (boosted) score += cfg.boost.points;
  const h = subjectHits(`${user.bio || ''} ${user.company || ''}`);
  const hits = h.veto.length ? [] : h.hits;
  for (const w of h.veto.length ? [] : h.strong) score += 10;
  for (const w of h.veto.length ? [] : [...h.weak, ...h.subject]) score += 4;
  if (user.company) score += 5;
  if (user.blog) score += 3;
  if (user.email) score += 6;
  score += Math.min(Math.round(Math.log10((user.followers || 0) + 1) * 6), 14);
  if (user.type === 'Organization') score += 8;
  return { score, boosted: !!boosted, hits };
}

// ---- the pipeline file: merge, never clobber -------------------------------

const COLUMNS = ['kind', 'handle', 'url', 'name', 'where', 'company', 'score', 'signal', 'why', 'first_seen', 'status', 'owner', 'notes'];

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ''));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function readPipeline() {
  if (!existsSync(PIPELINE)) return new Map();
  const rows = parseCsv(readFileSync(PIPELINE, 'utf8'));
  const header = rows.shift() || [];
  const out = new Map();
  for (const r of rows) {
    const rec = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    if (rec.handle) out.set(rec.handle.toLowerCase(), rec);
  }
  return out;
}

// ---- sweep 1: neighbours ---------------------------------------------------

const found = new Map();   // handle -> record
const repoHits = [];

function remember(rec) {
  const key = rec.handle.toLowerCase();
  if (STOP.has(key)) return;
  const prev = found.get(key);
  if (!prev || rec.score > prev.score) found.set(key, { ...prev, ...rec });
}

const today = new Date().toISOString().slice(0, 10);

console.log(`Scoubidou3D prospect sweep — ${TOKEN ? 'authenticated' : 'ANONYMOUS (60 req/hr, 10 searches/min)'}`);
console.log('');

const queries = cfg.queries.slice(0, MAX_QUERIES === Infinity ? cfg.queries.length : MAX_QUERIES);
console.log(`NEIGHBOURS — ${queries.length} repository ${queries.length === 1 ? 'query' : 'queries'}`);

for (const q of queries) {
  let page;
  try {
    page = await api(`/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=25`, { search: true });
  } catch (e) {
    if (e.rateLimited) { console.error('  ! out of anonymous quota — set GITHUB_TOKEN and re-run'); break; }
    throw e;
  }
  const items = page?.items || [];
  let kept = 0;
  for (const repo of items) {
    const { score, hits } = scoreRepo(repo);
    if (!hits.length || score < cfg.thresholds.repo) continue;
    kept++;
    repoHits.push({ repo, score, hits });
    remember({
      kind: repo.owner.type === 'Organization' ? 'org' : 'maintainer',
      handle: repo.owner.login,
      url: repo.owner.html_url,
      name: '',
      where: '',
      company: '',
      score,
      signal: `repo:${repo.full_name} ★${repo.stargazers_count}`,
      why: `${hits.slice(0, 4).join(', ')} — ${(repo.description || '').slice(0, 110)}`,
      first_seen: today,
      status: 'new',
      owner: '',
      notes: '',
    });
  }
  console.log(`  ${String(kept).padStart(3)} / ${String(items.length).padStart(3)}  ${q}`);
}

// ---- sweep 2: kin ----------------------------------------------------------

if (PEOPLE) {
  const kin = [...cfg.kin];
  // The best-scoring neighbours join the kin list: whoever starred the liveliest
  // weaving repo on GitHub is the same audience as whoever starred ours.
  for (const { repo } of repoHits.sort((a, b) => b.score - a.score).slice(0, cfg.thresholds.kinFromNeighbours || 0)) {
    if (!kin.includes(repo.full_name)) kin.push(repo.full_name);
  }
  console.log('');
  console.log(`KIN — stargazers and forkers of ${kin.length} repos`);

  const people = new Map();
  outer:
  for (const full of kin) {
    for (const [what, path, base] of [
      ['stargazer', `/repos/${full}/stargazers?per_page=100`, 26],
      ['forker', `/repos/${full}/forks?per_page=50`, 34],
    ]) {
      let list;
      try {
        list = await api(path);
      } catch (e) {
        if (e.rateLimited) { console.error('  ! out of anonymous quota — set GITHUB_TOKEN and re-run'); break outer; }
        throw e;
      }
      if (!list) { console.log(`  --  ${full} (not found)`); continue; }
      for (const entry of list) {
        const login = what === 'forker' ? entry.owner?.login : entry.login;
        if (!login || STOP.has(login.toLowerCase())) continue;
        const prev = people.get(login);
        if (!prev || base > prev.base) people.set(login, { base, what, full });
      }
      console.log(`  ${String(list.length).padStart(3)}  ${what}s of ${full}`);
    }
  }

  const ranked = [...people.entries()].slice(0, cfg.thresholds.profiles || 60);
  console.log(`  fetching ${ranked.length} profiles…`);
  for (const [login, prov] of ranked) {
    let user;
    try {
      user = await api(`/users/${login}`);
    } catch (e) {
      if (e.rateLimited) { console.error('  ! out of anonymous quota — profiles truncated'); break; }
      throw e;
    }
    if (!user) continue;
    const { score, boosted, hits } = scoreUser(user, prov);
    if (score < cfg.thresholds.person) continue;
    remember({
      kind: user.type === 'Organization' ? 'org' : 'person',
      handle: user.login,
      url: user.html_url,
      name: user.name || '',
      where: user.location || '',
      company: user.company || '',
      score,
      signal: `${prov.what} of ${prov.full}`,
      why: [boosted ? 'IN BOOST REGION' : '', ...hits.slice(0, 3), (user.bio || '').slice(0, 80)].filter(Boolean).join(' — '),
      first_seen: today,
      status: 'new',
      owner: '',
      notes: '',
    });
  }
} else {
  console.log('');
  console.log('KIN — skipped (pass --people; it is the sweep worth having)');
}

// ---- merge and report ------------------------------------------------------

const existing = readPipeline();
const fresh = [];
for (const [key, rec] of found) {
  const old = existing.get(key);
  if (old) {
    // A human has an opinion about this handle. Keep it, refresh only the
    // machine-owned columns, and never resurrect something already judged.
    old.score = String(rec.score);
    if (!old.signal) old.signal = rec.signal;
    if (!old.where) old.where = rec.where;
    if (!old.company) old.company = rec.company;
    if (!old.name) old.name = rec.name;
    continue;
  }
  existing.set(key, rec);
  fresh.push(rec);
}

fresh.sort((a, b) => b.score - a.score);

console.log('');
console.log(`${fresh.length} new, ${existing.size - fresh.length} already in the pipeline, ${calls} API calls`);
console.log('');
if (fresh.length) {
  const w = (s, n) => String(s).slice(0, n).padEnd(n);
  console.log(`${w('score', 6)}${w('kind', 11)}${w('handle', 24)}${w('where', 20)}why`);
  console.log('-'.repeat(110));
  for (const r of fresh.slice(0, 40)) {
    console.log(`${w(r.score, 6)}${w(r.kind, 11)}${w(r.handle, 24)}${w(r.where, 20)}${String(r.why).slice(0, 48)}`);
  }
  if (fresh.length > 40) console.log(`… and ${fresh.length - 40} more in the CSV`);
}

if (DRY) {
  console.log('');
  console.log('--dry: nothing written.');
  process.exit(0);
}

const all = [...existing.values()].sort((a, b) => {
  const rank = (s) => (s === 'new' ? 0 : s === 'contacted' ? 1 : s === 'replied' ? 2 : 3);
  return rank(a.status) - rank(b.status) || Number(b.score || 0) - Number(a.score || 0);
});
mkdirSync(dirname(PIPELINE), { recursive: true });
writeFileSync(PIPELINE, [COLUMNS.join(','), ...all.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
console.log('');
console.log(`Wrote ${PIPELINE} (${all.length} rows). Set a status on the ones you act on — this script will never overwrite it.`);
