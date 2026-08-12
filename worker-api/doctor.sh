#!/usr/bin/env bash
#
# Why did the Worker just answer 500 with a D1 error?
#
#   cd worker-api && WORKER_URL=https://... ADMIN_TOKEN=... ./doctor.sh
#
# Answers one question: is this Cloudflare having a moment, or is it this
# database being asked to do too much? The two look identical from a browser
# console and want opposite responses -- wait, or change something.
#
# Everything here is read-only. Nothing is written, dropped or migrated.

set -uo pipefail
cd "$(dirname "$0")"

DB=mxn-solutions
WORKER=mxn-solutions-api
WORKER_URL="${WORKER_URL:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

wr() { npx --yes wrangler "$@"; }
rule() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
sql() { wr d1 execute "$DB" --remote --command "$1" 2>&1 | grep -v '^$'; }

# ---------------------------------------------------------------------------
rule "1. is the Worker answering at all, and how consistently?"
#
# One 500 is noise -- Cloudflare's own answer to this error is that a handful
# every few hours is expected and the fix is to retry. Ten in a row is not
# noise. This asks ten times and counts, which is the only way to tell them
# apart from a single screenshot of a console.

if [ -z "$WORKER_URL" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo "   skipped — set WORKER_URL and ADMIN_TOKEN to run the live probes"
else
  fails=0
  for i in $(seq 1 10); do
    start=$(date +%s%N)
    # -A because Cloudflare's edge bans some client signatures outright, and a
    # 403/1010 from the edge would otherwise read as the Worker refusing us.
    code=$(curl -s -o /tmp/d1-doctor-health.$$ -w '%{http_code}' \
      -A "mxn-farm-doctor/1" \
      -H "Authorization: Bearer $ADMIN_TOKEN" "$WORKER_URL/health")
    ms=$(( ($(date +%s%N) - start) / 1000000 ))
    if [ "$code" = "200" ]; then
      printf '   %2d  %s  %4d ms\n' "$i" "$code" "$ms"
    else
      fails=$((fails + 1))
      printf '   %2d  \033[31m%s\033[0m  %4d ms  %s\n' "$i" "$code" "$ms" \
        "$(head -c 160 /tmp/d1-doctor-health.$$)"
    fi
  done
  rm -f /tmp/d1-doctor-health.$$
  echo
  if   [ "$fails" = 0  ]; then echo "   10/10 healthy — the database is fine NOW."
  elif [ "$fails" -lt 3 ]; then echo "   $fails/10 failed — transient. Retry is the fix, not a redeploy."
  else echo "   $fails/10 failed — sustained. Read sections 3 and 4."
  fi
fi

# ---------------------------------------------------------------------------
rule "2. is Cloudflare itself degraded right now?"
#
# D1 runs on Durable Objects. When the underlying storage layer is unwell this
# error is the symptom, and no amount of query tuning helps until it passes.

curl -s 'https://www.cloudflarestatus.com/api/v2/summary.json' | python3 - <<'PY' 2>/dev/null \
  || echo "   status check needs python3 and outbound https"
import json, sys
watched = ("D1", "Workers", "Durable Objects")
try:
    d = json.load(sys.stdin)
except Exception:
    print("   could not read the status page"); raise SystemExit
print("   overall:", d["status"]["description"])
live = [i for i in d.get("incidents", []) if i["status"] != "resolved"]
for i in live:
    print("   * " + i["name"] + " - " + i["status"] + " (" + i["impact"] + ")")
for c in d.get("components", []):
    if c["name"] in watched and c["status"] != "operational":
        print("   * component " + c["name"] + ": " + c["status"])
if not live:
    print("   no open incidents")
PY

# ---------------------------------------------------------------------------
rule "3. how big has this database got?"
#
# Artifacts live in D1 as base64 text whenever no R2 bucket is bound -- and one
# is not bound in this repo. Measured at the sizes docs/mxn-farm.md records,
# 500 parameter sets is ~43 MB and D1's ceiling is 10 GB, so the shelf is not
# a limit until it is enormous. But size drives how much work a single storage
# operation is, and this error is a storage operation timing out.

wr d1 info "$DB" 2>&1 | sed 's/^/   /'

sql "SELECT
       (SELECT COUNT(*) FROM cache_entries)                AS artifacts,
       (SELECT COALESCE(SUM(LENGTH(body)),0)/1048576 FROM cache_entries) AS artifact_MB,
       (SELECT COALESCE(MAX(LENGTH(body)),0)      FROM cache_entries)    AS biggest_row_bytes,
       (SELECT COUNT(*) FROM farm_jobs)                    AS jobs,
       (SELECT COUNT(*) FROM solutions)                    AS solutions" | sed 's/^/   /'

echo
echo "   biggest_row_bytes near 1866666 means an artifact is at the D1 ceiling"
echo "   (1.4 MB gzipped, a third more once base64'd). Bind R2 if so —"
echo "   see the 'Optional: R2' section of worker-api/README.md."

# ---------------------------------------------------------------------------
rule "4. how much work is a claim doing?"
#
# /farm/claim is the hottest write on the database: every hand asks for one
# every time it finishes a job, and it is an UPDATE, so it takes the write
# lock. If its subselect has to sort the pending set, every claim pays for the
# whole queue.

sql "SELECT state, COUNT(*) AS n FROM farm_jobs GROUP BY state" | sed 's/^/   /'

echo
echo "   the plan for the claim's subselect:"
sql "EXPLAIN QUERY PLAN
     SELECT id FROM farm_jobs
      WHERE (state = 'pending' OR (state = 'running' AND lease_until < '2030-01-01'))
        AND ('default' IS NULL OR batch = 'default')
      ORDER BY weight ASC, levels ASC, created_at ASC
      LIMIT 1" | sed 's/^/   /'

echo
echo "   'USE TEMP B-TREE FOR ORDER BY' means every claim sorts every pending"
echo "   row. idx_farm_claim is (state, weight, created_at) and the ORDER BY is"
echo "   (weight, levels, created_at) — 'levels' in the middle is what stops the"
echo "   index satisfying it. Harmless on a short queue, real on a long one."

# ---------------------------------------------------------------------------
rule "5. which queries are actually slow, over the last day?"

wr d1 insights "$DB" --timePeriod=1d --sort-by=time 2>&1 | sed 's/^/   /' \
  || echo "   flags vary by wrangler version — try: npx wrangler d1 insights --help"

# ---------------------------------------------------------------------------
rule "6. watch it happen live"
echo "   Leave this running in one terminal and press Start on /mxn/gpu/ in"
echo "   another. The 500 names the route it came from, which the browser's"
echo "   copy of the message does not:"
echo
echo "     npx wrangler tail $WORKER --format pretty --status error"
