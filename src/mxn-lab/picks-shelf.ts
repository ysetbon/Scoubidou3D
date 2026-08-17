// "What has anybody said about these parameters?" — asked once, here.
//
// A judgement is written by /mxn/fit/ to localStorage FIRST and to the
// Cloudflare shelf second (docs/picks-shelf.md), so the answer is always a fold
// of two stores rather than a fetch. The fitter asked it first; /mxn/ asks it
// too, because a ★ best is what that level's card should be showing rather than
// the engine's own pick (docs/mxn-fit.md § How a judgement is read back), and
// the k boards at /mxn/ks/<k>/ ask a wider version of it over a whole plane.
//
// Two spellings of the fold would drift, and the first symptom would be one
// page drawing a best another page had already superseded — so readPicks lives
// here, above both callers, rather than inside either.
//
// Everything below the reader is pure, and deliberately so: which judgement
// wins, which level it is about, and what a card may honestly print underneath
// it are the claims scripts/check-lab-picks.ts pins.

import {
  CACHE_VERSION, createCache, mergeJudgement, parsePicksKey, picksKey, readSetting,
  type Judgement, type PicksArtifact, type RunDescriptor,
} from "./cache";
import type { Strand } from "./exact-draw";

/** Where /mxn/fit/ holds a judgement before, and beside, any network. */
export const JUDGEMENTS_KEY = "mxn-fit-judgements";

/**
 * The search flags every fitter judgement is filed under.
 *
 * The fitter sends none, so these are the engine's defaults — and they are part
 * of the key a judgement is saved beneath, which is why a ★ best pressed at
 * /mxn/fit/ and a run swept by the farm at `s1-e5-b100000000` do not share one.
 */
export const FITTER_FLAGS = { shortArms: true, step: "auto" as const, budget: 400_000 };

/** The judgements for one parameter set, and which stores answered for them. */
export type Picks = { judgements: Judgement[]; from: string; reached: boolean };

/**
 * Every judgement anyone has made about ONE parameter set, from both stores.
 *
 * Read from the Cloudflare shelf when a Worker is configured, and either way
 * folded together with this browser's own local judgements — the local copy is
 * written first on every save, so it can hold a decision the shelf never
 * received. mergeJudgement holds the invariants while folding, so at most one
 * `best` survives and a rejected best never comes back. Neither store being
 * reachable is not an error: no page may be blocked by the database being away,
 * so an unreachable shelf reads as "no judgements there".
 */
export async function readPicks(
  d: RunDescriptor, base: string, token: string,
): Promise<Picks> {
  let artifact: PicksArtifact | null = null;
  let from = "this browser";
  let reached = !base;
  if (base) {
    try {
      artifact = await createCache({ base, token }).getPicks(d);
      reached = true;
      if (artifact) from = "Cloudflare";
    } catch { /* the shelf being away must not block the caller */ }
  }
  try {
    const key = `picks/${picksKey(d)}`;
    const rows = JSON.parse(readSetting(JUDGEMENTS_KEY) || "[]") as
      { key: string; judgement: Judgement }[];
    // Latched before the loop rather than recomputed off `from` inside it:
    // reading the previous answer back made a SECOND local judgement drop
    // "Cloudflare" from the credit, because "Cloudflare and this browser" is
    // not "Cloudflare".
    const fromShelf = from === "Cloudflare";
    for (const row of rows) {
      if (row.key !== key) continue;
      artifact = mergeJudgement(artifact, row.judgement, d);
      from = fromShelf ? "Cloudflare and this browser" : "this browser";
    }
  } catch { /* a torn local store reads as no judgements, not as an error */ }
  return { judgements: artifact?.judgements ?? [], from, reached };
}

// ---------------------------------------------------------------------------
// Which judgement, and about what.
// ---------------------------------------------------------------------------

/** Which level a judgement is about. A fit judges one level at a time. */
export function levelOf(judgement: Judgement): number {
  return judgement.levels[0]?.level ?? 1;
}

/**
 * The ★ best, if a person has named one.
 *
 * There is no middle tier and never a fallback to `valid`: either a person
 * chose, or the engine's own pick stands. A page that promoted the newest ✓
 * on its own would be inventing a verdict nobody pressed.
 */
export function bestOf(judgements: Judgement[]): Judgement | null {
  return judgements.find(judgement => judgement.verdict === "best") ?? null;
}

/** A judged ★ best as a level card needs it: the ring, the knobs, the credit. */
export type JudgedPick = {
  judgement: Judgement;
  level: number;
  strands: Strand[];
  hExt: number[];
  vExt: number[];
  hAngle: number | null;
  vAngle: number | null;
  /** Which stores answered, for the credit line. */
  from: string;
  /** The `picks/v3/…` key it was read out of. */
  key: string;
};

/**
 * A judgement, ready to draw — or null when it cannot be drawn without a run.
 *
 * `Judgement.strands` is the whole ring as it was judged, so a judgement that
 * carries one costs no Pyodide, no `generate` and no fit to put on screen.
 * Judgements saved before strands were stored carry none (`hasRing = False` in
 * docs/picks-shelf.md), and those genuinely do need the engine: they are
 * reported rather than drawn, because a card showing the engine's ring under a
 * "human pick" chip would be the one lie this whole path exists not to tell.
 */
export function pickOfJudgement(
  judgement: Judgement, from: string, key: string,
): JudgedPick | null {
  const strands = judgement.strands as Strand[] | undefined;
  if (!Array.isArray(strands) || !strands.length) return null;
  const level = levelOf(judgement);
  const bands = judgement.levels.find(entry => entry.level === level);
  return {
    judgement, level, strands, from, key,
    hExt: bands?.h?.ext ?? [],
    vExt: bands?.v?.ext ?? [],
    hAngle: bands?.h?.angle ?? null,
    vAngle: bands?.v?.angle ?? null,
  };
}

// ---------------------------------------------------------------------------
// What a card may honestly print under whichever ring is on it.
// ---------------------------------------------------------------------------

/**
 * The numbers under a diagram, with `null` where the ring's source did not
 * carry one.
 *
 * A run's audit row has all of them; a judgement carries four — crossings,
 * expected, stray, broken — plus the extensions it was fitted at, and nothing
 * about gaps, `within` or masks. Those come back as null and print as an em
 * dash, because a zero nobody measured reads exactly like a zero somebody did,
 * and this page's whole claim is that its numbers describe the ring on screen.
 */
export type CardAudit = {
  across: number | null;
  expected: number | null;
  ext: [number[], number[]] | null;
  gap: [number, number] | null;
  within: number | null;
  masks: number | null;
  stray: number | null;
  broken: number | null;
  applied: string[] | null;
};

export function auditOfPick(pick: JudgedPick): CardAudit {
  const audit = pick.judgement.audit;
  return {
    across: audit?.crossings ?? null,
    expected: audit?.expected ?? null,
    ext: [pick.hExt, pick.vExt],
    gap: null,
    within: null,
    masks: null,
    stray: audit?.stray ?? null,
    broken: audit?.broken ?? null,
    applied: null,
  };
}

/**
 * How far a judged ring reaches: its largest pair extension, either band.
 *
 * The one number a hand-fitted pick can hand a search. Its extensions cannot be
 * searched FOR — 3×1 k=−1 was judged at `(62.55)` and `(55.75, 57.3, 27.5)`,
 * and no grid contains those — but they say where the answer lives, and the
 * 70→200 the engine walks past them is the expensive part of every level.
 *
 * Null when the pick carries no extensions at all, which is a judgement saved
 * before the bands were stored: nothing to learn, so nothing is claimed.
 */
export function reachOfPick(pick: JudgedPick): number | null {
  const values = [...pick.hExt, ...pick.vExt].filter(v => Number.isFinite(v));
  const reach = Math.max(0, ...values);
  return reach > 0 ? reach : null;
}

// ---------------------------------------------------------------------------
// Finding the parameter set the judgements are actually under.
// ---------------------------------------------------------------------------

/**
 * Every parameter set worth asking about for one m/n/ks, nearest first.
 *
 * The step and the budget are part of a run's identity, and rightly so: a sweep
 * at step 5 is a different search from one at auto. A judgement is not a search
 * — it is a ring somebody placed by hand and a verdict they pressed on it — so
 * the flags in its key say only which run was on screen when they pressed it.
 * The farm sweeps at `s1-e5-b100000000` and the fitter always writes
 * `s1-eauto-b400000`, so requiring an exact flags match would mean a lab
 * showing a farm run could never show the ★ best judged for that very size.
 *
 * Order is what keeps that honest: the run's own flags first, then the fitter's
 * canonical ones, then anything else the shelf or this browser holds for the
 * same size, hand, direction and ks. The first set with a ★ best wins, so an
 * exact match is never passed over for a looser one.
 */
export function picksCandidates(
  want: RunDescriptor, keys: string[],
): RunDescriptor[] {
  const seen = new Set<string>();
  const out: RunDescriptor[] = [];
  const add = (d: RunDescriptor) => {
    const key = picksKey(d);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };
  add(want);
  add({ ...want, ...FITTER_FLAGS });
  const sameRing = (d: RunDescriptor) =>
    d.m === want.m && d.n === want.n && d.hand === want.hand
    && d.direction === want.direction
    && d.ks.length === want.ks.length
    && d.ks.every((k, at) => k === want.ks[at]);
  for (const key of keys) {
    const parsed = parsePicksKey(key);
    if (!parsed || parsed.cacheVersion !== CACHE_VERSION) continue;
    if (sameRing(parsed.descriptor)) add(parsed.descriptor);
  }
  return out;
}

/** The catalogue prefix that lists every flags-variant of one size's picks. */
export function picksPrefix(d: RunDescriptor): string {
  const ks = d.ks.map(k => String(Math.trunc(k))).join("_");
  return `picks/${CACHE_VERSION}/${d.hand}-${d.direction}/${d.m}x${d.n}/${ks}/`;
}

/** What a lab card ended up with, and what it cost to find out. */
export type ShelfBest = {
  pick: JudgedPick | null;
  /** A best exists but carries no ring, so only the engine can draw it. */
  ringless: Judgement | null;
  /** How many parameter sets were asked about. */
  searched: number;
};

/** The most parameter sets a single card's lookup will fetch before giving up. */
const CANDIDATE_LIMIT = 4;

/**
 * The ★ best for a run, found without waking the engine.
 *
 * One GET in the ordinary case — the run's own key — and a catalogue listing
 * plus at most CANDIDATE_LIMIT more only when that missed, which is the case
 * where the run came off the farm's flags and the judgement off the fitter's.
 * `alive` stops the walk when the parameters have moved on under it.
 */
export async function findShelfBest(
  want: RunDescriptor, base: string, token: string, alive: () => boolean,
): Promise<ShelfBest> {
  let searched = 0;
  const ask = async (d: RunDescriptor): Promise<ShelfBest | null> => {
    searched += 1;
    const picks = await readPicks(d, base, token);
    const best = bestOf(picks.judgements);
    if (!best) return null;
    const key = `picks/${picksKey(d)}`;
    const pick = pickOfJudgement(best, picks.from, key);
    return { pick, ringless: pick ? null : best, searched };
  };

  const first = await ask(want);
  if (first) return first;
  if (!alive()) return { pick: null, ringless: null, searched };

  // Every other set the same size, hand, direction and ks has been judged
  // under: the shelf's own listing, plus this browser's local rows, since a
  // judgement made with no Worker configured exists nowhere else.
  let keys: string[] = [];
  if (base) {
    try {
      const entries = await createCache({ base, token })
        .catalogue(picksPrefix(want), 50);
      keys = entries.map(entry => entry.key);
    } catch { /* no catalogue is the same as an empty one */ }
  }
  try {
    const rows = JSON.parse(readSetting(JUDGEMENTS_KEY) || "[]") as { key: string }[];
    keys = keys.concat(rows.map(row => row.key));
  } catch { /* a torn local store contributes no keys */ }

  const rest = picksCandidates(want, keys)
    .filter(d => picksKey(d) !== picksKey(want))
    .slice(0, CANDIDATE_LIMIT);
  for (const d of rest) {
    if (!alive()) break;
    try {
      const found = await ask(d);
      if (found) return found;
    } catch { /* one unreadable artifact must not end the search */ }
  }
  return { pick: null, ringless: null, searched };
}
