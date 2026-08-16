# Reading the picks shelf

Every ★ best, ✓ valid and ✗ rejected that anybody has pressed at `/mxn/fit/` is
a **judgement**, and judgements live on Cloudflare under the `picks/` kind. This
is how to read them back from a terminal — to answer "did my ★ best actually
save?", to recover the exact knobs that reproduce a ring, or to see what a
parameter set has been judged before re-judging it.

The commands are Windows PowerShell, since that is where they get run. The
clone is at `$HOME\Scoubidou3D` and the Worker is
`https://mxn-solutions-api.ysetbon.workers.dev`.

**No token is required.** The Worker runs with `CACHE_PUBLIC_READS = "1"`, and
`publicReads()` opens `/catalogue` and `/cache/…` to GET, so the whole check is
anonymous. Only `/solutions` needs `Authorization: Bearer <ADMIN_TOKEN>`, and it
is never needed here — the picks artifact **is** the record, and the D1 row is a
mirror of it.

## A cache read has to gunzip

This is the one thing that makes the check non-obvious, and getting it wrong
looks exactly like "nothing was saved".

[`encode()`](../src/mxn-lab/cache.ts) gzips every artifact before the PUT, and
[`serveArtifact()`](../worker-api/src/index.ts) hands those bytes back untouched
as `application/octet-stream`, with the codec in our own `X-Mxn-Codec` header
rather than `Content-Encoding` — deliberately, so that no proxy, and neither the
Workers runtime nor the browser, can rewrite it on the way. The client
compresses and the client decompresses.

So `Invoke-RestMethod` on a `/cache/…` URL returns a **byte array**, not an
object. `.judgements` on it is `$null`, the pipeline is empty, and PowerShell
prints nothing at all — with no error to notice. A read that has not gunzipped
is indistinguishable from an empty shelf unless you know to look.

`/catalogue` is exempt: the Worker builds that JSON itself, so it is ordinary
JSON over an ordinary GET.

## The commands

```powershell
cd $HOME\Scoubidou3D
$api = "https://mxn-solutions-api.ysetbon.workers.dev"

# Read one artifact off the shelf, gunzipping it. Sniffs the gzip magic bytes
# rather than trusting the header, so it also reads an `identity` entry.
function Get-MxnArtifact {
  param([Parameter(Mandatory)][string]$Path)
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Invoke-WebRequest "$api/$Path" -OutFile $tmp -UseBasicParsing | Out-Null
    $bytes = [IO.File]::ReadAllBytes($tmp)
  } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0x1f -and $bytes[1] -eq 0x8b) {
    $ms = New-Object IO.MemoryStream(,$bytes)
    $gz = New-Object IO.Compression.GZipStream($ms,
            [IO.Compression.CompressionMode]::Decompress)
    $text = (New-Object IO.StreamReader($gz, [Text.Encoding]::UTF8)).ReadToEnd()
  } else {
    $text = [Text.Encoding]::UTF8.GetString($bytes)
  }
  $text | ConvertFrom-Json
}

# 1 — every parameter set that has judgements. Empty output = nothing saved.
$keys = (Invoke-RestMethod "$api/catalogue?prefix=picks/").entries.key
$keys

# 2 — every judgement on every one of them. Catalogue keys already carry the
# `picks/` prefix, so they append to `cache/` as they stand.
foreach ($k in $keys) {
  ""; "=== $k"
  (Get-MxnArtifact "cache/$k").judgements |
    Select-Object verdict, chooser, at,
      @{n='levels';   e={ $_.levels.level -join ',' }},
      @{n='crossings';e={ "$($_.audit.crossings)/$($_.audit.expected)" }},
      @{n='hasRing';  e={ [bool]$_.strands }} | Format-Table -AutoSize
}

# 3 — the exact knobs of each ★ best, which is what reproduces the ring.
foreach ($k in $keys) {
  (Get-MxnArtifact "cache/$k").judgements |
    Where-Object verdict -eq 'best' | ForEach-Object {
      "=== $k  (chooser: $($_.chooser))"
      foreach ($l in $_.levels) {
        "L{0}  H ext={1} angle={2}  V ext={3} angle={4}" -f `
          $l.level, ($l.h.ext -join ','), $l.h.angle, ($l.v.ext -join ','), $l.v.angle
      }
    }
}
```

A browser tab on a `/cache/…` URL does **not** work, for the same reason as
above: the body is gzip under `application/octet-stream` with no
`Content-Encoding`, so the browser downloads a binary file instead of rendering
JSON. Reads being public buys anonymity, not readability.
`/catalogue?prefix=picks/` does render in a tab.

## Reading the output

| Column | What it means |
| --- | --- |
| `verdict` | `best`, `valid` or `rejected`. At most one `best` per set — a new one demotes the old to `valid` and records it in `supersedes`. |
| `chooser` | Who pressed it. A judgement with no chooser throws before any network, so this is never blank. |
| `levels` | Which levels the judgement covers. A fit judges one level at a time. |
| `crossings` | `actual/expected`. Equal means the ring closes; short means it does not. |
| `hasRing` | Whether the judgement carries its strands. See below. |

**`hasRing = False` is not corruption.** A judgement saved before the ring was
embedded in a pick stores no strands, and the fitter says so at the point it
matters: those still ask the engine. A pick that carries its strands opens in
`/app/` with no engine anywhere; one that does not has to be re-woven from the
knobs. To upgrade an old judgement, load `/mxn/fit/` at those parameters and
press ★ best again — re-judging the same pick **replaces** the old judgement
rather than adding one, so the set still ends up with exactly one best, now
carrying the ring.

## Building the key from parameters

```
v3/<hand>-<direction>/<m>x<n>/<ks joined by _>/s<1|0>-e<step|auto>-b<budget>
```

The fitter always writes `s1-eauto-b400000`, so `2×1`, `ks = 1`, LH, CW is
`v3/lh-cw/2x1/1/s1-eauto-b400000`. The farm's own runs use different flags
(`s1-e5-b100000000`), so a `run/` key for the same size will **not** match a
fitter `picks/` key — that is expected, not a bug.

## When nothing comes back

**Keys listed but step 2 prints nothing** — the read is not gunzipping. That is
the failure described at the top, not a missing judgement. A key is in the
catalogue only because something was PUT to it, so a listed key always has an
artifact behind it.

**Step 1 itself is empty**, in diagnosis order:

1. **Was a verdict button actually pressed?** Loading a best does not write one.
   The status line under the buttons names all three writes when it works:
   `held locally · shelf: picks/… now holds N judgements · D1 row written`.
2. **Is the deployed Worker current?** A Worker built before `ade62c9` (PR #110)
   does not know the `picks` kind, so it rejects the PUT and drops the
   `verdict`/`verdict_by` columns — silently, because the judgement is written to
   `localStorage` first and that half always succeeds. This has bitten once.
   Fix, from a fresh clone state:
   ```powershell
   cd $HOME\Scoubidou3D; git checkout main; git pull origin main
   cd .\worker-api
   npx wrangler d1 execute mxn-solutions --remote --file=./migrations/0003_verdict.sql
   npx wrangler deploy
   ```
   Migration **before** deploy: the current Worker's `SELECT` names `verdict`,
   `verdict_by`, `verdict_at`, `source`, so deploying first makes `/solutions`
   500 until the columns exist.
3. **Is it only in the browser?** Judgements are written local-first on purpose,
   so a decision survives a wrong URL or a dead Worker. In devtools on
   `/mxn/fit/`:
   ```js
   JSON.parse(localStorage.getItem('mxn-fit-judgements') || '[]')
     .map(r => `${r.judgement.verdict}  ${r.judgement.chooser}  ${r.judgement.at}  ${r.key}`)
   ```
   The `key` on each row is the parameter set. Re-pressing the verdict with a
   worker URL configured pushes it up.

## PowerShell footnotes

`curl` is an alias for `Invoke-WebRequest` and chokes on `-s`/`-H` — use
`Invoke-RestMethod`, or `curl.exe` for the real thing. Windows PowerShell 5.1
may also need
`[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`
before it will talk to Cloudflare. And `Invoke-RestMethod` converts ISO
timestamps to `DateTime`, so `.Substring(0,10)` on a date field throws — format
it instead.
