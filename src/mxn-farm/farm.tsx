"use client";

// The compute farm at /mxn/gpu/.
//
// The lab computes in the reader's browser, which is what lets it live on a
// static host and is also why a 3×3 costs twenty seconds of blank page and a
// level widget costs a replay plus two sweeps. This page does that work ahead
// of time, over a whole range of sizes, on a machine that can be left running,
// and puts every answer on the Cloudflare Worker. /mxn/ then reads them back.
//
// Nothing here is a new calculation. It is the same bridge.py, the same
// generate, the same census — driven headlessly, many at once, and uploaded.
// The point of it is entirely that a browser tab is a bad place to wait eight
// hours and an excellent place to read the results of having waited.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  CACHE_TOKEN_KEY, CACHE_URL_KEY, CACHE_VERSION,
  createCache, parseRunKey, readCacheBase, readSetting, runKey, traceKeyPath,
  writeSetting,
  type RunDescriptor,
} from "../mxn-lab/cache";
import { DEFAULT_COMBO_BUDGET } from "../mxn-lab/search-cost";
import {
  MAX_JOBS, MAX_LEVELS, MAX_SIDE, kLimits, labSearch, planSweep, specFromSearch,
  type KsMode, type PlanJob, type SweepSpec,
} from "./plan";

const FARM_BASE = `${import.meta.env.BASE_URL}mxn/`;
const SPEC_KEY = "mxn-farm-spec";
const BATCH_KEY = "mxn-farm-batch";

/** How long a claimed job is held before another machine may take it. */
const LEASE_SECONDS = 3600;
/** How long a hand waits before asking an empty queue again. */
const IDLE_POLL_MS = 20_000;
/** How often the queue's own numbers are refreshed while a sweep runs. */
const SUMMARY_POLL_MS = 8_000;
/** Lines kept in the log. Enough to see a whole job, not enough to leak. */
const LOG_LINES = 400;

const DEFAULT_SPEC: SweepSpec = {
  mFrom: 1, mTo: 2,
  nFrom: 1, nTo: 2,
  ksMode: "each",
  // Every k every size admits, rather than one range that can only be right
  // for one of them: the band is narrower on the diagonal than off it, so a
  // sweep over sizes wants a band per size.
  kFollowsSize: true,
  kFrom: -1, kTo: 2,
  // Off, like the lab's own default: a sweep stores what the engine ships
  // unless somebody asks for the other search.
  reachFromPrevious: false,
  depth: 1,
  ksText: "1\n1 1 -1\n-1 -1",
  hand: "lh",
  direction: "cw",
  shortArms: true,
  step: "auto",
  budget: DEFAULT_COMBO_BUDGET,
  wantTraces: true,
  countCeiling: 1_000_000,
  fastEngine: true,
};

type HandStatus = "off" | "warming" | "idle" | "claiming" | "working" | "storing" | "error";

type Hand = {
  id: number;
  status: HandStatus;
  message: string;
  job: string | null;
  fraction: number | null;
  done: number;
  failed: number;
};

type QueueRow = {
  id: string;
  batch: string;
  m: number; n: number; ks: string;
  levels: number; weight: number; state: string;
  runner: string | null; attempts: number;
  seconds: number | null; bytes: number | null; artifacts: number | null;
  error: string | null; finished_at: string | null;
};

type SummaryRow = {
  batch: string; state: string; jobs: number;
  seconds: number; bytes: number; artifacts: number;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function readSpec(): SweepSpec {
  let stored = DEFAULT_SPEC;
  try {
    const held = JSON.parse(readSetting(SPEC_KEY) || "null");
    if (held) stored = { ...DEFAULT_SPEC, ...held };
  } catch {
    /* keep the default rather than crash the console on a bad save */
  }
  const asked = specFromSearch(window.location.search);
  return asked ? { ...stored, ...asked } : stored;
}

/** A k with a typographic minus, so a band reads as prose beside one. */
const signed = (value: number) => String(value).replace("-", "−");

function bytesLabel(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clockLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${Math.floor(seconds % 60)}s`;
  return `${Math.round(seconds)}s`;
}

/** A queue row, back in the shape the planner and the worker speak. */
function jobFromRow(row: QueueRow, spec: SweepSpec): PlanJob {
  const ks: number[] = JSON.parse(row.ks);
  const raw = row as unknown as Record<string, unknown>;
  const step = raw.ext_step === "auto" ? "auto" as const : Number(raw.ext_step);
  const descriptor: RunDescriptor = {
    m: row.m, n: row.n, ks,
    hand: String(raw.hand ?? "lh"), direction: String(raw.direction ?? "cw"),
    shortArms: Number(raw.short_arms) !== 0,
    step, budget: Number(raw.combo_budget) || DEFAULT_COMBO_BUDGET,
    // Off the row's ID rather than a column of its own: a job's id IS its cache
    // key, so the reach cap is already in there and reading it back needs no
    // migration on a queue an operator is mid-sweep through. A column would
    // also be a second place for it to disagree with the key it is stored at.
    reachFromPrevious: !!parseRunKey(row.id)?.descriptor.reachFromPrevious,
  };
  return {
    id: row.id, descriptor,
    m: row.m, n: row.n, ks,
    hand: descriptor.hand, direction: descriptor.direction,
    shortArms: descriptor.shortArms, step, budget: descriptor.budget,
    reachFromPrevious: !!descriptor.reachFromPrevious,
    weight: row.weight,
    wantTraces: Number(raw.want_traces) !== 0,
    // Runner policy rather than part of the answer's identity: how patient THIS
    // machine is about counting, and which angle scan it uses, are settings of
    // the machine doing the work and not of the parameter set being worked.
    countCeiling: spec.countCeiling,
    fastEngine: spec.fastEngine,
  };
}

/**
 * One request/reply exchange with a hand, with its progress relayed.
 *
 * The `error` listener is not belt and braces. farm-worker.js imports Pyodide
 * from jsDelivr at module scope, so a network that cannot reach jsDelivr fails
 * the worker before it has read a single message — it fires an `error` event
 * and then answers nothing, for ever. Without this the hand would sit on
 * "loading the engine…" until the tab was closed, which is the worst way to
 * spend a night that was meant to be computing.
 */
function driveHand(
  worker: Worker,
  message: unknown,
  onProgress: (payload: { message?: string; fraction?: number | null; phase?: string }) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const done = (settle: () => void) => {
      worker.removeEventListener("message", listener);
      worker.removeEventListener("error", failed);
      settle();
    };
    const listener = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.type === "job-progress") { onProgress(data); return; }
      done(() => {
        if (data.type === "job-done" || data.type === "warm-ready") resolve(data);
        else reject(new Error(data.message || "the hand stopped without saying why"));
      });
    };
    const failed = (event: ErrorEvent) => done(() => reject(new Error(
      event.message || "the hand could not start — is the engine reachable?")));
    worker.addEventListener("message", listener);
    worker.addEventListener("error", failed);
    worker.postMessage(message);
  });
}

export function ComputeFarm() {
  const [spec, setSpec] = useState<SweepSpec>(readSpec);
  const [batch, setBatch] = useState(() => readSetting(BATCH_KEY) || "sweep-1");
  const [apiUrl, setApiUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const cores = typeof navigator === "undefined" ? 4 : (navigator.hardwareConcurrency || 4);
  const [hands, setHands] = useState(() => Math.max(1, Math.min(4, cores - 1)));
  const [handState, setHandState] = useState<Hand[]>([]);
  const [running, setRunning] = useState(false);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [skipExisting, setSkipExisting] = useState(true);
  // On by default: it is the same geometry for fewer seconds. What it costs is
  // level 1's solution browser IN THIS ARTIFACT, and that enumeration is not
  // lost from the shelf — the single-k run it was replayed from has it in full.
  const [replayL1, setReplayL1] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const runningRef = useRef(false);
  const workersRef = useRef<Worker[]>([]);
  const specRef = useRef(spec);
  const skipRef = useRef(skipExisting);
  const batchRef = useRef(batch);
  const startedAtRef = useRef<number | null>(null);
  const doneAtStartRef = useRef(0);
  specRef.current = spec;
  skipRef.current = skipExisting;
  const replayL1Ref = useRef(replayL1);
  replayL1Ref.current = replayL1;
  batchRef.current = batch;

  const plan = useMemo(() => planSweep(spec), [spec]);

  // The band each size in the sweep admits, spelled out — the whole reason a
  // sweep wants a band per size is that these differ, and a reader who cannot
  // see them differing has to take the planner's word for it.
  const bands = useMemo(() => {
    const sizes: { m: number; n: number; min: number; max: number }[] = [];
    const lo = (a: number, b: number) => Math.max(1, Math.min(MAX_SIDE, Math.min(a, b)));
    const hi = (a: number, b: number) => Math.max(1, Math.min(MAX_SIDE, Math.max(a, b)));
    for (let m = lo(spec.mFrom, spec.mTo); m <= hi(spec.mFrom, spec.mTo); m += 1) {
      for (let n = lo(spec.nFrom, spec.nTo); n <= hi(spec.nFrom, spec.nTo); n += 1) {
        sizes.push({ m, n, ...kLimits(m, n) });
      }
    }
    return sizes;
  }, [spec.mFrom, spec.mTo, spec.nFrom, spec.nTo]);

  const cache = useMemo(
    () => createCache({ base: apiUrl, token: apiToken, hostId: "farm" }),
    [apiUrl, apiToken]);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const say = (line: string) => setLog(current => {
    const stamp = new Date().toLocaleTimeString();
    return [`${stamp}  ${line}`, ...current].slice(0, LOG_LINES);
  });

  const patchSpec = (patch: Partial<SweepSpec>) => setSpec(current => {
    const next = { ...current, ...patch };
    writeSetting(SPEC_KEY, JSON.stringify(next));
    return next;
  });

  const setHand = (id: number, patch: Partial<Hand>) => setHandState(current =>
    current.map(hand => hand.id === id ? { ...hand, ...patch } : hand));

  useEffect(() => {
    setApiUrl(readCacheBase("farm"));
    setApiToken(readSetting(CACHE_TOKEN_KEY));
    return () => {
      runningRef.current = false;
      workersRef.current.forEach(worker => worker.terminate());
    };
  }, []);

  // ---- the Worker on the other end -------------------------------------

  const checkHealth = async () => {
    setHealthError(null);
    try {
      const body = await cacheRef.current.health();
      setHealth(body);
      if (!body.ok) setHealthError("the Worker answered, but not with ok:true");
    } catch (error) {
      setHealth(null);
      setHealthError(error instanceof Error ? error.message : String(error));
    }
  };

  const request = async (path: string, init?: RequestInit) => {
    const base = cacheRef.current.base;
    if (!base) throw new Error("set the worker URL first");
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cacheRef.current.token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
  };

  const refreshQueue = async () => {
    try {
      const [jobs, totals] = await Promise.all([
        request(`/farm/jobs?batch=${encodeURIComponent(batchRef.current)}&limit=400`),
        request(`/farm/summary?batch=${encodeURIComponent(batchRef.current)}`),
      ]);
      setQueue((jobs.jobs as QueueRow[]) ?? []);
      setSummary((totals.summary as SummaryRow[]) ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(refreshQueue, SUMMARY_POLL_MS);
    return () => window.clearInterval(id);
    // refreshQueue reads its inputs from refs, so it does not need to be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // ---- pushing a plan ---------------------------------------------------

  const pushPlan = async () => {
    if (!plan.jobs.length) { setNotice("the plan is empty"); return; }
    setNotice(null);
    writeSetting(BATCH_KEY, batch);
    try {
      let pushed = 0;
      for (let at = 0; at < plan.jobs.length; at += 200) {
        const slice = plan.jobs.slice(at, at + 200);
        await request("/farm/jobs", {
          method: "POST",
          body: JSON.stringify({
            batch,
            jobs: slice.map(job => ({
              id: job.id, m: job.m, n: job.n, ks: job.ks,
              hand: job.hand, direction: job.direction,
              shortArms: job.shortArms, step: job.step, budget: job.budget,
              weight: job.weight, wantTraces: job.wantTraces,
            })),
          }),
        });
        pushed += slice.length;
        say(`queued ${pushed} / ${plan.jobs.length}`);
      }
      say(`plan pushed to batch “${batch}” — ${plan.jobs.length} parameter sets`);
      await refreshQueue();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  // ---- one hand's whole life -------------------------------------------

  /**
   * Which artifacts this job still owes.
   *
   * A run whose census failed halfway leaves the run stored and some bands not,
   * and recomputing the censuses still needs the generate — it is what builds
   * the session a census replays from. So the run is always computed and only
   * its *upload* is skipped; the bands already on the shelf are skipped whole,
   * which is where the hours are.
   */
  /**
   * Level 1's extensions off a stored single-k run, when there is one.
   *
   * Level 1 depends on nothing but (m, n, ks[0], hand, direction) and the
   * search flags, so the L1 of `[-1, -1, -1]` IS the L1 of the stored `[-1]`
   * run — verified bit-for-bit, ring hash and every audit number, on 3×1, 2×1
   * and 2×2. Replaying it instead of searching for it again took 3×1
   * `[-1,-1,-1]` from 170.5s to 134.7s.
   *
   * A miss is the ordinary state and costs one HEAD-shaped GET. Nothing here
   * can fail a job: an unreachable shelf simply means the level is searched,
   * which is what every run did before this existed.
   */
  const level1For = async (job: PlanJob): Promise<number[][] | null> => {
    if (job.ks.length < 2 || !replayL1Ref.current) return null;
    try {
      const stored = await cacheRef.current.getRun(
        { ...job.descriptor, ks: [job.ks[0]] });
      const ext = (stored?.result as { rows?: { ext: number[][] }[] } | undefined)
        ?.rows?.[0]?.ext;
      return Array.isArray(ext) && ext.length === 2 ? ext : null;
    } catch {
      return null;
    }
  };

  const missingFor = async (job: PlanJob) => {
    const client = cacheRef.current;
    const traces: Record<string, string> = {};
    let runUrl: string | null = `${client.base}/cache/run/${runKey(job.descriptor)}`;
    if (skipRef.current && await client.hasRun(job.descriptor)) runUrl = null;
    if (job.wantTraces) {
      for (let level = 1; level <= job.ks.length; level += 1) {
        for (const band of ["h", "v"] as const) {
          if (skipRef.current && await client.hasTrace(job.descriptor, level, band)) continue;
          traces[`${level}:${band}`] =
            `${client.base}/cache/trace/${traceKeyPath(job.descriptor, level, band)}`;
        }
      }
    }
    return { runUrl, traces };
  };

  const spawnHand = () => {
    const worker = new Worker(
      new URL(`${FARM_BASE}farm-worker.js?v=trace-plan-v24`, window.location.href),
      { type: "module" });
    workersRef.current.push(worker);
    return worker;
  };

  const retireHand = (worker: Worker) => {
    worker.terminate();
    workersRef.current = workersRef.current.filter(held => held !== worker);
  };

  const handLoop = async (id: number) => {
    let worker = spawnHand();
    let warm = false;
    let warmFailures = 0;
    // A bad parameter set fails one job. A broken runtime fails every job it is
    // handed, instantly, for as long as the queue has work — which would burn a
    // whole batch to `failed` in about a minute. Two in a row is the signal to
    // stop believing the runtime and build a new one.
    let inARow = 0;

    while (runningRef.current) {
      // Warming is inside the loop rather than before it: Pyodide and NumPy are
      // fetched from a CDN, and a sweep started the moment a laptop woke up
      // should not lose a hand for the night to one failed download.
      if (!warm) {
        setHand(id, { status: "warming", message: "loading Pyodide and the engine…", job: null });
        try {
          await driveHand(worker, { type: "warm", hand: id, fastEngine: specRef.current.fastEngine },
            payload => setHand(id, { message: payload.message ?? "" }));
          warm = true;
          warmFailures = 0;
        } catch (error) {
          warmFailures += 1;
          const message = error instanceof Error ? error.message : String(error);
          say(`hand ${id} could not start: ${message}`);
          if (warmFailures >= 3) {
            setHand(id, { status: "error", message: `${message} — gave up after three tries` });
            break;
          }
          setHand(id, { status: "error", message: `${message} — trying again` });
          await sleep(IDLE_POLL_MS);
          continue;
        }
      }

      setHand(id, { status: "claiming", message: "asking the queue for work", job: null, fraction: null });
      let row: QueueRow | null = null;
      try {
        const reply = await request("/farm/claim", {
          method: "POST",
          body: JSON.stringify({
            runner: `hand-${id}`, lease: LEASE_SECONDS, batch: batchRef.current,
          }),
        });
        row = (reply.job as QueueRow) ?? null;
      } catch (error) {
        setHand(id, { status: "error", message: error instanceof Error ? error.message : String(error) });
        await sleep(IDLE_POLL_MS);
        continue;
      }

      if (!row) {
        setHand(id, { status: "idle", message: "queue empty — waiting for work" });
        await sleep(IDLE_POLL_MS);
        continue;
      }

      const job = jobFromRow(row, specRef.current);
      const label = `${job.m}×${job.n} ks ${job.ks.join(" ")}`;
      setHand(id, { status: "working", message: `${label} — checking the shelf`, job: label, fraction: null });

      const startedAt = performance.now();
      try {
        const { runUrl, traces } = await missingFor(job);
        if (!runUrl && !Object.keys(traces).length) {
          await request("/farm/jobs", {
            method: "PATCH",
            body: JSON.stringify({ id: job.id, state: "done", seconds: 0, bytes: 0, artifacts: 0 }),
          });
          say(`${label} — already stored, skipped`);
          setHandState(current => current.map(hand =>
            hand.id === id ? { ...hand, done: hand.done + 1 } : hand));
          continue;
        }

        // One log line per phase the hand enters, so the log shows a hand is
        // alive mid-job — a heavy level search is minutes of silence otherwise.
        // "stored" is left out (the job-end line already sums the artifacts up)
        // but still advances the marker, so each census band logs its start.
        let loggedPhase: string | null = null;
        const level1Extensions = await level1For(job);
        if (level1Extensions) {
          say(`${label} — L1 replayed off the stored ks ${job.ks[0]} run`);
        }
        const summaryReply = await driveHand(worker, {
          type: "job", hand: id,
          job: { ...job, descriptor: job.descriptor, level1Extensions },
          upload: {
            run: runUrl, traces,
            token: cacheRef.current.token,
            cacheVersion: CACHE_VERSION,
            runner: `hand-${id}`,
          },
        }, payload => {
          if (payload.phase && payload.phase !== loggedPhase) {
            if (payload.phase !== "stored") say(`hand ${id} · ${payload.message ?? payload.phase}`);
            loggedPhase = payload.phase;
          }
          setHand(id, {
            message: `${label} — ${payload.message ?? ""}`,
            fraction: payload.fraction ?? null,
            status: payload.phase === "stored" ? "storing" : "working",
          });
        });

        await request("/farm/jobs", {
          method: "PATCH",
          body: JSON.stringify({
            id: job.id, state: "done",
            seconds: summaryReply.seconds, bytes: summaryReply.bytes,
            artifacts: summaryReply.artifacts,
          }),
        });
        const weaves = (summaryReply.rows as { healthy: boolean }[] ?? [])
          .filter(row_ => row_.healthy).length;
        say(`${label} — ${Number(summaryReply.seconds).toFixed(1)}s · `
          + `${summaryReply.artifacts} artifacts · ${bytesLabel(Number(summaryReply.bytes))} · `
          + `${weaves}/${job.ks.length} levels weave`);
        inARow = 0;
        setHandState(current => current.map(hand =>
          hand.id === id ? { ...hand, done: hand.done + 1 } : hand));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        inARow += 1;
        say(`${label} — FAILED: ${message}`);
        setHandState(current => current.map(hand =>
          hand.id === id ? { ...hand, failed: hand.failed + 1 } : hand));
        try {
          await request("/farm/jobs", {
            method: "PATCH",
            body: JSON.stringify({
              id: job.id, state: "failed", error: message,
              seconds: (performance.now() - startedAt) / 1000,
            }),
          });
        } catch {
          // The report failing is not worth losing the hand over: the lease
          // expires and the job comes back on its own.
        }
        if (inARow >= 2) {
          say(`hand ${id}: two failures in a row — rebuilding the engine`);
          retireHand(worker);
          worker = spawnHand();
          warm = false;
          inARow = 0;
        }
      }
    }
    retireHand(worker);
    setHand(id, { status: "off", message: "stopped", job: null, fraction: null });
    // The last hand out turns the lights off. Without this a page whose hands
    // all died would go on saying it had four of them working.
    if (!workersRef.current.length && runningRef.current) {
      runningRef.current = false;
      setRunning(false);
      say("every hand has stopped");
    }
  };

  const start = async () => {
    if (runningRef.current) return;
    if (!cacheRef.current.base || !cacheRef.current.token) {
      setNotice("a worker URL and an admin token are both needed before anything can be stored");
      return;
    }
    setNotice(null);
    const doneNow = summary.filter(row => row.state === "done")
      .reduce((sum, row) => sum + row.jobs, 0);
    doneAtStartRef.current = doneNow;
    startedAtRef.current = performance.now();
    runningRef.current = true;
    setRunning(true);
    setHandState(Array.from({ length: hands }, (_, at) => ({
      id: at + 1, status: "warming" as HandStatus, message: "starting…",
      job: null, fraction: null, done: 0, failed: 0,
    })));
    say(`starting ${hands} hand${hands === 1 ? "" : "s"} on batch “${batch}”`);
    workersRef.current = [];
    // Each hand runs its own claim loop rather than a shared scheduler: the
    // queue IS the scheduler, and it is the thing that already survives a tab
    // being closed. Nothing here needs to know what the others are doing.
    for (let at = 1; at <= hands; at += 1) void handLoop(at);
    await refreshQueue();
  };

  /** Let the hands finish what they hold, then stop claiming. */
  const pause = () => {
    runningRef.current = false;
    setRunning(false);
    say("pausing — hands will stop after the job they are on");
  };

  /** Kill the hands now. The leases expire and the jobs come back by themselves. */
  const stop = () => {
    runningRef.current = false;
    setRunning(false);
    workersRef.current.forEach(worker => worker.terminate());
    workersRef.current = [];
    setHandState(current => current.map(hand => ({
      ...hand, status: "off" as HandStatus, message: "terminated", job: null, fraction: null,
    })));
    say("stopped — anything mid-flight returns to the queue when its lease expires");
  };

  const requeue = async (which: "failed" | "running" | "all") => {
    try {
      const reply = await request("/farm/requeue", {
        method: "POST", body: JSON.stringify({ batch, which }),
      });
      say(`requeued ${reply.requeued} ${which} job${reply.requeued === 1 ? "" : "s"}`);
      await refreshQueue();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  // ---- what the numbers say --------------------------------------------

  const totals = useMemo(() => {
    const byState: Record<string, SummaryRow> = {};
    for (const row of summary) {
      const held = byState[row.state] ?? { ...row, jobs: 0, seconds: 0, bytes: 0, artifacts: 0 };
      byState[row.state] = {
        ...held, jobs: held.jobs + row.jobs, seconds: held.seconds + row.seconds,
        bytes: held.bytes + row.bytes, artifacts: held.artifacts + row.artifacts,
      };
    }
    const count = (state: string) => byState[state]?.jobs ?? 0;
    const all = ["pending", "running", "done", "failed"].reduce((sum, state) => sum + count(state), 0);
    const done = count("done");
    const elapsed = startedAtRef.current ? (performance.now() - startedAtRef.current) / 1000 : 0;
    const finishedHere = Math.max(0, done - doneAtStartRef.current);
    // Rate from THIS session's own finished jobs, not from the batch total: a
    // resumed batch would otherwise divide yesterday's work by today's minutes
    // and report an ETA of nothing left to do.
    const perJob = finishedHere > 0 ? elapsed / finishedHere : 0;
    return {
      all, done, pending: count("pending"), running: count("running"), failed: count("failed"),
      bytes: byState.done?.bytes ?? 0,
      artifacts: byState.done?.artifacts ?? 0,
      engineSeconds: byState.done?.seconds ?? 0,
      elapsed, perJob,
      eta: perJob > 0 ? perJob * (count("pending") + count("running")) / Math.max(1, hands) : 0,
    };
  }, [summary, hands]);

  const configured = !!cache.base && !!cache.token;

  return (
    <main className="farm">
      <header className="farm-top">
        <a className="farm-brand" href="..">
          <span className="farm-mark">MXN</span>
          <b>Compute farm</b>
          <i>PRECOMPUTE · STORE · SERVE</i>
        </a>
        <div className="farm-top-right">
          <span className={`farm-dot ${running ? "is-on" : ""}`} />
          {running ? `${hands} hand${hands === 1 ? "" : "s"} working` : "idle"}
        </div>
      </header>

      <p className="farm-lede">
        Give it a range of sizes — and every k those sizes admit, or a range of
        k you type — and it works through every parameter set it makes: the
        whole run, every level&rsquo;s solution
        count walked to exact, and both bands of every level censused — storing
        each answer on your Cloudflare Worker as it goes. <a href="../">The lab</a>{" "}
        then reads them back instead of computing them, so a size that costs
        twenty seconds of blank page here costs one fetch there.
        {" "}The queue lives on the Worker, so this tab can be closed and reopened,
        and a second machine pointed at the same batch simply takes the next job.
      </p>

      <section className="farm-grid">
        <div className="farm-col">
          <div className="farm-panel">
            <h2>1 · Where it stores</h2>
            <label className="farm-field">
              <span>worker url</span>
              <input type="url" placeholder="https://mxn-solutions-api.….workers.dev"
                value={apiUrl}
                onChange={event => {
                  setApiUrl(event.target.value.trim());
                  writeSetting(CACHE_URL_KEY, event.target.value.trim());
                }} />
            </label>
            <label className="farm-field">
              <span>admin token</span>
              <input type="password" placeholder="ADMIN_TOKEN" value={apiToken}
                onChange={event => {
                  setApiToken(event.target.value.trim());
                  writeSetting(CACHE_TOKEN_KEY, event.target.value.trim());
                }} />
            </label>
            <p className="farm-note">
              The same two fields the lab&rsquo;s sidebar writes, in the same
              browser storage and nowhere else. The token is a Worker secret on
              the other end (<code>wrangler secret put ADMIN_TOKEN</code>) and is
              never in the repository.
            </p>
            <div className="farm-row">
              <button type="button" className="farm-ghost" onClick={checkHealth}>
                Check the Worker
              </button>
              {health && (
                <span className="farm-health">
                  ok · {String(health.solutions)} rated rows · artifacts in{" "}
                  <b>{String(health.artifactStore).toUpperCase()}</b>
                  {health.publicCacheReads === false ? " · reads token-gated" : " · reads public"}
                </span>
              )}
              {healthError && <span className="farm-bad">{healthError}</span>}
            </div>
            {health?.artifactStore === "d1" && (
              <p className="farm-note">
                No R2 bucket is bound, so artifacts live in D1 and anything over
                1.4&nbsp;MB is refused. Nothing the lab will run comes close —
                a 3×3 census is 3.1&nbsp;MB of JSON and 48&nbsp;kB stored — so
                this is a note rather than a warning. <code>worker-api/wrangler.toml</code>{" "}
                has the bucket if the shelf ever outgrows the database.
              </p>
            )}
          </div>

          <div className="farm-panel">
            <h2>2 · What to compute</h2>
            <div className="farm-pair">
              <label className="farm-field">
                <span>m from</span>
                <input type="number" min={1} max={MAX_SIDE} value={spec.mFrom}
                  onChange={e => patchSpec({ mFrom: Number(e.target.value) })} />
              </label>
              <label className="farm-field">
                <span>m to</span>
                <input type="number" min={1} max={MAX_SIDE} value={spec.mTo}
                  onChange={e => patchSpec({ mTo: Number(e.target.value) })} />
              </label>
            </div>
            <div className="farm-pair">
              <label className="farm-field">
                <span>n from</span>
                <input type="number" min={1} max={MAX_SIDE} value={spec.nFrom}
                  onChange={e => patchSpec({ nFrom: Number(e.target.value) })} />
              </label>
              <label className="farm-field">
                <span>n to</span>
                <input type="number" min={1} max={MAX_SIDE} value={spec.nTo}
                  onChange={e => patchSpec({ nTo: Number(e.target.value) })} />
              </label>
            </div>

            <div className="farm-modes" role="group" aria-label="How the k sequences are made">
              {([
                ["each", "one k, held", "one sequence per k in the range, that k at every level"],
                ["words", "every sequence", "every ordered sequence of that depth over the range"],
                ["list", "typed out", "the sequences below, applied to every size"],
              ] as [KsMode, string, string][]).map(([mode, label, hint]) => (
                <button key={mode} type="button" title={hint}
                  className={spec.ksMode === mode ? "is-on" : ""}
                  aria-pressed={spec.ksMode === mode}
                  onClick={() => patchSpec({ ksMode: mode })}>{label}</button>
              ))}
            </div>

            {spec.ksMode === "list" ? (
              <label className="farm-field">
                <span>k sequences · one per line</span>
                <textarea rows={5} value={spec.ksText} spellCheck={false}
                  onChange={e => patchSpec({ ksText: e.target.value })} />
              </label>
            ) : (
              <>
                <div className="farm-modes" role="group" aria-label="Which k values each size draws from">
                  {([
                    [true, "the size’s own band", "every k that size admits, which is a different band at each size"],
                    [false, "a range I type", "one range of k for the whole sweep, narrowed to each size's band"],
                  ] as [boolean, string, string][]).map(([follows, label, hint]) => (
                    <button key={String(follows)} type="button" title={hint}
                      className={spec.kFollowsSize === follows ? "is-on" : ""}
                      aria-pressed={spec.kFollowsSize === follows}
                      onClick={() => patchSpec({ kFollowsSize: follows })}>{label}</button>
                  ))}
                </div>
                {!spec.kFollowsSize && (
                  <div className="farm-pair">
                    <label className="farm-field">
                      <span>k from</span>
                      <input type="number" value={spec.kFrom}
                        onChange={e => patchSpec({ kFrom: Number(e.target.value) })} />
                    </label>
                    <label className="farm-field">
                      <span>k to</span>
                      <input type="number" value={spec.kTo}
                        onChange={e => patchSpec({ kTo: Number(e.target.value) })} />
                    </label>
                  </div>
                )}
                <label className="farm-field">
                  <span>levels deep · 1…{MAX_LEVELS}</span>
                  <input type="number" min={1} max={MAX_LEVELS} value={spec.depth}
                    onChange={e => patchSpec({ depth: Number(e.target.value) })} />
                </label>
                <p className="farm-bands">
                  {bands.map(band => (
                    <span key={`${band.m}x${band.n}`}>
                      <b>{band.m}×{band.n}</b> {signed(band.min)}…{signed(band.max)}
                    </span>
                  ))}
                </p>
              </>
            )}
            <p className="farm-note">
              {spec.ksMode !== "list" && spec.kFollowsSize ? (
                <>
                  Each size sweeps the whole band it admits: −(m+n−1)…m+n, and
                  the narrower −(m−1)…m when m = n. So <code>2×1</code> takes
                  −2…3 while <code>2×2</code> takes −1…2, in one plan, and no k
                  is dropped for being out of range.
                </>
              ) : (
                <>
                  A k outside a size&rsquo;s own valid range is not queued — the
                  band narrows as a size gets squarer, so one range of k
                  legitimately covers different ks at different sizes. The plan
                  below says how many that dropped.
                </>
              )}
            </p>
          </div>

          <div className="farm-panel">
            <h2>3 · How hard to work</h2>
            <label className="farm-field">
              <span>hands · parallel engines ({cores} cores reported)</span>
              <input type="number" min={1} max={16} value={hands} disabled={running}
                onChange={e => setHands(Math.max(1, Math.min(16, Number(e.target.value))))} />
            </label>
            <p className="farm-note">
              Each hand is a Web Worker with its own Pyodide and NumPy, so it is
              roughly 150&nbsp;MB of memory as well as a core. More hands than
              cores makes every job slower, not the sweep faster.
            </p>
            <label className="farm-field">
              <span>count ceiling · product cells per level, 0 for all of them</span>
              <input type="number" min={0} step={50_000} value={spec.countCeiling}
                onChange={e => patchSpec({ countCeiling: Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="farm-check">
              <input type="checkbox" checked={spec.wantTraces}
                onChange={e => patchSpec({ wantTraces: e.target.checked })} />
              <span>census both bands of every level — the level widgets</span>
            </label>
            <label className="farm-check">
              <input type="checkbox" checked={spec.shortArms}
                onChange={e => patchSpec({ shortArms: e.target.checked })} />
              <span>prefer shorter arms</span>
            </label>
            {/* Rides in the job's ID, which is the run's cache key, so a sweep
                under it fills a shelf of its own and never overwrites the
                ordinary search's answers. docs/mxn-lab.md has the numbers. */}
            <label className="farm-check">
              <input type="checkbox" checked={spec.reachFromPrevious}
                onChange={e => patchSpec({ reachFromPrevious: e.target.checked })} />
              <span>learn each level&rsquo;s reach from the ones below it</span>
            </label>
            <label className="farm-check">
              <input type="checkbox" checked={spec.fastEngine}
                onChange={e => patchSpec({ fastEngine: e.target.checked })} />
              <span>vectorised angle scan — same rows, about four times faster</span>
            </label>
            <label className="farm-check">
              <input type="checkbox" checked={skipExisting}
                onChange={e => setSkipExisting(e.target.checked)} />
              <span>skip what is already stored</span>
            </label>
            <label className="farm-check">
              <input type="checkbox" checked={replayL1} disabled={running}
                onChange={e => setReplayL1(e.target.checked)} />
              <span>replay level 1 off a stored single-k run</span>
            </label>
            <div className="farm-pair">
              <label className="farm-field">
                <span>ext step</span>
                <select value={String(spec.step)}
                  onChange={e => patchSpec({
                    step: e.target.value === "auto" ? "auto" : Number(e.target.value),
                  })}>
                  {["auto", "20", "10", "5"].map(choice => (
                    <option key={choice} value={choice}>{choice}</option>
                  ))}
                </select>
              </label>
              <label className="farm-field">
                <span>combo budget</span>
                <input type="number" min={1000} step={1000} value={spec.budget}
                  onChange={e => patchSpec({ budget: Math.max(1000, Number(e.target.value)) })} />
              </label>
            </div>
          </div>
        </div>

        <div className="farm-col farm-col-wide">
          <div className="farm-panel">
            <h2>4 · The plan</h2>
            <div className="farm-stats">
              <div><b>{plan.jobs.length.toLocaleString()}</b><span>parameter sets</span></div>
              <div><b>{plan.jobs.reduce((sum, job) => sum + job.ks.length, 0).toLocaleString()}</b><span>levels</span></div>
              <div>
                <b>{(plan.jobs.reduce((sum, job) =>
                  sum + (job.wantTraces ? job.ks.length * 2 : 0), 0) + plan.jobs.length).toLocaleString()}</b>
                <span>artifacts</span>
              </div>
              <div><b>{plan.totalWeight.toLocaleString()}</b><span>combos at worst</span></div>
            </div>
            {plan.truncated && (
              <p className="farm-warn">
                Cut at {MAX_JOBS.toLocaleString()} parameter sets. The head of the
                plan is the cheap end, so what is queued is still the part worth
                having first — narrow the range and run it again for the rest.
              </p>
            )}
            {plan.skipped.length > 0 && (
              <ul className="farm-skips">
                {plan.skipped.map(entry => (
                  <li key={entry.reason}><b>{entry.count}</b> {entry.reason}</li>
                ))}
              </ul>
            )}
            <div className="farm-row">
              <label className="farm-field farm-field-inline">
                <span>batch</span>
                <input value={batch} disabled={running}
                  onChange={e => { setBatch(e.target.value); writeSetting(BATCH_KEY, e.target.value); }} />
              </label>
              <button type="button" className="farm-go" onClick={pushPlan} disabled={!configured}>
                Queue the plan
              </button>
              <button type="button" className="farm-go farm-run" onClick={start}
                disabled={running || !configured}>
                Start
              </button>
              <button type="button" className="farm-ghost" onClick={pause} disabled={!running}>
                Finish and stop
              </button>
              <button type="button" className="farm-ghost" onClick={stop}
                disabled={!workersRef.current.length}>
                Stop now
              </button>
            </div>
            {notice && <p className="farm-bad">{notice}</p>}
            {!configured && (
              <p className="farm-warn">
                A worker URL and an admin token are both needed: this page computes
                nothing it cannot store.
              </p>
            )}
          </div>

          <div className="farm-panel">
            <h2>5 · How it is going</h2>
            <div className="farm-stats">
              <div><b>{totals.done.toLocaleString()}</b><span>done</span></div>
              <div><b>{totals.running.toLocaleString()}</b><span>running</span></div>
              <div><b>{totals.pending.toLocaleString()}</b><span>pending</span></div>
              <div className={totals.failed ? "is-bad" : ""}>
                <b>{totals.failed.toLocaleString()}</b><span>failed</span>
              </div>
              <div><b>{totals.artifacts.toLocaleString()}</b><span>artifacts stored</span></div>
              <div><b>{bytesLabel(totals.bytes)}</b><span>on the shelf</span></div>
            </div>
            <div className="farm-bar">
              <i style={{ width: `${totals.all ? (100 * totals.done) / totals.all : 0}%` }} />
            </div>
            <p className="farm-note">
              {totals.all
                ? `${totals.done} of ${totals.all} in this batch`
                : "nothing queued in this batch yet"}
              {totals.perJob > 0 && (
                <> · {clockLabel(totals.perJob)} a job on this machine ·{" "}
                  <b>about {clockLabel(totals.eta)} left</b> at that rate</>
              )}
              {totals.engineSeconds > 0 && (
                <> · {clockLabel(totals.engineSeconds)} of engine time banked</>
              )}
            </p>
            <div className="farm-row">
              <button type="button" className="farm-ghost" onClick={refreshQueue}>Refresh</button>
              <button type="button" className="farm-ghost" onClick={() => requeue("failed")}>
                Requeue failed
              </button>
              <button type="button" className="farm-ghost" onClick={() => requeue("running")}>
                Requeue stuck
              </button>
            </div>
          </div>

          {handState.length > 0 && (
            <div className="farm-panel">
              <h2>The hands</h2>
              <div className="farm-hands">
                {handState.map(hand => (
                  <div className={`farm-hand is-${hand.status}`} key={hand.id}>
                    <b>hand {hand.id}</b>
                    <em>{hand.status}</em>
                    <span>{hand.message}</span>
                    <div className="farm-bar farm-bar-thin">
                      <i style={{
                        width: `${Math.round(100 * Math.min(1, Math.max(0, hand.fraction ?? 0)))}%`,
                      }} />
                    </div>
                    <i className="farm-hand-tally">{hand.done} done · {hand.failed} failed</i>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="farm-panel">
            <h2>The queue</h2>
            <div className="farm-table-wrap">
              <table className="farm-table">
                <thead>
                  <tr>
                    <th>size</th><th>ks</th><th>state</th><th>tries</th>
                    <th>engine</th><th>artifacts</th><th>stored</th><th>note</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(row => {
                    const values = JSON.parse(row.ks) as number[];
                    const ks = values.join(" ");
                    const reach = !!parseRunKey(row.id)?.descriptor.reachFromPrevious;
                    return (
                      <tr key={row.id} className={`is-${row.state}`}>
                        <td>{row.m}×{row.n}</td>
                        <td className="farm-mono">{ks}</td>
                        <td><span className={`farm-state is-${row.state}`}>{row.state}</span></td>
                        <td>{row.attempts}</td>
                        <td>{row.seconds === null ? "—" : `${row.seconds.toFixed(1)}s`}</td>
                        <td>{row.artifacts ?? "—"}</td>
                        <td>{bytesLabel(row.bytes ?? 0)}</td>
                        <td className="farm-note-cell">
                          {row.state === "done" ? (
                            <a href={`../?${labSearch({
                              m: row.m, n: row.n, ks: values, reachFromPrevious: reach,
                            })}`}
                              title="Open this parameter set in the lab — it loads from the cache">
                              open in the lab →
                            </a>
                          ) : (row.error ?? "")}
                        </td>
                      </tr>
                    );
                  })}
                  {!queue.length && (
                    <tr><td colSpan={8} className="farm-empty">
                      Nothing queued in “{batch}”. Set a range above and press
                      <b> Queue the plan</b>.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="farm-panel">
            <h2>Log</h2>
            <pre className="farm-log">{log.join("\n") || "nothing yet"}</pre>
          </div>
        </div>
      </section>

      <footer className="farm-foot">
        <span>cache {CACHE_VERSION} · artifacts are addressed by every parameter that
          decides them, so a hit is the answer this browser would have computed</span>
        <a href="../">← the lab</a>
        <a href="../rate/">categoriser</a>
        <a href="../semi/">near-misses</a>
      </footer>
    </main>
  );
}
