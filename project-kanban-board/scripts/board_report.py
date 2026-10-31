#!/usr/bin/env python3
"""Print a Markdown status report for a board: progress by epic, what is
blocked or waiting (with reasons), awaiting testing or sign-off, overdue and
due in the next 14 days, work in progress, and open work per person.

    board_report.py path/to/board-project      # or path/to/data/board.json
    board_report.py path/to/board-project --since 2026-11-01

--since adds what was completed, and every status change, since that date,
from the tickets' status history (recorded from the first version of the board
that kept history; earlier changes are not known).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
sys.dont_write_bytecode = True  # keep the skill folder free of caches
from collections import Counter
from pathlib import Path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board", help="Board project directory, or a board.json path.")
    ap.add_argument("--since", help="YYYY-MM-DD: also report what changed since this date.")
    args = ap.parse_args(argv)
    if args.since:
        try:
            dt.date.fromisoformat(args.since)
        except ValueError:
            ap.error("--since must be a date written YYYY-MM-DD.")
    path = Path(args.board)
    if path.is_dir():
        path = path / "data" / "board.json"
    try:
        board = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read {path}: {exc}", file=sys.stderr)
        return 2
    cols = {c["id"]: c for c in board["columns"]}
    people = {p["id"]: p["name"] for p in board["people"]}
    tickets = board["tickets"]
    by_id = {t["id"]: t for t in tickets}
    kind = lambda t: cols[t["status"]]["kind"]  # noqa: E731
    cell = lambda text: str(text).replace("|", "\\|").replace("\n", " ")  # noqa: E731  (Markdown table cell)

    def local_day(ts):
        """History timestamps are UTC; compare them with --since in the user's own time zone."""
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().date().isoformat()
    who = lambda t: people.get(t.get("assignee"), "Unassigned")  # noqa: E731
    today = dt.date.today().isoformat()

    def root_epic(t):
        seen = set()
        while t and t["id"] not in seen:
            if t["type"] == "epic":
                return t
            seen.add(t["id"])
            t = by_id.get(t.get("parent"))
        return None

    work = [t for t in tickets if t["type"] != "epic"]
    done = sum(1 for t in work if kind(t) == "done")
    out = [f"# Status: {board['board']['title']}", ""]
    out.append(f"{done} of {len(work)} tasks and sub-tasks done ({round(100 * done / len(work)) if work else 0}%).")
    out.append("")
    out.append("| Column | Count |")
    out.append("| --- | --- |")
    for c in board["columns"]:
        out.append(f"| {cell(c['name'])} | {sum(1 for t in work if t['status'] == c['id'])} |")

    epics = [t for t in tickets if t["type"] == "epic"]
    if epics:
        out += ["", "## Epics", "", "| Epic | Status | Done | Blocked or waiting |", "| --- | --- | --- | --- |"]
        for e in sorted(epics, key=lambda x: x.get("order", 0)):
            kids = [t for t in work if root_epic(t) is e]
            d = sum(1 for t in kids if kind(t) == "done")
            stuck = sum(1 for t in kids if kind(t) in ("blocked", "waiting"))
            out.append(f"| {e['id']} {cell(e['title'])} | {cell(cols[e['status']]['name'])} | {d}/{len(kids)} | {stuck} |")

    def section(title, items, fmt):
        out.extend(["", f"## {title}", ""])
        if not items:
            out.append("None.")
        for t in items:
            out.append("- " + fmt(t))

    section("Blocked", [t for t in tickets if kind(t) == "blocked"],
            lambda t: f"**{t['id']}** {t['title']} ({who(t)}): {t.get('blockedReason') or 'no reason recorded'}")
    section("Awaiting action", [t for t in tickets if kind(t) == "waiting"],
            lambda t: f"**{t['id']}** {t['title']} ({who(t)}): waiting on "
                      f"{('[' + t['waitingFor'].replace('_', ' ') + '] ') if t.get('waitingFor') else ''}"
                      f"{t.get('waitingOn') or 'not recorded'}")
    section("Awaiting testing or sign-off", [t for t in tickets if kind(t) in ("testing", "signoff")],
            lambda t: f"**{t['id']}** {t['title']} ({who(t)}) in {cols[t['status']]['name']}")
    section("Overdue", sorted([t for t in tickets if t.get("due") and t["due"] < today and kind(t) != "done"], key=lambda t: t["due"]),
            lambda t: f"**{t['id']}** {t['title']} ({who(t)}), due {t['due']}")
    soon = (dt.date.today() + dt.timedelta(days=14)).isoformat()
    section("Due in the next 14 days", sorted([t for t in tickets if t.get("due") and today <= t["due"] <= soon and kind(t) != "done"], key=lambda t: t["due"]),
            lambda t: f"**{t['id']}** {t['title']} ({who(t)}), due {t['due']}, now in {cols[t['status']]['name']}")
    if args.since:
        col_name = lambda cid: cols[cid]["name"] if cid in cols else str(cid)  # noqa: E731
        changes = sorted(((e["at"], t, e) for t in tickets for e in t.get("history", []) if local_day(e["at"]) >= args.since),
                         key=lambda x: x[0])
        finished = []
        for at, t, e in changes:
            if cols.get(e["to"], {}).get("kind") == "done" and kind(t) == "done" and t not in finished:
                finished.append(t)
        section(f"Completed since {args.since}", finished, lambda t: f"**{t['id']}** {t['title']} ({who(t)})")
        out.extend(["", f"## Status changes since {args.since}", ""])
        if not changes:
            out.append("None recorded.")
        for at, t, e in changes:
            note = f" ({e['note']})" if e.get("note") else ""
            out.append(f"- {local_day(at)} **{t['id']}** {t['title']}: {col_name(e.get('from'))} to {col_name(e['to'])}{note}")
    section("In progress", [t for t in work if kind(t) == "in_progress"],
            lambda t: f"**{t['id']}** {t['title']} ({who(t)})")
    open_work = [t for t in work if kind(t) != "done"]
    load = Counter(who(t) for t in open_work)
    out.extend(["", "## Open work by person", "", "| Person | Open | In progress | Blocked or waiting |", "| --- | --- | --- | --- |"])
    for name, n in load.most_common():
        mine = [t for t in open_work if who(t) == name]
        out.append(f"| {cell(name)} | {n} | {sum(1 for t in mine if kind(t) == 'in_progress')} | "
                   f"{sum(1 for t in mine if kind(t) in ('blocked', 'waiting'))} |")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
