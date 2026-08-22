# The messages

One per lead type, from the ask ladder in [README.md](README.md#the-ask-ladder).
They are short on purpose. Every one of them is built the same way:

> **their thing** → **the one capability that touches it** → **a link to that
> exact thing, not the homepage** → **an ask under fifteen minutes**

Replace every `⟨…⟩`. If you cannot fill `⟨the specific structure they build⟩`
with something you actually read on their site, the lead has not been qualified
and the message will read as a mass mailing — because it is one.

Deep links are the whole trick. `?sample=box-stitch-10` opens one scene directly,
and [docs/links.md](../links.md) has a link per m×n face. Send someone *their*
structure.

---

## 1 · Company engineer — the braided-structure pitch

> **Subject:** every interlacement that closes on an ⟨m×n⟩ face
>
> Hi ⟨name⟩,
>
> I saw that ⟨company⟩ ⟨the specific structure they build — "braids nitinol flow
> diverters", "overbraids composite pressure vessels", "builds radial braiders
> for medical tubing"⟩.
>
> I've built an open-source engine that takes a braided face of size m×n and a
> twist parameter, and returns **every continuation that is geometrically valid**
> — not a sample, the complete set, with the audit numbers for each. It's
> deterministic and it runs in a browser:
> ⟨https://ysetbon.github.io/Scoubidou3D/mxn/⟩
>
> There's also a 3D editor over the same model where a strand has real thickness,
> so over/under is physical rather than drawn: ⟨deep link to the closest sample⟩
>
> Two questions, and either answer is useful to me:
> 1. When you pick an interlacement pattern for ⟨their product⟩, is the
>    constraint that binds you geometric feasibility, machine capability, or
>    something else entirely?
> 2. Would fifteen minutes on a call be worth your time?
>
> It's GPL-3.0 and there's nothing to buy — I'm trying to find out whether what
> I've built solves a real problem or an imagined one.
>
> ⟨name⟩ · ⟨repo link⟩

**Why it is shaped like that.** Question 1 is answerable in one line by someone
who never takes the call, and its answer is worth more than the call would be.

---

## 2 · Same, in Hebrew — for Israeli companies

Adjust the register; this is deliberately plain. Send from a personal address,
not a form.

> **נושא:** כל השזירות האפשריות על פאה בגודל ⟨m×n⟩
>
> שלום ⟨שם⟩,
>
> ראיתי ש⟨שם החברה⟩ ⟨מה בדיוק הם מייצרים — "מייצרת סטנטים קלועים מניטינול",
> "עוטפת מכלי לחץ בסיבים קלועים"⟩.
>
> פיתחתי מנוע בקוד פתוח שמקבל פאה קלועה בגודל m×n ופרמטר פיתול, ומחזיר את **כל
> ההמשכים שתקפים גאומטרית** — לא מדגם, אלא הקבוצה השלמה, עם מספרי הביקורת לכל
> אחד. הוא דטרמיניסטי ורץ בדפדפן:
> ⟨https://ysetbon.github.io/Scoubidou3D/mxn/⟩
>
> יש גם עורך תלת־ממד מעל אותו מודל, שבו לגדיל יש עובי אמיתי — כך שמעל/מתחת הוא
> פיזי ולא מצויר: ⟨קישור ישיר לדוגמה הקרובה ביותר⟩
>
> שתי שאלות, וכל תשובה תעזור לי:
> 1. כשאתם בוחרים תבנית קליעה ל⟨המוצר שלהם⟩ — מה האילוץ שבאמת מגביל אתכם:
>    היתכנות גאומטרית, יכולת המכונה, או משהו אחר?
> 2. שווה רבע שעה של שיחה?
>
> הכל GPL-3.0 ואין פה שום דבר למכור. אני מנסה להבין אם פתרתי בעיה אמיתית או
> מדומיינת.
>
> ⟨שם⟩ · ⟨קישור לריפו⟩

---

## 3 · Researcher — the enumeration result

> **Subject:** exhaustive continuation counts for m×n braided faces — does this
> match your model?
>
> Dear ⟨Prof. name⟩,
>
> I read ⟨their specific paper, with the year⟩ and ⟨the one sentence of it that
> touches this — a bound, a conjecture, an enumeration, an open question⟩.
>
> I have an engine that enumerates every geometrically valid continuation ring
> for an m×n braided face at a given twist parameter, walked to an exact count
> rather than a sampled one, for sizes 1×1 through 8×8 in both handednesses. The
> results are precomputed and browsable: ⟨https://ysetbon.github.io/Scoubidou3D/mxn/ks/⟩
>
> Two things I cannot answer alone, and would rather ask than guess:
> - Does the growth of the valid-ring count with m and n match anything in the
>   existing weaving/interlacement literature?
> - The search uses a pair-extension ceiling of 200 and a ±20° angle window,
>   both of which are provisioned guesses. Measured, nothing valid at 3×4 or
>   below needs an extension past ~70. Is there a principled bound here?
>
> All the data is open and I'm glad to dump it in whatever format is useful. If
> there is a result in it, I'd rather it were a joint one than mine.
>
> ⟨name⟩ · ⟨repo link⟩

**Why it works.** It offers a dataset and asks a question the recipient is
uniquely able to answer. That is a collegial email, not a pitch.

---

## 4 · OSS maintainer — open an issue, do not email

Post it as a GitHub issue or discussion on *their* repo. Public, short, and
offering work rather than asking for it.

> **Title:** would a 3D over/under viewer be useful to ⟨project⟩?
>
> Hi — ⟨project⟩ ⟨what it does, in their words, from their README⟩.
>
> I maintain [Scoubidou3D](https://github.com/ysetbon/Scoubidou3D), which renders
> interlaced structures in 3D with real strand thickness — layer order becomes
> physical height, and each crossing genuinely lifts and dips rather than being
> masked. It's TypeScript + three.js, GPL-3.0, and it already imports one strand
> format.
>
> Reading ⟨their format / their file / their data model⟩, a converter looks like
> ⟨your honest estimate of the work⟩.
>
> Would that be interesting to you? I'm happy to write it as a PR here, keep it
> in my repo, or drop it — genuinely fine with any of the three, I just don't
> want to build it if you'd rather it didn't exist.

Never open by asking for a link or a star. Offer the work first.

---

## 5 · Teacher, museum, science centre

> **Subject:** a free 3D weaving tool for ⟨their programme⟩, no install
>
> Hi ⟨name⟩,
>
> ⟨The specific thing they run — a weaving workshop, a symmetry exhibit, a
> maths-and-craft holiday programme.⟩
>
> I built a free browser tool where you can weave in 3D and spin it around:
> ⟨https://ysetbon.github.io/Scoubidou3D/app/⟩
>
> - nothing to install, works on a phone, no accounts, nothing uploaded
> - every sample has its own link, so a worksheet can point at one structure —
>   e.g. the classic box-stitch lanyard: ⟨.../app/?sample=box-stitch-10⟩
> - open source and free forever (GPL-3.0)
>
> The pitch to a class is that the over/under is real: the lace physically lifts
> and dips, so you can turn the model on its side and *see* why a weave holds
> together. It goes with a physical lanyard in a way a flat drawing doesn't.
>
> Would it be useful to you? I'd happily build whatever's missing for a classroom
> — and I'm in ⟨city⟩ if a visit is easier than an email.
>
> ⟨name⟩

The last line is only for Israeli leads, and it is the strongest line in the
message. Use it.

---

## 6 · Craft community — post the artefact, not the link

For a guild forum, a subreddit, a Discord, a Facebook group. Do not write an
advert. Post the picture of *their* stitch and answer questions.

> The box stitch, in 3D, where the laces actually go over and under each other —
> you can spin it: ⟨deep link⟩
>
> I made this because every diagram of a lanyard stitch is flat, and flat is
> exactly the thing that's hard to follow. Here the layer order is real height,
> so ⟨the specific thing that is hard to see in a flat diagram, e.g. how the last
> arm tucks under the first⟩ is visible from the side.
>
> Free, in the browser, nothing to install. There are ⟨n⟩ stitches in there
> already — if yours isn't, tell me which and I'll add it.

The closing offer is the point. It converts a post into a conversation and gives
you the next sample to build.

---

## 7 · Conference abstract — the skeleton

For Bridges, a fibre-arts conference, a maker faire, a Gathering 4 Gardner.

- **Title.** Name the object, not the technique. "Every way a lanyard can
  continue" beats "A WebGL system for parametric interlacement".
- **The hook, one sentence.** A craft object that everyone in the room has held,
  and a question about it nobody has answered.
- **The result.** The exhaustive enumeration, and one number from it that is
  surprising.
- **The artefact.** A live browser demo and physical lanyards on the table. For
  this audience the physical objects do more work than the slides.
- **The link.** One URL, deep-linked to the exact structure discussed.

---

## 8 · Funder / grant one-pager — the order matters

Do not send this until the first two items exist. In this order:

1. **The working thing**, with a link that works on their phone.
2. **The result** — the enumeration, ideally with an academic co-author's name
   next to it.
3. **The named industrial partner** who has said, in writing, that they would use
   it.
4. Only then: what the money is for, in months and deliverables.

A grant application that opens at item 4 is asking a committee to imagine items
1–3. They will not.
