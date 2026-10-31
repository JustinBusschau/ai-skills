#!/usr/bin/env python3
"""Look up what the manager already decided, before raising a proposal again.

    proposals.py <board-dir> list                 every proposal key with its latest status and date
    proposals.py <board-dir> check <key>          should a proposal with this key be raised now?

A proposal's `key` identifies the question, whatever run raised it:
"move-back:RCP-4", "fix:<repo-id>:<slug>", "other:<short-slug>". `check`
answers, from every run's proposals.json:

  raise    never raised, or declined more than 7 days ago
  open     already open: repeat it with the same id, do not raise a new one
  wait     declined within the last 7 days: do not raise it (say so only if
           it now holds back a ticket it did not before)
  never    dismissed: do not raise it again

and exits 0 for raise, 1 otherwise.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys

from auditlib import board_paths, run_dirs


def history(paths) -> dict:
    """key -> latest {status, run, id, summary}, later runs winning."""
    latest = {}
    for run in run_dirs(paths):
        try:
            items = json.loads((run / "proposals.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for p in items:
            key = p.get("key") or (f"{p.get('kind')}:{p['ticket']}" if p.get("ticket") else None)
            if key:
                latest[key] = {"status": p.get("status", "open"), "run": run.name, "id": p.get("id"),
                               "summary": p.get("summary", "")}
    return latest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("action", choices=("list", "check"))
    ap.add_argument("key", nargs="?")
    args = ap.parse_args(argv)
    hist = history(board_paths(args.board_dir))
    if args.action == "list":
        for key, h in sorted(hist.items()):
            print(f"{key:40} {h['status']:10} {h['run'][:10]}  {h['summary']}")
        return 0
    if not args.key:
        ap.error("check needs a key, such as move-back:RCP-4")
    h = hist.get(args.key)
    if h is None:
        print("raise: never raised before")
        return 0
    age = (dt.date.today() - dt.date.fromisoformat(h["run"][:10])).days
    if h["status"] == "open":
        print(f"open: already open as {h['id']} since {h['run'][:10]}; repeat it with that id")
    elif h["status"] == "dismissed":
        print(f"never: dismissed on {h['run'][:10]}")
    elif h["status"] == "declined" and age <= 7:
        print(f"wait: declined {age} day(s) ago")
    elif h["status"] == "approved":
        print(f"open: approved on {h['run'][:10]}; if it still applies, it was not carried out, so check why")
    else:
        print(f"raise: last {h['status']} on {h['run'][:10]}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
