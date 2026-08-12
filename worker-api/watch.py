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
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("WORKER_URL", "").rstrip("/")
TOKEN = os.environ.get("ADMIN_TOKEN", "")
EVERY = float(os.environ.get("EVERY", "5"))

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


def get(path):
    """One GET. Network and HTTP errors are values, not exceptions: this thing
    runs for hours next to a farm that is itself surviving 500s, and dying on
    one is the opposite of what it is for."""
    request = urllib.request.Request(
        f"{BASE}{path}", headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response), None
    except urllib.error.HTTPError as error:
        detail = error.read()[:200].decode("utf8", "replace")
        return None, f"HTTP {error.code} — {detail}"
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
        return [f"{RED}the queue did not answer: {error}{RESET}",
                f"{DIM}(a lone 500 here is the D1 error worker-api/doctor.sh is about — "
                f"it will most likely answer next tick){RESET}"]
    jobs, error = get(f"/farm/jobs{query}&limit=400" if query else "/farm/jobs?limit=400")
    if error:
        return [f"{RED}the queue did not answer: {error}{RESET}"]

    rows = jobs.get("jobs", [])
    counts, totals = {}, {"seconds": 0.0, "bytes": 0, "artifacts": 0}
    for line in summary.get("summary", []):
        counts[line["state"]] = counts.get(line["state"], 0) + line["jobs"]
        for field in totals:
            totals[field] += line.get(field) or 0

    out = [
        f"{BOLD}batch {batch or '(all)'}{RESET}   "
        + "   ".join(f"{STATE_COLOUR.get(state, '')}{counts.get(state, 0)} {state}{RESET}"
                     for state in ("done", "running", "pending", "failed"))
        + f"   {DIM}·{RESET} {totals['artifacts']:.0f} artifacts"
        f"   {DIM}·{RESET} {size(totals['bytes'])} on the shelf"
        f"   {DIM}·{RESET} {clock(totals['seconds'])} of engine time banked",
        "",
    ]

    # The hands, inferred from who holds what. A runner with a live lease is a
    # hand that is working; the page cannot tell you this any better than the
    # queue can, because the page is reading the same column.
    running = [r for r in rows if r.get("state") == "running"]
    held = {}
    for row in running:
        held.setdefault(row.get("runner") or "(unnamed)", []).append(row)

    # A live lease is the only evidence a hand exists. A row whose lease has run
    # out says 'running' but nobody is computing it -- the machine slept, the tab
    # closed, or a PATCH reporting it done hit a 500 and was swallowed.
    live = [r for r in running if -(age(r.get("lease_until")) or 0) > 0]
    stuck = [r for r in running if r not in live]

    if not running:
        out.append(f"{DIM}no job is held — every hand is idle, or none is running{RESET}")
    else:
        out.append(
            f"{BOLD}THE HANDS{RESET}  "
            f"{GREEN}{len({r.get('runner') for r in live})} working{RESET}"
            + (f"  {YELLOW}· {len(stuck)} row(s) held by nobody{RESET}" if stuck else ""))
        for runner in sorted(held):
            for row in held[runner]:
                since = age(row.get("started_at"))
                left = -(age(row.get("lease_until")) or 0)
                stale = left <= 0
                mark = f"{RED}LEASE EXPIRED{RESET}" if stale else f"lease {clock(left)} left"
                out.append(
                    f"  {RED + '○' if stale else GREEN + '●'}{RESET} {runner:<10} "
                    f"{row['m']}×{row['n']} ks {','.join(str(k) for k in json.loads(row['ks']))}"
                    f"   {DIM}held {clock(since)}{RESET}   tries {row.get('attempts')}   {mark}")

    if stuck:
        out += ["", f"{YELLOW}{len(stuck)} stuck: 'running' with a dead lease. No hand is "
                    f"on them — they are claimable again and the next claim takes one. "
                    f"'Requeue stuck' on the page frees them all at once.{RESET}"]

    failed = [r for r in rows if r.get("state") == "failed"]
    if failed:
        out += ["", f"{BOLD}FAILED{RESET}"]
        for row in failed[:8]:
            out.append(f"  {RED}✗{RESET} {row['m']}×{row['n']}   "
                       f"{DIM}{(row.get('error') or '')[:110]}{RESET}")
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
