# Working in this repo

## If this clone is the compute machine

If this session is about running or tending the MXN compute farm — precomputing
runs onto Cloudflare so `/mxn/` loads instead of computing — read
[docs/gpu-runbook.md](docs/gpu-runbook.md) first. It has the run steps, the
Worker setup, the file map of the farm/cache code, and the checks to run after
touching it. The design behind it is [docs/mxn-farm.md](docs/mxn-farm.md).

## "Is my ★ best actually saved in Cloudflare?"

When the user asks how to verify a judgement reached the shelf, give them these
commands directly — do not ask them to paste a token, and do not ask which shell
they use. They are on **Windows PowerShell**, the clone is at `$HOME\Scoubidou3D`,
and the Worker is `https://mxn-solutions-api.ysetbon.workers.dev`.

**No token is required for any of this.** The Worker runs with
`CACHE_PUBLIC_READS = "1"`, and `publicReads()` makes `/catalogue` and
`/cache/…` open to GET, so the whole check is anonymous. Only `/solutions`
needs `Authorization: Bearer <ADMIN_TOKEN>`, and it is never needed to answer
this question — the picks artifact is the record; the D1 row is a mirror of it.

```powershell
cd $HOME\Scoubidou3D
$api = "https://mxn-solutions-api.ysetbon.workers.dev"

# 1 — every parameter set that has judgements. Empty output = nothing saved.
(Invoke-RestMethod "$api/catalogue?prefix=picks/").entries.key

# 2 — one set's judgements. $key is a step-1 line with "picks/" stripped.
$key = "v3/lh-cw/2x1/1/s1-eauto-b400000"
(Invoke-RestMethod "$api/cache/picks/$key").judgements |
  Select-Object verdict, chooser, at,
    @{n='levels';   e={ $_.levels.level -join ',' }},
    @{n='crossings';e={ "$($_.audit.crossings)/$($_.audit.expected)" }},
    @{n='hasRing';  e={ [bool]$_.strands }} | Format-Table -AutoSize

# 3 — the exact knobs of the best, which is what reproduces the ring.
(Invoke-RestMethod "$api/cache/picks/$key").judgements |
  Where-Object verdict -eq 'best' | ForEach-Object {
    foreach ($l in $_.levels) {
      "L{0}  H ext={1} angle={2}  V ext={3} angle={4}" -f `
        $l.level, ($l.h.ext -join ','), $l.h.angle, ($l.v.ext -join ','), $l.v.angle
    }
  }
```

Step 2 in a browser tab works too, since reads are public:
`https://mxn-solutions-api.ysetbon.workers.dev/cache/picks/v3/lh-cw/2x1/1/s1-eauto-b400000`

**Building the key from parameters.** `v3/<hand>-<direction>/<m>x<n>/<ks joined
by _>/s<1|0>-e<step|auto>-b<budget>`. The fitter always writes
`s1-eauto-b400000`, so `2×1`, `ks = 1`, LH, CW is
`v3/lh-cw/2x1/1/s1-eauto-b400000`. Note the farm's own runs use different flags
(`s1-e5-b100000000`), so a `run/` key for the same size will not match a
fitter `picks/` key — that is expected, not a bug.

**If step 1 comes back empty, the diagnosis order is:**

1. **Did they press a verdict button?** Loading a best does not write one.
   The status line under the buttons names all three writes when it works:
   `held locally · shelf: picks/… now holds N judgements · D1 row written`.
2. **Is the deployed Worker current?** A Worker built before `ade62c9`
   (PR #110) does not know the `picks` kind, so it rejects the PUT and drops
   the `verdict`/`verdict_by` columns — silently, because the judgement is
   written to `localStorage` first and that half always succeeds. This has
   bitten once already. Fix, from a fresh clone state:
   ```powershell
   cd $HOME\Scoubidou3D; git checkout main; git pull origin main
   cd .\worker-api
   npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0003_verdict.sql
   npx wrangler deploy
   ```
   Migration **before** deploy: the current Worker's `SELECT` names `verdict`,
   `verdict_by`, `verdict_at`, `source`, so deploying first makes `/solutions`
   500 until the columns exist.
3. **Is it only in the browser?** Judgements are written local-first on
   purpose, so a decision can survive a wrong URL or a dead Worker. Check with,
   in the browser's devtools console on `/mxn/fit/`:
   ```js
   JSON.parse(localStorage.getItem('mxn-fit-judgements') || '[]')
     .map(r => `${r.judgement.verdict}  ${r.judgement.chooser}  ${r.judgement.at}  ${r.key}`)
   ```
   The `key` on each row is the parameter set. Re-pressing the verdict with a
   worker url configured pushes it up.

**On PowerShell specifically:** `curl` is an alias for `Invoke-WebRequest` and
chokes on `-s`/`-H` — use `Invoke-RestMethod`, or `curl.exe` for the real
thing. Windows PowerShell 5.1 may also need
`[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`
before it will talk to Cloudflare. And `Invoke-RestMethod` converts ISO
timestamps to `DateTime`, so `.Substring(0,10)` on a date field throws — format
it instead.

**This session cannot run any of the above.** The sandbox's egress policy
returns 403 on CONNECT to `mxn-solutions-api.ysetbon.workers.dev` (HTTP 000 to
curl). Hand the commands over rather than offering to run them, and ask for the
output back.

## Pull requests

When you open a PR, enable GitHub auto-merge on it immediately, while its checks
are still pending. Auto-merge cannot be armed once a PR is already green —
GitHub rejects it and the PR then has to be merged by hand, which is the thing
this is here to avoid.

What auto-merge waits on is a ruleset on `main` requiring the `build` check from
`.github/workflows/ci.yml`. Without a required check there is nothing to wait
for, and GitHub declines to arm auto-merge at all — so if that ruleset is ever
removed, the instruction above stops working rather than failing loudly.

Do not add `report-build-status` as a required check. It belongs to the built-in
`pages-build-deployment` workflow, which only runs on pushes to `main`; required
on a PR, it would never arrive and the PR could never merge.
