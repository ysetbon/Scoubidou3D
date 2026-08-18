---
name: termi
description: >
  Whenever anything needs to run on the user's own machine or any terminal this
  session cannot reach — pulling the repo, starting or restarting the local dev
  server, npm scripts and checks, PowerShell reads of the Cloudflare shelf,
  installing a tool, freeing a port, verifying a fix on localhost — write the
  EXACT terminal lines, in order, ready to paste, instead of describing steps in
  prose. Use this whenever the user says "on my machine", "locally",
  "localhost", "how do I run", "give me the commands", asks how to get a change
  onto their PC, or reports a problem whose fix involves them typing anything
  into a terminal. Also use it when a task ends with something the user must run
  themselves (e.g. "pull and restart to see it").
---

# termi — exact terminal lines, in order

This session runs in a sandbox. The user's machine, their dev server, and some
networks (for this repo: `mxn-solutions-api.ysetbon.workers.dev`) are out of
reach from here. When work lands on the user's side of that wall, the
deliverable is not advice — it is a block of terminal lines they can paste and
run top to bottom without editing, without guessing, and without reading a
paragraph to reconstruct the order.

The failure this skill exists to prevent: "pull the latest, reinstall if
needed, then restart the server" — three decisions handed to the user that the
page could have made. If they have to translate prose into commands, the
handoff failed.

## Know the machine before writing a line

- **This repo's user is on Windows PowerShell**, and the clone is at
  `$HOME\Scoubidou3D`. Do not ask which shell; do not offer a bash variant
  alongside "in case". (Stated in CLAUDE.md — reread it if in doubt.)
- A different target (a Linux server they mention, WSL, a CI box) gets that
  machine's shell. If the target is genuinely unknown, pick the most likely
  one, say which you assumed in one short line above the block, and move on —
  never block the answer on a shell question.
- Check before you write: command names, npm script names, ports, paths, and
  flags come from the repo (`package.json`, `docs/`, workflow files), not from
  memory. A handed-over line that errors on their machine costs a full
  round-trip; thirty seconds of grep here is cheaper.

## The block

One fenced code block per machine-and-purpose, tagged with the real language
(` ```powershell ` or ` ```bash ` — never bash-tag PowerShell). Inside it:

- **Complete**: start with `cd` into the right directory. Include every
  prerequisite (install, fetch, kill the old process). Assume nothing is
  already running or up to date unless the user said so.
- **In order**: stop old things → update → build/install → start → verify.
  A line must never depend on one that comes after it.
- **One command per line.** In Windows PowerShell 5.1 there is no `&&` or
  `||` — chaining silently breaks. Separate lines work in every shell and are
  easier to read when one fails.
- **No placeholders** unless truly unavoidable. If one is required
  (`<YOUR_TOKEN>`), put it on its own line and say directly under the block
  what goes there and where to find it. For this repo, remember: cache reads
  are public — never ask for a token to read.
- **Comments sparingly**, with `#`, only where a line would otherwise be
  mysterious. The block must stay paste-safe as a whole.
- **A verify line last** — the command or observation that proves it worked:
  an `Invoke-RestMethod`/`curl` that should return something specific, a URL to
  open, "you should see X". A handoff without a way to know it worked is half
  a handoff.

**Blocking commands end a block.** A dev server, a watcher, anything that does
not return — nothing after it in the same block, because nothing after it will
run. When work continues past it, split into labelled blocks:

    **Terminal 1 — leave this running:**
    ```powershell
    cd $HOME\Scoubidou3D
    npm run dev -- --port 5178 --strictPort
    ```

    **Terminal 2:**
    ```powershell
    cd $HOME\Scoubidou3D
    npm run qa:fit
    ```

Explanations live *around* the block, never interleaved with the commands.
Short intro above (what this does), notes below (what the output means, what
to send back). Non-terminal steps that belong to the sequence — "hard-reload
the page with Ctrl+Shift+R", "click Run" — go as numbered prose steps between
blocks, clearly not part of what gets pasted.

## PowerShell traps worth avoiding on sight

- `curl` and `wget` are aliases of `Invoke-WebRequest` — different flags,
  different output. Write `Invoke-WebRequest` / `Invoke-RestMethod` (or
  `curl.exe` when the real curl is genuinely wanted).
- No `&&` / `||` in 5.1 (see above). No `$(...)` command substitution the bash
  way, no single-quoted variable interpolation — `'$HOME'` stays literal.
- Paths use `\` and `$HOME`, not `~/`.
- **This repo's known trap**: a `/cache/…` read from the Worker returns
  gzipped bytes that `Invoke-RestMethod` will NOT decode — `.judgements` reads
  as `$null` and looks exactly like an empty shelf. The correct block lives in
  `docs/picks-shelf.md`; hand that one over rather than improvising.

## When it is a diagnosis, not just a task

If the commands are for finding out what is wrong (is the port taken? did the
pull work? what does the shelf hold?), end with one line asking the user to
paste the output back — and make the commands produce output worth pasting
(`git log --oneline -3` after a pull beats a bare `git pull`).

## This repo's canned sequences

Verified against `package.json` — prefer these over reinventing:

- **Get the latest and see it**: `cd $HOME\Scoubidou3D` → `git pull` →
  `npm ci` (only when `package.json`/lockfile changed in the pull; say which)
  → `npm run dev` → open `http://localhost:5173/Scoubidou3D/…` and
  hard-reload (Ctrl+Shift+R — the engine worker caches hard).
- **Checks that run without the engine**: `npm run check:ladder`,
  `check:fit`, `check:board`, `check:plan`, `check:boundary`, `npm run build`.
- **Engine checks (need Python + numpy)**: `npm run check:stack`, `check:l1`.
- **Page QA does NOT run on the user's PC as-is**: every `qa:*` and `*-shots`
  script imports Playwright from `/opt/node22/…` — a path that exists only in
  this sandbox. Do not hand `npm run qa:fit` to the user's Windows machine as
  if it will work. Either run the QA here and report results, or hand over the
  one-time setup honestly (install Playwright, change the import) as its own
  labelled block. This is the general rule in miniature: read the script
  before handing it over.
- **When a QA does run locally** (after that one-time fix): two terminals —
  dev server on port 5178 (`npm run dev -- --port 5178 --strictPort`) left
  running, `npm run qa:fit` in the second.
- **Shelf questions ("is my ★ best saved?")**: the ready-made PowerShell block
  in `docs/picks-shelf.md` — hand it over as-is and ask for the output back.
