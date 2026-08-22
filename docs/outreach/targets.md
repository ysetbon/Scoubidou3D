# The target list

Built August 2026 by the sweep in [README.md](README.md): seven parallel segment
searches, each one then re-checked by a second pass whose instruction was to
*refute* it. 147 candidates went in; what is below is what survived, ranked.

**Israel is first because it converts differently.** The author is in Israel, so
for an Israeli lead the ask can be "can I come and show you" rather than "can we
schedule a call across five time zones", and the reply rate for those two
sentences is not comparable. An Israeli lead of medium fit outranks a foreign
lead of high fit for that reason alone.

## How to read a row

| tier | meaning |
| --- | --- |
| **A** | act this month. The fit is specific, the route is real, the ask is small |
| **B** | act this quarter, or when the thing it is waiting on exists |
| **C** | real, but the fit is a hypothesis — confirm something before writing |

Each row names **which asset** ([studio](README.md#1--the-studio--a-3d-authoring-and-viewing-tool-for-overunder-structure)
or [MXN engine](README.md#2--the-mxn-engine--exhaustive-enumeration-of-feasible-interlacements))
and **the ask**. If a row's "why" could be sent to a different company unchanged,
it is a bug — fix the row rather than the email.

### On the evidence, and how much to trust it

Everything here has at least one public source. Two limits, both worth knowing
before you rely on a row:

**Direct page fetches were blocked for every host except GitHub.** So most
evidence is search-result-level rather than read-off-the-company-site. Where a
claim rests on an inference rather than a quote, the row says so.

**Only two of the seven segments were verified at all.** The refutation pass ran
out of session budget partway through. Where it did run it could not fetch pages
either, so it was reduced to refuting candidates from internal consistency and
prior knowledge — which turned out to be *more* useful than it sounds: reasoning
alone killed six leads that looked perfect, mostly by noticing that the device in
question was knitted, laser-cut, or a single wire rather than a braid.

| segment | verified? |
| --- | --- |
| Braiding machinery and composites | yes — reasoning only, no live fetches |
| Braided medical devices | yes — reasoning only, plus a manual pass on the Israeli rows |
| Textile CAD and digital fabrication | **no** |
| Braid and knot mathematics | **no** |
| Education, museums, craft | **no** |
| GitHub and open source | **no** |
| The dedicated Israel sweep | returned nothing — see [below](#what-could-not-be-established) |

So: **no row here is fact-checked to the standard of "someone loaded the page"**,
and four segments have had no adversarial pass whatever. Treat a Tier A row as
"worth twenty minutes of confirming", not as "ready to send" — and treat the four
unverified segments as a list of things to check rather than a list of things
that are true.

The rule that saved this document: an organisation is only a lead if the thing it
makes is *many strands crossing over and under each other*. Knitting is loops.
Winding is one strand. Laser-cutting is a solid with holes in it. None of those is
what this repo models, and each of them killed a lead that had already been
written up as promising.

---

# Israel first

## The single best lead: CodedMatter Lab, Technion

**Yoav Sterman**, Faculty of Architecture and Town Planning, Technion, Haifa ·
<https://codedmatter.technion.ac.il/> · **Tier A · studio · collaborator**

Sterman came from MIT Media Lab's Mediated Matter group and built Nike FlyPrint,
the first 3D-printed textile for performance footwear. In November 2024 he
published, with textile designer **Gali Cnaani** of Shenkar, a **three-dimensional
adjustable weaving reed** — a loom part that breaks the fixed orthogonal
warp/weft angle, so warp and weft need no longer meet at 90° and warp density can
vary across the width.

That is the strongest fit in this entire document, and here is exactly why: **no
mainstream weaving CAD can draw what their reed makes.** A weaving draft is an
orthogonal grid by construction. The studio is not — it places ribbons with real
width and thickness at arbitrary headings, bridges attached strands across a
layer gap, and makes layer order into physical Z. A non-orthogonal,
variable-density interlacement can be authored and seen in it before the next
reed is machined.

It is also an hour away by train.

> **The ask:** "You made the crossing angle a design variable and there is no
> drawing tool that follows you there. Can I show you one? Half an hour, at your
> lab." Attach a render of a non-orthogonal weave built in the studio — build it
> first, do not promise it.

*Evidence:* [lab](https://codedmatter.technion.ac.il/) ·
[Technion profile](https://t3.technion.ac.il/researcher/yoav-sterman/) ·
[the reed paper, J. Textile Design Research and Practice, 2024](https://www.tandfonline.com/doi/abs/10.1080/20511787.2024.2420385)

---

## Braided medical devices — the densest cluster in the country

Israel's neurovascular sector is unusually deep, and a neurovascular device is
very often *a braid*: a mesh whose pore size, wall apposition and radial force all
follow from wire count and crossing pattern. This is the only segment where the
repo has a straightforwardly commercial story.

Be honest with yourself about what is being offered. This is **not** an FEA tool
and **not** a regulatory one, and saying so early is what makes the rest credible.
What it does is *early-stage pattern exploration*: enumerate the interlacements
that are geometrically constructible at all, and show them in 3D with real wire
thickness.

| tier | company | where | what makes it a braid problem | asset |
| --- | --- | --- | --- | --- |
| **A** | **Rapid Medical** | Yokneam | Tigertriever is a wire-braided stent retriever whose **diameter the operator changes mid-procedure**. The braid must stay valid across a whole adjustment range, not at one diameter — pitch, pore size and crossing angle all move together | both |
| **A** | **Perflow Medical** | Netanya | The platform is literally named after the braid — "Cerebral Net", a braided net with physician-controlled real-time expansion. Stream 17 targets tortuous anatomy, where the count of usable interlacements collapses and enumeration beats intuition | both |
| **A** | **Vascular Graft Solutions** | Tel Aviv | VEST is an external sheath of **braided cobalt-chromium** over a vein graft — peer-reviewed sources use exactly that phrase. One product, geometry-defined, small company: the most realistic first design partner in the country | both |
| **B** | **LuSeed Vascular** | Petah Tikva | A dense braided mesh that **inverts on deployment** — the same interlacement must stay closed and non-self-intersecting through an inside-out transformation. Founded 2017, site live, still presenting at 2026 conferences, but early-stage (incubator funding). *The braid claim rests on the title of their granted US patent, "Inverting braided aneurysm implant with dome feature" — read their product page before writing* | both |

**The three Tier A rows are the ones where the braid is unambiguously the
product.** Start there and do not dilute the batch with the rest.

### Checked and ruled out — do not rediscover these

The single most useful thing verification did was kill leads. Each of these looks
like a braided-device company and is not one, for a reason worth remembering:

| company | why it is not a lead |
| --- | --- |
| **EndoStream Medical** (Kaneka), Or Akiva | Nautilus is **one nitinol wire covered with a platinum coil sleeve**, sized by the diameter of its spiral. A single-wire spiral is not a multi-strand interlacement — there is no over/under to enumerate. Tempting because Kaneka bought them for ~$100M and kept the Israeli R&D hub, but the money is not attached to a braid problem |
| **InspireMD**, Tel Aviv R&D | MicroNet is a **single-fibre *knitted* PET mesh** (20–25 µm fibre) sutured over a laser-cut frame. Knitting is loops, not interlacement; the repo models neither. Corporate HQ has also moved to Miami |
| **Ceretrieve**, Yokneam | CathTrap's tip is described as "expandable", never as a braid. The fit was an inference layered on an unsupported premise |
| **Endospan** (Artivion), Herzliya | Woven polyester graft fabric sewn to a nitinol frame — a plain, dense, industry-standard textile with nothing to enumerate |
| **Medinol**, Jerusalem | Laser-cut stents. Mature product line, no braid |
| **Bendit Technologies**, Petah Tikva | Steerable microcatheters *probably* use braid reinforcement, as most do — but Bendit publishes nothing about their own, so the entire fit is a guess about a stranger's engineering. Park it until they publish or someone tells you |

> **The ask, for all of them:** the two questions in
> [templates.md § 1](templates.md#1--company-engineer--the-braided-structure-pitch).
> Question one — "is the constraint that binds you geometric feasibility, machine
> capability, or something else?" — is answerable in one line by someone who will
> never take the call, and that answer is worth more than the call.

**Not yet checked:** the braiding *contract manufacturers* and wire suppliers that
serve this cluster. A search for Israeli wire-rope and braided-sleeve
manufacturers returned nothing substantiable. Treat that as an open question, not
as an absence.

---

## Textile, design and the schools

| tier | who | where | why | asset |
| --- | --- | --- | --- | --- |
| **A** | **Shenkar — Department of Textile Design** | Ramat Gan | ~240 students across three tracks, one of which is explicitly technological: "new structures in weaving or in knitting". Gali Cnaani is here, and is the co-author on the Technion reed paper — **the same conversation reaches both institutions** | studio |
| **B** | **CIRTex**, Shenkar | Ramat Gan | Israel's national textile innovation centre, with accredited testing labs and a route to Israeli technical-textile companies. *Credibility and audience more than technical fit — check their current project list before claiming an overlap* | studio |
| **B** | **Browzwear** · **Optitex** | Tel Aviv | The two Israeli 3D-apparel-CAD companies. They simulate draped cloth, not interlacement structure, so this is not a product fit — it is an **advice fit**: people who have already sold 3D textile software to industry and know what that market pays for | studio |
| **C** | **Tama Group** | Kibbutz Mishmar Ha'Emek | Global netting and net-wrap manufacturer. Their nets are extruded and knitted rather than braided, so the fit is weak — but they are a serious Israeli technical-textile company and worth one conversation | studio |

---

## Mathematics

Four Israeli mathematicians came out of the braid/knot sweep. None of them works
on *weaving*, which is the point: the MXN enumeration is a combinatorics result
that has not met a combinatorialist yet.

| tier | who | where | field |
| --- | --- | --- | --- |
| **A** | **Mina Teicher** | Bar-Ilan, Ramat Gan | Computational aspects of the braid group, and applications; has organised international workshops on braid-group techniques. The closest match in Israel to "someone who would know whether this enumeration is new" |
| **B** | **Michael Polyak** | Technion, Haifa | Low-dimensional topology, knot invariants |
| **B** | **Tahl Nowik** | Bar-Ilan, Ramat Gan | Topology |
| **B** | **Ruth Lawrence** | Hebrew University, Jerusalem | Braid group representations, knot theory |
| **B** | **Michael Brandenbursky** | Ben-Gurion, Be'er Sheva | Braid groups, quasi-morphisms |
| **B** | **Israel Mathematical Union** annual meeting | — | A domestic talk, cheap to give, and the fastest way to find out if the result is known |

> **The ask:** [templates.md § 3](templates.md#3--researcher--the-enumeration-result).
> Lead with the two questions you genuinely cannot answer — whether the growth of
> the valid-ring count is known, and whether there is a principled bound to
> replace the guessed 200-step extension ceiling and ±20° window. A mathematician
> who cannot resist an open question is the best co-author available.

---

## Museums, outreach and money

| tier | who | where | why |
| --- | --- | --- | --- |
| **A** | **Israel Innovation Authority — Tnufa (Ideation)** | — | Up to **NIS 200,000**, 80% of approved budget, 12 months. Open to *individual entrepreneurs resident in Israel* — **no company required, no equity taken, and you do not have to leave your job.** It funds prototype, IP and business development. This is the single most concrete funding route in this document and it is written for exactly this situation |
| **A** | **Davidson Institute of Science Education**, Weizmann | Rehovot | The country's science-education arm, with real reach into classrooms. A free, install-free, phone-capable 3D weaving tool with per-sample deep links is precisely the shape of thing they distribute |
| **B** | **Bloomfield Science Museum** | Jerusalem | Interactive-exhibit museum since 1992. The studio runs on a touchscreen with no IT work |
| **B** | **MadaTech** | Haifa | Israel's national science museum |

> On Tnufa, the order in [templates.md § 8](templates.md#8--funder--grant-one-pager--the-order-matters)
> matters: the working demo, then the result, then a named industrial partner,
> then the money. Two of those three already exist.

---

## Israeli composites and defence — an open lane

The dedicated Israel sweep failed (see [below](#what-could-not-be-established)),
and this is the vertical that suffered. What was established: Israel's composites
industry includes **Israel Aerospace Industries** (Lod), **Kanfit** (Migdal
HaEmek), **FBM** (Kiryat Gat) and **Elbit-Cyclone** (Karmiel), per
[CompositesWorld's survey](https://www.compositesworld.com/articles/high-performance-composites-in-israel).

What was **not** established is whether any of them braids or overbraids rather
than laying up and winding — and that distinction is the whole fit. **Do not
write to them until you know.** One afternoon on their capability pages settles
it, and if any one of them does overbraiding, it belongs at the top of this
section rather than at the bottom.

---

# Outside Israel

## Tier A — the research groups who own this space

These are collaborators, not customers, and they are the fastest route to
credibility. Every one of them maintains a tool that overlaps this repo, which
means they will understand the contribution in one paragraph.

| who | where | the tool they own | the specific opening |
| --- | --- | --- | --- |
| **Prof. Yordan Kyosev** — ITM, TU Dresden, and TexMind | Dresden | **TexMind Braider** and the Braiding Machine Configurator | The closest thing to a direct counterpart alive. He models braided structures commercially; the MXN engine enumerates the feasible set his configurator asks users to choose from |
| **Composites Research Group** — University of Nottingham | UK | **TexGen**, the open-source textile-geometry schema | An open-source, GPL-adjacent project with a file format. A converter is a concrete, offerable piece of work |
| **Composite Materials Group** (Stepan Lomov) — KU Leuven | Belgium | The **WiseTex** suite | The academic standard for internal textile geometry |
| **ITA**, RWTH Aachen | Germany | Braiding research and machinery | Europe's largest textile-tech institute |
| **University of Twente** — Production Technology | Netherlands | **BraidSim** | Braid process simulation |
| **AdaCAD / Unstable Design Lab** (Laura Devendorf), CU Boulder | USA | **AdaCAD** — parametric weave drafting | Already the top hit of the repo's own GitHub sweep. Open source, active, and the nearest philosophical sibling: parametric design applied to drafting. **Open an issue, do not email** |
| **CMU Textiles Lab** (James McCann) | USA | **Knitout**, `show-braid`, solid-knitting UI | They have literally published a braid viewer. The one group most able to say whether the ribbon-with-thickness approach is novel |
| **Matsumoto Lab** (Sabetta Matsumoto), Georgia Tech | USA | Physics and geometry of knitting and textiles | Publishes and speaks widely on textile topology; a strong amplifier as well as a collaborator |
| **CITA**, Royal Danish Academy (Phil Ayres) | Denmark | Architectural braided structures | Builds braided architecture at scale |

## Tier A — braided-device and preform makers

| who | where | why |
| --- | --- | --- |
| **A&P Technology** | Cincinnati, USA | Product lines *defined by interlacement architecture* — BIMAX biaxial ±45°, QISO triaxial, ZERO unidirectional — plus overbraided preforms for the GE GEnx fan case and Boeing 787 frames. If enumeration of feasible interlacements is worth money anywhere, it is here. *The product names are solid; a 2026 partnership announcement cited in the research is unverified — do not quote it back at them* |
| **HERZOG** | Oldenburg, Germany | The braiding-machine maker, with its own CAB Design software. A machine vendor is an amplifier as much as a customer: their customers are all of the above |
| **Confluent Medical**, **Secant Group**, **US BioDesign**, **Integer / Aran Biomedical** | USA, Ireland | The contract braiders behind most of the world's braided implants. They braid to a spec someone else drew, which is exactly the drawing this repo makes |
| **phenox**, **Acandis**, **Occlutech**, **Anaconda Biomed** | Germany, Spain | European braided-neurovascular makers — the same pitch as the Israeli cluster, one time zone away |

## Amplifiers with dates attached

These have deadlines, which makes them the only items here that can be *late*.

| who | what | note |
| --- | --- | --- |
| **The Bridges Organization** | Math-art conference, peer-reviewed papers, workshops and an art exhibition | The 2026 programme already carried braiding and weaving work — Borromean braid crossings, magic leatherworking braids, a paper-weaving paper, a weave-simulation workshop. That is a named, live audience. **Submit a paper on the MXN enumeration plus a hands-on workshop run on attendees' own phones** — "no install" is the entire pitch for a workshop room |
| **IMAGINARY** | Open-source maths exhibition platform used by museums in 50+ countries | Explicitly solicits browser-runnable exhibits. **Watch out:** their module terms want Creative Commons, and this repo is GPL-3.0 with no LICENSE file — settle the licensing before approaching, or the submission stalls on legals |
| **Journal of Mathematics and the Arts** · **Interlace: A Journal of Mathematics and Fiber Arts** | Publication routes | *Interlace* is named after the subject |
| **The Braid Society** · **Handweavers Guild of America** · **American Kumihimo Society** | Guilds with newsletters and conferences | The craft audience, already organised. Post the artefact, not a link — [templates.md § 6](templates.md#6--craft-community--post-the-artefact-not-the-link) |
| **MoMath** · **Exploratorium Tinkering Studio** · **Mathematikum** | Museums | Same pitch as the Israeli museums, larger rooms |
| **Gathering 4 Gardner** · **Maker Faire** | Recreational-maths and maker events | Physical lanyards on the table do more work than the slides |

## GitHub — where the first contributor actually comes from

Found by `npm run prospect` and by the OSS segment. The full ranked list is in
[pipeline.csv](pipeline.csv).

| repo | why |
| --- | --- |
| **UnstableDesign/AdaCAD** | Parametric weave drafting, active, open source. Top of the sweep by score |
| **textiles-lab** (CMU) — `show-braid`, solid-knitting-ui | A braid viewer already exists there |
| **jamespbarrett/tabletweave**, **Demonsthere/weavesmith**, **leifrogers**, **gg314**, **adrianhensler**, **Vojtech-Janku**, **Hafting**, **tomvej** | Weaving-draft and tablet-weaving tools — the maintainers most likely to want a 3D viewer and least likely to have built one |
| **baptistelabat/braidpy**, **rexgreenway/braid-visualiser**, **lennart-finke/knottingham**, **Mathesis-Software/Knots** | Braid-word and knot libraries. A braid word is an input format this engine could read |
| **mrdoob/three.js**, **spite/THREE.MeshLine** | The ribbon sweep with a fixed frame instead of Frenet frames is a genuinely reusable technique, and three.js collects showcases |
| **pyodide/pyodide**, **pyscript** | The MXN lab is a substantial real-world Pyodide case study: 11k lines of Python in a Web Worker, plus a precompute-and-cache architecture. These communities actively collect such write-ups |
| **OpenStrandStudio / OpenStrandJS stargazers** | The warmest names that exist — they already starred this exact strand model. `npm run prospect --people` lists them |

---

## What could not be established

Reporting the holes, because a target list that hides them gets trusted more than
it should.

- **The dedicated Israel sweep returned zero rows.** Its web-search budget was
  exhausted by the six segments that ran before it, and direct page fetches were
  blocked for every host except GitHub. It correctly refused to write leads from
  memory rather than inventing evidence URLs. The Israeli rows above therefore
  come from the *other* six segments plus a manual pass — which is why
  **composites and defence is thin, and Israeli braiding contract manufacturers
  are entirely uncovered.** Re-run that segment with a fresh search budget.
- **Whether any Israeli composites firm actually braids.** See above.
- **Israeli wire-rope, braided-sleeve and cable-braiding manufacturers.** Searched,
  nothing substantiable returned. Probably a search-phrasing failure rather than
  an empty market — the vertical exists everywhere else.
- **Several medtech fit claims are inferences, not quotes** — Bendit, Ceretrieve
  and EndoStream are flagged inline. Check before writing, not after.
- **Four of the seven segments were never adversarially checked**, and the
  completeness critic — the pass whose whole job was to name what the seven
  segments missed and go find it — never ran. Both stopped on session limits.
  So the gaps below are *my* enumeration of what looks missing, not a researched
  finding.
- **Industries never swept at all:** jewellery and chain-making, hair braiding,
  fencing and mesh, filtration, furniture caning, sports stringing, marine rope,
  tyre cord, hose reinforcement, architectural façades. Each is an interlacement
  industry; none was searched even once.
- **Reach routes never enumerated:** which mailing list, Discord, subreddit or
  LinkedIn group each audience actually reads, and which conference CFPs are open
  right now with what deadline.

The next run of this workflow should start with those three bullets, not with a
fresh sweep of the segments that already produced 147 rows.
