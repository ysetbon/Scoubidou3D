/**
 * Dataset API for the MXN Continuation Lab.
 *
 * The lab is a static GitHub Pages site with no server, so this Worker is the
 * only place a starred solution can be kept where a later categoriser can read
 * it back. It does one thing: hold rated rings.
 *
 * Auth is a single bearer token, because there is exactly one writer. Anything
 * that mutates requires it; nothing is readable without it either, since the
 * dataset is not public. The token lives as a Worker secret and, on the client,
 * in localStorage — never in the repository.
 */

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  /** Comma-separated origins allowed to call this. */
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_ORIGINS = "https://ysetbon.github.io,http://localhost:5173";

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(",").map(value => value.trim()).filter(Boolean);
}

/**
 * Echo the caller's origin only when it is allowlisted.
 *
 * A wildcard would let any page a browser happens to load read the dataset with
 * a token it stole from elsewhere; echoing keeps the browser enforcing the list.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, request: Request, env: Env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
  });
}

/**
 * Constant-time-ish comparison.
 *
 * Not a meaningful defence for a single-user token over the public internet,
 * but comparing with === leaks length and prefix through timing for free, and
 * avoiding that costs nothing.
 */
function tokenMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function authorised(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return tokenMatches(header.slice(prefix.length), env.ADMIN_TOKEN);
}

type Incoming = Record<string, unknown>;

function asArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

/** Reject anything that would store a half-formed row. */
function validate(body: Incoming): string | null {
  for (const field of ["m", "n", "level", "k", "solution_index"]) {
    if (!Number.isInteger(body[field] as number)) return `${field} must be an integer`;
  }
  if (!body.parent_strands || !body.solution_strands) {
    return "parent_strands and solution_strands are both required";
  }
  if (!Array.isArray(body.parent_strands) || !Array.isArray(body.solution_strands)) {
    return "parent_strands and solution_strands must be arrays";
  }
  if (!body.audit || typeof body.audit !== "object") return "audit is required";
  return null;
}

async function createSolution(request: Request, env: Env) {
  let body: Incoming;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400, request, env);
  }
  const invalid = validate(body);
  if (invalid) return json({ error: invalid }, 400, request, env);

  const hExt = asArray(body.h_ext);
  const vExt = asArray(body.v_ext);
  const audit = body.audit as Record<string, unknown>;
  const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();

  // A row is a near-miss only if it says so. Anything written by a page that
  // predates near-misses is a closed ring, which is what the column default
  // already says — stating it here keeps INSERT OR REPLACE from blanking it.
  const kind = body.kind === "semi" ? "semi" : "complete";
  const band = kind === "semi" && (body.band === "h" || body.band === "v")
    ? body.band : null;
  const deficit = Number.isInteger(body.deficit as number)
    ? Math.max(0, body.deficit as number) : 0;
  const refs = Number.isInteger(body.refs as number)
    ? Math.max(0, body.refs as number) : 0;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO solutions
       (id, created_at, hand, direction, m, n, level, k, ks_prefix,
        parent_strands, solution_strands, h_ext, v_ext, total_ext,
        audit, healthy, solution_index, kind, band, deficit, refs,
        rating, rated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
             ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)`
  ).bind(
    id,
    (body.created_at as string) || new Date().toISOString(),
    (body.hand as string) || "lh",
    (body.direction as string) || "cw",
    body.m, body.n, body.level, body.k,
    JSON.stringify(body.ks_prefix ?? []),
    JSON.stringify(body.parent_strands),
    JSON.stringify(body.solution_strands),
    JSON.stringify(hExt),
    JSON.stringify(vExt),
    hExt.concat(vExt).reduce((sum, value) => sum + value, 0),
    JSON.stringify(audit),
    audit.healthy ? 1 : 0,
    body.solution_index,
    kind, band, deficit, refs,
    Number.isInteger(body.rating as number) ? body.rating : null,
    Number.isInteger(body.rating as number) ? new Date().toISOString() : null,
  ).run();

  return json({ id }, 201, request, env);
}

async function listSolutions(request: Request, env: Env) {
  const params = new URL(request.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const field of ["m", "n", "k", "level"]) {
    const raw = params.get(field);
    if (raw !== null && Number.isInteger(Number(raw))) {
      where.push(`${field} = ?${binds.length + 1}`);
      binds.push(Number(raw));
    }
  }
  if (params.get("unrated") === "1") where.push("rating IS NULL");
  if (params.get("healthy") === "1") where.push("healthy = 1");
  const kind = params.get("kind");
  if (kind === "semi" || kind === "complete") {
    where.push(`kind = ?${binds.length + 1}`);
    binds.push(kind);
  }
  const band = params.get("band");
  if (band === "h" || band === "v") {
    where.push(`band = ?${binds.length + 1}`);
    binds.push(band);
  }

  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 500);
  // Closed rings sort shortest first; near-misses sort by how near they came,
  // because a ring one crossing short is the one most worth a person's eyes.
  // Both columns exist precisely so neither ordering is a JSON scan.
  const order = kind === "semi"
    ? "deficit ASC, total_ext ASC, created_at ASC"
    : "total_ext ASC, created_at ASC";
  const rows = await env.DB.prepare(
    `SELECT id, created_at, m, n, level, k, ks_prefix, h_ext, v_ext, total_ext,
            audit, healthy, solution_index, kind, band, deficit, refs, rating
       FROM solutions
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${order}
       LIMIT ${limit}`
  ).bind(...binds).all();

  return json({ solutions: rows.results ?? [] }, 200, request, env);
}

async function getSolution(id: string, request: Request, env: Env) {
  const row = await env.DB.prepare("SELECT * FROM solutions WHERE id = ?1")
    .bind(id).first();
  if (!row) return json({ error: "not found" }, 404, request, env);
  return json({ solution: row }, 200, request, env);
}

async function rateSolution(id: string, request: Request, env: Env) {
  let body: Incoming;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400, request, env);
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 0 || rating > 100) {
    return json({ error: "rating must be an integer 0..100" }, 400, request, env);
  }
  const result = await env.DB.prepare(
    "UPDATE solutions SET rating = ?1, rated_at = ?2 WHERE id = ?3"
  ).bind(rating, new Date().toISOString(), id).run();

  if (!result.meta.changes) return json({ error: "not found" }, 404, request, env);
  return json({ id, rating }, 200, request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (!authorised(request, env)) {
      return json({ error: "unauthorised" }, 401, request, env);
    }

    try {
      if (path === "/health") {
        // Proves the binding works, not just that the Worker booted.
        const probe = await env.DB.prepare("SELECT COUNT(*) AS n FROM solutions").first();
        return json({ ok: true, solutions: probe?.n ?? 0 }, 200, request, env);
      }
      if (path === "/solutions" && request.method === "POST") {
        return await createSolution(request, env);
      }
      if (path === "/solutions" && request.method === "GET") {
        return await listSolutions(request, env);
      }
      const match = path.match(/^\/solutions\/([^/]+)$/);
      if (match && request.method === "GET") {
        return await getSolution(decodeURIComponent(match[1]), request, env);
      }
      if (match && request.method === "PATCH") {
        return await rateSolution(decodeURIComponent(match[1]), request, env);
      }
      return json({ error: "not found" }, 404, request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Surfaced rather than swallowed: the most likely cause by far is that
      // schema.sql has not been applied to this database yet.
      return json({ error: message }, 500, request, env);
    }
  },
};
