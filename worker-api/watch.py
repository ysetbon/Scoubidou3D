#!/usr/bin/env python3
"""
Watch the hands work, from a terminal, without the browser tab.

    # bash / zsh, from worker-api/
    WORKER_URL=https://mxn-solutions-api.<subdomain>.workers.dev \
    ADMIN_TOKEN=<token> ./watch.py [batch] [--once]

    # PowerShell, from worker-api\
    $env:WORKER_URL  = "https://mxn-solutions-api.<subdomain>.workers.dev"
    $env:ADMIN_TOKEN = "<token>"
    python watch.py [batch] [--once]

The farm page runs in a browser and its hands are Web Workers inside it, so
nothing about them is visible to a shell directly. What IS visible is the
queue: a hand writes its name into `runner` and a deadline into `lease_until`
every time it claims, so the rows say who is holding what and since when. That
is the same thing the page's own panels are reading, from the same place.

Read-only. Stdlib only. Ctrl-C to stop.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("WORKER_URL", "").rstrip("/")
TOKEN = os.environ.get("ADMIN_TOKEN", "")
EVERY = float(os.environ.get("EVERY", "5"))
# How many hands the page is running. Only used to say how many live leases are
# orphans; without it the count of distinct runner names is assumed, which is
# right unless a hand has orphaned every lease it holds.
HANDS = int(os.environ.get("HANDS", "0"))

# Where `done` stood when this started, so the dashboard can answer "is it
# moving" -- which a single frame cannot. Jobs here legitimately run over an
# hour, so a still `done` over five minutes says nothing and over ninety says
# everything.
SINCE = {"at": time.time(), "done": None}

def _ansi_works():
    """Windows consoles ignore escape codes until VT processing is switched on,
    and the oldest cannot do it at all -- there, printing them would spray the
    dashboard with literal noise, so go monochrome instead. Redirected output
    gets no codes either, which is what makes `--once > file` readable."""
    if not sys.stdout.isatty():
        return False
    if os.name != "nt":
        return True
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)          # STD_OUTPUT_HANDLE
        mode = ctypes.c_ulong()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(kernel32.SetConsoleMode(handle, mode.value | 0x4))
    except Exception:                                 # noqa: BLE001
        return False                                  # ENABLE_VIRTUAL_TERMINAL_PROCESSING


# The box-drawing and × in this dashboard are not in cp1252, which is still what
# a default PowerShell console encodes to. Ask for utf-8 and take replacement
# characters over a UnicodeEncodeError mid-sweep.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:                                     # noqa: BLE001
    pass

COLOUR = _ansi_works()
DIM, BOLD, RESET = ("\033[2m", "\033[1m", "\033[0m") if COLOUR else ("", "", "")
GREEN, YELLOW, RED, BLUE = (
    ("\033[32m", "\033[33m", "\033[31m", "\033[34m") if COLOUR else ("", "", "", ""))

STATE_COLOUR = {"running": GREEN, "pending": DIM, "done": BLUE, "failed": RED}


# urllib announces itself as Python-urllib/3.x, which Cloudflare's edge treats
# as a known automation signature and refuses with 403 error code 1010 before
# the request ever reaches the Worker. Naming ourselves honestly is enough --
# the check is against known-bad signatures, not for known-good ones. Override
# if an edge rule is ever stricter than that.
AGENT = os.environ.get("USER_AGENT", "mxn-farm-watch/1 (+worker-api/watch.py)")


def explain(code, body):
    """What a failure actually means. These four are wholly different problems
    and the browser shows the same red box for all of them."""
    if code == 401:
        return "the token was refused — check ADMIN_TOKEN against `wrangler secret list`"
    if code == 403:
        found = re.search(r"error code:\s*(\d+)", body)
        cf = found.group(1) if found else None
        if cf == "1010":
            return ("Cloudflare banned the client by its signature, before the Worker saw "
                    "it. Set USER_AGENT to something else and try again.")
        return f"Cloudflare refused the request at the edge{f' (code {cf})' if cf else ''}"
    if code == 404:
        return "no such route — is WORKER_URL right, and does it have no trailing path?"
    if code >= 500:
        return ("this is the D1 reset worker-api/doctor.sh is about: expected at a low "
                "rate, and the next tick will most likely answer")
    return ""


def get(path):
    """One GET. Network and HTTP errors are values, not exceptions: this thing
    runs for hours next to a farm that is itself surviving 500s, and dying on
    one is the opposite of what it is for."""
    request = urllib.request.Request(f"{BASE}{path}", headers={
        "Authorization": f"Bearer {TOKEN}",
        "User-Agent": AGENT,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response), None
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf8", "replace")
        # Cloudflare's own refusals are a full HTML page; the only part worth
        # showing is the code buried in it, which `explain` reads.
        note = explain(error.code, body)
        terse = re.sub(r"<[^>]+>", " ", body)
        terse = re.sub(r"\s+", " ", terse).strip()[:120]
        return None, f"HTTP {error.code} — {terse}" + (f"\n  {note}" if note else "")
    except Exception as error:  # noqa: BLE001 — timeouts, DNS, resets, all equal here
        return None, str(error)


def age(stamp):
    """Seconds since an ISO stamp, or None if it is not one."""
    if not stamp:
        return None
    try:
        when = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - when).total_seconds()


def clock(seconds):
    if seconds is None:
        return "—"
    seconds = int(seconds)
    sign = "-" if seconds < 0 else ""
    seconds = abs(seconds)
    if seconds < 60:
        return f"{sign}{seconds}s"
    if seconds < 3600:
        return f"{sign}{seconds // 60}m {seconds % 60:02d}s"
    return f"{sign}{seconds // 3600}h {(seconds % 3600) // 60:02d}m"


def blame(error):
    """The line of a traceback that says what went wrong.

    A Pyodide traceback opens with `File "/lib/python314.zip/_pyodide/_base.py"`
    and the exception is at the bottom, so showing the front of one shows the
    only part that is the same every time. Worse, the Worker keeps the first 500
    characters of the string (reportJob), so on a deep stack the bottom may be
    gone before it ever reaches here -- in which case the deepest frame named is
    the most specific thing left, and better than the first."""
    if not error:
        return "no error recorded"
    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
    if not lines:
        return "no error recorded"
    for line in reversed(lines):
        if not line.startswith(("File \"", "Traceback", "at ")) and "line " not in line[:12]:
            return line[:150]
    frames = [l for l in lines if l.startswith('File "')]
    return (frames[-1] if frames else lines[-1])[:150] + "  (truncated by the Worker)"


def size(n):
    n = float(n or 0)
    for unit in ("B", "kB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def draw(batch):
    query = f"?batch={batch}" if batch else ""
    summary, error = get(f"/farm/summary{query}")
    if error:
        return [f"{RED}the queue did not answer: {error}{RESET}"]
    jobs, error = get(f"/farm/jobs{query}&limit=400" if query else "/farm/jobs?limit=400")
    if error:
        return [f"{RED}the queue did not answer: {error}{RESET}"]

    rows = jobs.get("jobs", [])
    counts, totals = {}, {"seconds": 0.0, "bytes": 0, "artifacts": 0}
    for line in summary.get("summary", []):
        counts[line["state"]] = counts.get(line["state"], 0) + line["jobs"]
        for field in totals:
            totals[field] += line.get(field) or 0

    if SINCE["done"] is None:
        SINCE["done"] = counts.get("done", 0)
    gained = counts.get("done", 0) - SINCE["done"]
    watched = time.time() - SINCE["at"]
    moved = (f"{GREEN}+{gained} done{RESET}" if gained else
             f"{DIM}+0 done{RESET}" if watched < 3600 else f"{YELLOW}+0 done{RESET}")

    out = [
        f"{BOLD}batch {batch or '(all)'}{RESET}   "
        + "   ".join(f"{STATE_COLOUR.get(state, '')}{counts.get(state, 0)} {state}{RESET}"
                     for state in ("done", "running", "pending", "failed"))
        + f"   {DIM}·{RESET} {totals['artifacts']:.0f} artifacts"
        f"   {DIM}·{RESET} {size(totals['bytes'])} on the shelf"
        f"   {DIM}·{RESET} {clock(totals['seconds'])} of engine time banked",
        f"{DIM}watching {clock(watched)}:{RESET} {moved}"
        + (f"   {DIM}· a job on this sweep has been taking tens of minutes, so a still "
           f"count is not a stall yet{RESET}" if not gained and watched < 3600 else ""),
        "",
    ]

    # The hands, inferred from who holds what. A runner with a live lease is a
    # hand that is working; the page cannot tell you this any better than the
    # queue can, because the page is reading the same column.
    running = [r for r in rows if r.get("state") == "running"]
    held = {}
    for row in running:
        held.setdefault(row.get("runner") or "(unnamed)", []).append(row)

    # A live lease is the only evidence a hand exists. A dead one says 'running'
    # while nobody computes it: the machine slept, the tab closed, or the PATCH
    # reporting it done failed and was swallowed.
    left_on = lambda row: -(age(row.get("lease_until")) or 0)
    live = [r for r in running if left_on(r) > 0]
    dead = [r for r in running if left_on(r) <= 0]

    # A hand computes one job at a time, so N runner names cannot legitimately
    # hold more than N live leases. The excess are orphans: /farm/claim is an
    # UPDATE that commits before its response is sent, so a reply lost on the way
    # back -- a D1 reset, a dropped connection -- leaves the row claimed and
    # leased with no hand aware of it. The hand claims again; the orphan sits out
    # its full lease.
    #
    # WHICH of a runner's live rows is the real one is not derivable here: jobs
    # legitimately run for over an hour, so age does not separate them. Only the
    # page knows. So count the excess and name the rows, and do not pretend to
    # know which is which.
    hands = HANDS or len(held)
    orphans = max(0, len(live) - hands)

    if not running:
        out.append(f"{DIM}no job is held — every hand is idle, or none is running{RESET}")
    else:
        out.append(
            f"{BOLD}THE HANDS{RESET}  {DIM}{len(held)} runner name(s) holding "
            f"{len(live)} live lease(s){RESET}"
            + (f"  {YELLOW}· ≥{orphans} orphaned{RESET}" if orphans else "")
            + (f"  {DIM}· {len(dead)} expired{RESET}" if dead else ""))
        for runner in sorted(held):
            rows_held = sorted(held[runner], key=left_on, reverse=True)
            extra = max(0, len([r for r in rows_held if left_on(r) > 0]) - 1)
            for row in rows_held:
                left = left_on(row)
                seen = age(row.get("started_at"))
                if left <= 0:
                    mark, tint = "○", RED
                    note = f"{RED}lease expired{RESET} — claimable now"
                else:
                    mark, tint = "●", GREEN
                    note = f"lease {clock(left)} left"
                out.append(
                    f"  {tint}{mark}{RESET} {runner:<10} "
                    f"{row['m']}×{row['n']} ks {','.join(str(k) for k in json.loads(row['ks']))}"
                    f"   {DIM}first seen {clock(seen)} ago, tries {row.get('attempts')}{RESET}"
                    f"   {note}")
            if extra:
                out.append(f"    {YELLOW}↳ {runner} holds {extra + 1} live leases but can "
                           f"compute one. {extra} of these is an orphaned claim — the page "
                           f"says which one is real.{RESET}")

    if orphans or dead:
        out += ["", f"{YELLOW}{orphans + len(dead)} of {len(running)} 'running' rows have "
                    f"no hand on them.{RESET}",
                f"{DIM}Nothing to do: an expired lease is already claimable, and an orphan "
                f"frees itself when its lease runs out. Do NOT press 'Requeue stuck' while "
                f"hands are working — it resets every running row, the real ones "
                f"included.{RESET}"]

    failed = [r for r in rows if r.get("state") == "failed"]
    if failed:
        out += ["", f"{BOLD}FAILED{RESET}"]
        for row in failed[:8]:
            out.append(f"  {RED}✗{RESET} {row['m']}×{row['n']} "
                       f"ks {','.join(str(k) for k in json.loads(row['ks']))}   "
                       f"{DIM}{blame(row.get('error'))}{RESET}")
        if len(failed) > 8:
            out.append(f"  {DIM}… and {len(failed) - 8} more{RESET}")

    return out


def main():
    if not BASE or not TOKEN:
        sys.exit("set WORKER_URL and ADMIN_TOKEN first (see worker-api/README.md)")
    argv = [a for a in sys.argv[1:] if a != "--once"]
    batch = argv[0] if argv else "default"
    once = "--once" in sys.argv

    while True:
        lines = draw(batch)
        if once:
            print("\n".join(lines))
            return
        # Redraw in place rather than scrolling: this is a dashboard, and an
        # hours-long sweep would otherwise bury the terminal.
        sys.stdout.write("\033[H\033[J" if COLOUR else "\n" + "─" * 60 + "\n")
        print(f"{DIM}{datetime.now().strftime('%H:%M:%S')} · "
              f"every {EVERY:g}s · ctrl-c to stop{RESET}\n")
        print("\n".join(lines))
        sys.stdout.flush()
        try:
            time.sleep(EVERY)
        except KeyboardInterrupt:
            print()
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
