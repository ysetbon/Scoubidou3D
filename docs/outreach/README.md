# Finding people who want this

A repeatable workflow for finding the customers, collaborators and amplifiers for
Scoubidou3D, and a place to keep what it finds. The researched target list is
**[targets.md](targets.md)** — Israel first, because that is where the author is.

| file | what it is |
| --- | --- |
| [targets.md](targets.md) | the standing target list: named organisations, why each one, what to ask |
| [pipeline.csv](pipeline.csv) | every lead and its status. Machine-appended, human-owned |
| [prospect.json](prospect.json) | the GitHub sweep's queries, vocabulary and boosts |
| [`scripts/prospect-github.mjs`](../../scripts/prospect-github.mjs) | the sweep — `node scripts/prospect-github.mjs --people` |
| [templates.md](templates.md) | the messages, one per lead type |

---

## Step 0, before any of it: the repo cannot receive a visitor yet

This is not a preamble to skip. Outreach works by sending someone to
<https://github.com/ysetbon/Scoubidou3D>, and the state of that page decides
whether a lead becomes anything. Today it has **0 stars, 0 forks, one author, no
`LICENSE` file, no `CONTRIBUTING.md`, no topics, and no discussions** — so a
researcher who arrives cannot tell whether they are allowed to use it, an
engineer cannot tell whether it is maintained, and a would-be contributor has no
door.

The README declares GPL-3.0. GitHub does not believe a README: with no `LICENSE`
file at the repo root, the sidebar shows no licence at all, which to a corporate
legal review reads as **all rights reserved**. That single missing file is enough
to end a conversation with a medical-device or aerospace company before it opens,
and it is the cheapest thing on this list to fix.

| gap | why it costs a lead | cost to fix |
| --- | --- | --- |
| no `LICENSE` file | company legal review reads "no licence" as unusable | minutes |
| no repo topics | nobody finds it by search; `weaving`, `braiding`, `knot-theory`, `three.js`, `computational-design`, `textile`, `webgl`, `pyodide` | minutes |
| no `CONTRIBUTING.md` | a stranger who wants in has no idea how | an hour |
| no `good first issue` labels | the six open issues are all author-sized | an hour |
| discussions off | no place for a question that is not a bug | one click |
| no animated demo above the fold | the headline claim — laces physically lift and dip — is the thing that sells it, and it is currently a still image | an afternoon |

Do these before the first email goes out, not after the first reply.

---

## What is actually being offered

The mistake to avoid is pitching "a scoubidou app". Nobody has a scoubidou
budget. There are **two products** in this repo and they go to different people
with different words.

### 1 · The studio — a 3D authoring and viewing tool for over/under structure

<https://ysetbon.github.io/Scoubidou3D/app/>

> A browser tool where every strand is a ribbon with real width *and* thickness,
> layer order is physical height, and a mask is a real over/under crossing — the
> over lace lifts, the under lace dips. Import a strand file, orbit it, edit it,
> export it to Blender. Nothing is uploaded.

Who that sentence is for: anyone whose work involves interlacement they currently
draw flat and imagine in 3D — braided-device engineers, weave-draft software
users, textile and composites designers, teachers, museums, craftspeople.

The differentiator to lead with is **thickness**. Everything else in this space
draws strands as lines or as masked 2D shapes. This one gives a strand a body,
which is why a stack of woven rounds has a height and why a storey is exactly two
thicknesses.

### 2 · The MXN engine — exhaustive enumeration of feasible interlacements

<https://ysetbon.github.io/Scoubidou3D/mxn/>

> Give it a face size `m × n` and a twist parameter `k` per level, and it returns
> **every geometrically valid continuation** for the next level, with audit
> numbers per candidate. Deterministic. It runs the real Python engine in the
> browser via Pyodide, and because the answer depends only on the parameters,
> [a farm](../mxn-farm.md) precomputes it once onto Cloudflare and every later
> reader gets it instantly.

Who that sentence is for: researchers and engineers with a search problem, not a
drawing problem. Braid and knot theorists, combinatorialists, composites and
braiding-machine engineers who need to know which patterns close at all, and
anyone who has to justify a search bound — which is what [the k atlas](../mxn-ks.md)
does when it shows a 70px extension ceiling searching eighteen times less than
the provisioned 200 for the identical answer.

This is the harder sell and the more valuable one. It is also the one with a
publishable result attached, which makes an academic co-author a realistic and
cheap first win.

---

## The rubric: what counts as a lead

A name is not a lead. A lead passes all four:

1. **They already work with interlaced structure.** Not "they do 3D". Not "they
   are a textile company". Their public work visibly contains braids, weaves,
   knots, woven preforms, weave drafts, or the mathematics of any of those.
2. **There is a named human and a public route to them.** A company contact form
   is the weakest acceptable answer; a lab page, a GitHub handle, a paper with a
   corresponding author, or a conference talk is a real one.
3. **The ask takes them under fifteen minutes.** See the ask ladder below.
4. **One of the two products is named, and the reason is specific.** If the "why"
   could be pasted into an email to a different company unchanged, it is not a
   reason, and the email will read as a mass mailing because it is one.

Rank what passes by, in order: **Israeli** (a meeting costs a train ticket and
converts at a completely different rate), then **strength of fit**, then
**smallness of the ask**.

---

## The loop

Run it monthly. It is four hours, not four weeks.

```
  SWEEP  ──►  QUALIFY  ──►  ASK  ──►  LOG  ──►  ONE FOLLOW-UP  ──►  CLOSE
    │                                                                  │
    └──────────────────────── next month ◄─────────────────────────────┘
```

**1 · Sweep** — five sweeps, in priority order. The first is the one that pays.

| # | sweep | how | cadence |
| --- | --- | --- | --- |
| 1 | **Israel** | [targets.md § Israel](targets.md#israel-first) — work the standing list, and re-search the verticals in it for new entrants | monthly |
| 2 | **GitHub kin** | `node scripts/prospect-github.mjs --people` — neighbours by subject, plus the stargazers and forkers of the OpenStrand repos | monthly |
| 3 | **Academic** | new arXiv preprints in `math.GT`, `math.CO`, `cs.CG` and `cs.GR` touching braids, weaving or interlacement; the citation lists of the papers already in targets.md | monthly |
| 4 | **Industry** | trade press and exhibitor lists for the braiding, composites, medical-device and technical-textile shows in targets.md | per show |
| 5 | **Inbound** | who starred, forked, or opened an issue since last month. These are the warmest leads that exist and they arrive for free | monthly |

Sweep 5 is currently empty because of Step 0. That is the argument for Step 0.

**2 · Qualify** — run the rubric. Most sweep output dies here, and that is the
point: the sweep is tuned to be generous so that qualification can be strict.
Kill a lead in the CSV rather than deleting it, so next month's sweep does not
resurrect it.

**3 · Ask** — one message, from [templates.md](templates.md), with the smallest
ask on the ladder that fits.

**4 · Log** — set `status` in [pipeline.csv](pipeline.csv). The sweep script never
overwrites a status a human has set, so the file is safe to regenerate.

**5 · One follow-up** — ten to fourteen days later, once, short, adding something
new (a link to the thing they'd care about, not "just bumping this"). Then stop.
A second follow-up converts nobody and costs the relationship.

**6 · Close** — `won`, `rejected` or `dead`. Write one line in `notes` saying why.
Six months of those lines is the only honest read on whether the positioning is
right.

---

## The ask ladder

Never open with "would you like to buy / adopt / fund this". Open with the
smallest thing that is genuinely useful to *them*, because the goal of message
one is a reply, not a deal.

| lead type | the ask | why it works |
| --- | --- | --- |
| **Researcher** | "Does this enumeration match what your model predicts at 3×3? Here is the data." | you are handing them a dataset and a check, not asking a favour |
| **OSS maintainer** | "I ported OpenStrand's curve math to a 3D ribbon sweep — would a viewer for your weave drafts be useful, or would you rather I opened an issue?" | offers work, asks permission |
| **Company engineer** | "You braid on an m×n face. This enumerates every interlacement that closes at a given angle. Fifteen minutes to show you?" | a specific capability against a specific job |
| **Teacher / museum** | "Free, no install, works on a phone, and every sample has its own link." | removes the three objections before they are raised |
| **Craft community** | "Here is your stitch, in 3D, that you can spin." + the deep link to that exact sample | the artefact is the message |
| **Funder** | the working demo, the published result, the named industrial partner | in that order, and not before the first two exist |

The deep links matter more than they look. `?sample=box-stitch-10` opens one
scene directly, and [docs/links.md](../links.md) has one link per m×n face. Sending
someone *their* structure rather than a homepage is the whole difference between
a click and a bounce.

---

## The tracker

[pipeline.csv](pipeline.csv), thirteen columns. The script owns the first nine and
rewrites them freely; **the last four are yours and it will never touch them.**

| column | owner | values |
| --- | --- | --- |
| `kind` | script | `org` · `maintainer` · `person` |
| `handle` `url` `name` `where` `company` | script | identity, as GitHub reports it |
| `score` `signal` `why` | script | the ranking and what triggered it |
| `first_seen` | script | the sweep that surfaced it |
| **`status`** | **you** | `new` → `contacted` → `replied` → `won` · `rejected` · `dead` |
| **`owner`** | **you** | who is handling it |
| **`notes`** | **you** | what happened, and the date |

`rejected` means you decided against them; `dead` means they decided against you.
Keeping those apart is what tells you, six months in, whether the problem is the
list or the pitch.

---

## What working looks like

Set the bar where it belongs for a repo at zero stars. In the first three months:

- **Step 0 done** — a licence file, topics, a contributing guide, discussions on.
- **20 qualified leads** in `pipeline.csv`, of which **at least 6 Israeli**.
- **10 sent**, and a reply rate above 20%. Below 10% the pitch is wrong, not the
  list — rewrite the positioning before sending more.
- **One collaboration of any size**: a co-author on the enumeration result, a
  contributed PR, a lab that uses the studio in a class, or one company engineer
  who agrees to a call.
- **One talk or exhibit accepted** — Bridges, a maker faire, a museum, a guild.

And one kill criterion, so this does not become a hobby: **if three months of
this produces no reply from any Israeli organisation, the fit is not where it was
assumed to be.** Go back to [targets.md](targets.md) and re-derive the segments
from what did answer.
