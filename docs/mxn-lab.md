# The MXN Continuation Lab, at /mxn/

The lab takes `m`, `n` and one `k` per level and draws every Lᵥ continuation
ring, with the audit numbers beside each one. It is published here at
<https://ysetbon.github.io/Scoubidou3D/mxn/>, and it is a copy: it is built and
maintained on ChatGPT Sites at
<https://mxn-continuation-lab.topspin-tech-0568.chatgpt.site/>, from source
snapshot `ad64595`, over the `ysetbon/mxn` engine at commit `984d9ed`.

Being a copy is the thing to remember. Change the lab upstream and this does not
follow; re-export and re-apply the steps below.

## Why it needed anything doing to it

Upstream it is a Next app on Cloudflare — `app/layout.tsx` renders the document,
`app/page.tsx` renders `<ContinuationLab />`, and `worker/index.ts` serves the
result. GitHub Pages cannot run a Worker, so at first glance the lab could not
come here at all.

It can, because none of that server is load-bearing. `ContinuationLab` is a
`"use client"` component; the engine is the real `ysetbon/mxn` Python, compiled
to WebAssembly by Pyodide and run in a Web Worker **in the reader's browser**.
Its only network calls are the worker pulling Pyodide and NumPy from jsDelivr
and then fetching its own `.py` modules — both of which a static host serves
just as well. No API, no database, no auth, no secrets: `.openai/hosting.json`
has `d1` and `r2` both `null`.

So the calculation is identical here, because the calculation was never on a
server. What is lost is the server-rendered first paint: upstream the chrome
arrives in the HTML, here React draws it, which is a few hundred milliseconds of
the page's own paper colour on first load. `mxn/index.html` sets that colour so
the wait is not a white flash.

## What is copied, and what was changed

Copied verbatim from the export:

| here | from |
| --- | --- |
| `src/mxn-lab/weave-studio.tsx` | `app/weave-studio.tsx` — UI, worker protocol, canvas renderer |
| `src/mxn-lab/lab.css` | `app/globals.css` |
| `public/mxn/exact-worker.js` | `public/exact-worker.js` |
| `public/mxn/py/*.py` | `public/py/*.py` — the engine, ~9,300 lines |
| `public/mxn/extension-origin-l0.svg`, `public/mxn/og.png` | same |

Changed, all of it hosting rather than behaviour:

- **Three paths.** Upstream the lab owns its domain root, so it asked for
  `/exact-worker.js`, `/extension-origin-l0.svg` and `/py/*.py`. Under
  `/Scoubidou3D/mxn/` those resolve against `ysetbon.github.io` and miss. The
  first two now hang off `import.meta.env.BASE_URL`, so they follow whatever
  `--base` the build used; the third resolves against the worker's own
  `import.meta.url`.
- **A way back.** `.brand` in the masthead is an `<a>` to `..`, and the footer
  carries a `← Scoubidou3D` link. A page that is part of a site needs them; a
  page that was the whole site did not.
- **The wrapper.** `app/layout.tsx` + `app/page.tsx` + the Cloudflare Worker are
  replaced by `mxn/index.html` and `src/mxn-lab/main.tsx`, which mount the
  component on a div. The metadata the layout computed from the request host —
  `og:image` — is stated absolutely in the HTML instead.
- **Tailwind.** `lab.css` began `@import "tailwindcss"`, and all it wanted was
  preflight. That output is vendored in `src/mxn-lab/preflight.css` rather than
  putting a PostCSS pipeline in a repo with no other use for one.

## How it is built

`mxn/index.html` is the fifth entry in `vite.config.ts`. It is the only React in
the repo, which is why `@vitejs/plugin-react` is scoped to `**/mxn-lab/**` — the
rest of the build has no JSX and should not pay for the transform. It carries
its own stylesheet instead of `site.css`, and has no theme toggle: it is
drafting paper and black rule, one palette, with no dark counterpart to switch
to.

Its runtime files live in `public/mxn/`, copied to the output untouched, which
is what the worker and the Python modules need.

## Checking a re-copy

The engine is plain Python, so it can be run without a browser:

```bash
cd public/mxn/py
python3 -c "import bridge, json; print(json.loads(bridge.generate(2,2,[1,2,2],'lh','cw'))['rows'])"
```

`2×2` with `ks = [1,2,2]` must give extensions `(40,10)`, `(50,60)`, `(40,90)`
and gaps `56.30/56.29`, `56.60/56.59`, `58.05/58.06`, every level 16 across, 0
within, 8 masks, 0 stray, 0 broken. Those are the numbers the production page
shows; if a re-copy disagrees, the copy is wrong.

`[1,2,2]` is worth using as the check precisely because it is a max-k sequence,
which the lab's own sidebar warns is an open research edge — the handoff notes
it comes out clean only because the browser engine carries the even-k
orientation exchange from one level into the next. A copy that loses that will
still render; it will just quietly stop weaving, which is why the check is on
the numbers and not on whether a picture appeared.

The `even-orientation-v2` cache key appears in both the worker URL
(`weave-studio.tsx`) and the Python fetch URL (`exact-worker.js`). Bump both
together when the engine files change, or returning readers run stale geometry.
