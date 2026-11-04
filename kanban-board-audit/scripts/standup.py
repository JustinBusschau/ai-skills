#!/usr/bin/env python3
"""Write a stand-up-ready progress update for a board.

    standup.py <board-dir> [--run-dir audits/<run>] [--since YYYY-MM-DD[THH:MM:SS]]
    standup.py <board-dir> --new-run

Reads the run folder's scan.json (the latest run unless --run-dir), and
writes standup.md into it. --new-run creates a fresh run folder without
scanning (for going through decisions), so an earlier run's stand-up is never
overwritten; record decisions in its proposals.json, then run standup.py
again with --run-dir.

Covers what was completed and what moved since --since (from the tickets'
status history), commits naming tickets in that period, what is in progress
now, what is blocked or waiting and on whom, test and build health from the
scan, tickets still needing evidence, and the decisions waiting for the board
manager (from proposals.json, written by the audit). --since defaults to the
scan's own --since, or yesterday. Prints the path written.

proposals.json is a list of {"id": "...", "kind": "move-back" | "fix" |
"other", "ticket": "KEY" (optional), "summary": "...", "evidence": "..."
(optional), "key": "move-back:RCP-4" (stable across runs; see proposals.py),
"status": "open" | "approved" | "declined" | "dismissed" | "superseded"
(missing means open)}. A proposal the board has overtaken is closed by
repeating its id with status "superseded" in a later run's file.
Open proposals from earlier audits are carried forward until decided, so a
decision is never lost because a newer audit ran. Changes the audit made
itself (recorded with edit_board.py --actor audit) are listed apart from the
team's.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # set before importing auditlib, so no cache lands in the skill
from auditlib import KANBAN, board_paths, latest_run_dir, load_board, new_run_dir, run_dirs


def to_utc(value):
    """A date or timestamp (local if it has no offset) as an aware UTC datetime."""
    d = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.astimezone()  # naive values are local time
    return d.astimezone(dt.timezone.utc)


def open_and_recent_proposals(paths, run_dir: Path):
    """Every proposal still open in any run, plus this run's decided ones; later runs win for the same id."""
    merged = {}
    files = [r / "proposals.json" for r in run_dirs(paths) if (r / "proposals.json").exists()]
    for f in files:
        try:
            items = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for i, p in enumerate(items):
            pid = p.get("id") or f"{f.parent.name}#{i}"
            merged[pid] = {**p, "id": pid, "day": f.parent.name[:10], "run": f.parent.name}
    return [p for p in merged.values() if p.get("status", "open") == "open" or p["run"] == run_dir.name]


FAILURE_HINTS = re.compile(r"(FAIL|ERROR|Error:|AssertionError|✕|●|failed|Traceback|error\b|:\d+(:\d+)?:\s)",
                           re.IGNORECASE)
SECRETS = [
    (re.compile(r"(\w+://[^/\s:@]+:)[^@\s/]+@"), r"\1[redacted]@"),          # credentials in URLs
    (re.compile(r"(?i)(['\"]?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)['\"]?\s*[=:]\s*)"
                r"(['\"]?)[^'\",\s}]+"), r"\1\2[redacted]"),
    (re.compile(r"(?i)((?:bearer|basic)\s+)[a-z0-9._~+/=-]{8,}"), r"\1[redacted]"),
    (re.compile(r"\b(ghp|gho|ghs|github_pat|sk|xox[bpas]|glpat)[-_][A-Za-z0-9_-]{10,}"), "[redacted token]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[redacted key]"),
]


def redact(text: str) -> str:
    """Mask common secret shapes; the stand-up is meant to be shared."""
    for pattern, replacement in SECRETS:
        text = pattern.sub(replacement, text)
    return text


def failure_lines(tail: str, limit: int = 5) -> list:
    """The few output lines most likely to name what failed, so the stand-up is useful without the log.

    Falls back to the last few non-empty lines when nothing looks like a failure
    (linters such as `file:1: trailing whitespace` have their own formats).
    """
    lines = [l for l in tail.splitlines() if l.strip()]
    picked = [l for l in lines if FAILURE_HINTS.search(l)]
    return [redact(l) for l in (picked[:limit] or lines[-3:])]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("--since")
    ap.add_argument("--run-dir", help="The audit run folder (default: the latest).")
    ap.add_argument("--new-run", action="store_true", help="Create a new run folder without scanning.")
    args = ap.parse_args(argv)
    paths = board_paths(args.board_dir)
    board = load_board(paths)
    if args.new_run:
        previous = latest_run_dir(paths)
        prev_scan = json.loads((previous / "scan.json").read_text(encoding="utf-8")) if previous and (previous / "scan.json").exists() else {}
        run_dir = new_run_dir(paths)
        (run_dir / "scan.json").write_text(json.dumps({
            "board": board["board"]["title"], "since": prev_scan.get("since") or (dt.date.today() - dt.timedelta(days=1)).isoformat(),
            "scannedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "repos": [],
            "decisionsOnly": True}, indent=2) + "\n", encoding="utf-8")
        print(f"Run folder: {run_dir}")
    run_dir = run_dir if args.new_run else (Path(args.run_dir).resolve() if args.run_dir else latest_run_dir(paths))
    if run_dir is None:
        ap.error("No audit run folder yet; run scan_repos.py first.")
    scan_path = run_dir / "scan.json"
    scan = json.loads(scan_path.read_text(encoding="utf-8")) if scan_path.exists() else None
    proposals = open_and_recent_proposals(paths, run_dir)
    since = args.since or (scan or {}).get("since") or (dt.date.today() - dt.timedelta(days=1)).isoformat()
    since_ts = to_utc(since)

    cols = {c["id"]: c for c in board["columns"]}
    people = {p["id"]: p["name"] for p in board["people"]}
    labels = {l["id"]: l["name"] for l in board["labels"]}
    tickets = board["tickets"]
    kind = lambda t: cols[t["status"]]["kind"]  # noqa: E731
    who = lambda t: people.get(t.get("assignee"), "unassigned")  # noqa: E731
    name = lambda t: f"**{t['id']}** {t['title']} ({who(t)})"  # noqa: E731
    col = lambda cid: cols.get(cid, {}).get("name", cid)  # noqa: E731

    local = since_ts.astimezone()
    shown_since = f"{local.day} {local.strftime('%B %Y, %H:%M')}"  # %-d is not portable
    decisions_only = bool((scan or {}).get("decisionsOnly"))
    out = [f"# Stand-up: {board['board']['title']}", "",
           f"{dt.date.today().strftime('%A')} {dt.date.today().day} {dt.date.today().strftime('%B %Y')}. "
           f"Changes since {shown_since}."]
    if decisions_only:
        out += ["", "This update records decisions only: the repositories were not scanned, so it has no commit "
                    "or test results. The last full audit's stand-up is in an earlier run folder."]

    def section(title, lines):
        out.extend(["", f"## {title}", ""])
        out.extend(lines or ["None."])

    moves = sorted(((e["at"], t, e) for t in tickets for e in t.get("history", []) if to_utc(e["at"]) >= since_ts),
                   key=lambda x: x[0])
    done = []
    for _, t, e in moves:
        if cols.get(e["to"], {}).get("kind") == "done" and kind(t) == "done" and t not in done:
            done.append(t)
    section("Completed", [f"- {name(t)}" for t in done])
    # "audit" marks the audit's own moves; any other actor (such as "manager via audit")
    # was a person's decision that the audit applied for them.
    note = lambda e: f" (the manager's decision, applied by the audit)" if e.get("by") and e["by"] != "audit" else ""  # noqa: E731
    section("Moved by the team", [f"- {name(t)}: {col(e.get('from'))} to {col(e['to'])}{note(e)}" for _, t, e in moves
                                  if cols.get(e["to"], {}).get("kind") != "done" and e.get("by") != "audit"])
    section("Moved by the audit", [f"- {name(t)}: {col(e.get('from'))} to {col(e['to'])}" for _, t, e in moves
                                   if cols.get(e["to"], {}).get("kind") != "done" and e.get("by") == "audit"])
    if scan and not decisions_only:
        commit_lines = []
        for r in scan["repos"]:
            recent = r.get("recentCommits", [])
            if recent:
                keyed = sum(1 for c in recent if c["keys"])
                commit_lines.append(f"- {r['id']}: {len(recent)} commit{'s' if len(recent) != 1 else ''}, "
                                    f"{keyed} naming a ticket")
        section("Commits", commit_lines)
    section("In progress", [f"- {name(t)}" for t in tickets if kind(t) == "in_progress"])
    section("Blocked or waiting", [
        f"- {name(t)}: " + (f"blocked, {t.get('blockedReason') or 'no reason recorded'}" if kind(t) == "blocked"
                            else f"waiting on {('[' + t['waitingFor'].replace('_', ' ') + '] ') if t.get('waitingFor') else ''}"
                                 f"{t.get('waitingOn') or 'not recorded'}")
        for t in tickets if kind(t) in ("blocked", "waiting")])
    if scan and not decisions_only:
        health = []
        for r in scan["repos"]:
            for k, v in r.get("commands", {}).items():
                tested = f" on {v.get('branch')} {v['commit'][:7]}" if v.get("commit") else ""
                if "skipped" in v:
                    health.append(f"- {r['id']} {k}: not run ({v['skipped']})")
                elif v.get("timedOut"):
                    health.append(f"- {r['id']} {k}: timed out after {v['seconds']} s{tested}")
                elif v["exitCode"] == 0:
                    health.append(f"- {r['id']} {k}: passed{tested}")
                else:
                    health.append(f"- {r['id']} {k}: FAILED (exit {v['exitCode']}){tested}")
                    health.extend(f"  - `{line.strip()[:140]}`" for line in failure_lines(v.get("tail", "")))
        section("Tests and builds", health)
        seen_limits = [f"- {r['id']}: {redact(x)}" for r in scan["repos"] for x in r.get("problems", []) + r.get("notes", [])]
        if scan.get("boardInContainer"):
            seen_limits.append("- The board is served from Docker, so this audit applied nothing to it.")
        if (run_dir / "PENDING").exists():
            seen_limits.append("- Changes from this audit are waiting to be applied (see PENDING in the run folder); "
                               "the sections above do not include them yet.")
        section("What this audit could not see", seen_limits)
    # The design checklist (project-kanban-board's design_checklist.py), if this board has one.
    pointer = paths["root"] / ".design-checklist-path"
    if pointer.exists():
        sys.path.insert(0, str(KANBAN / "scripts"))
        import design_checklist as dcl
        cl_path = Path(pointer.read_text(encoding="utf-8").strip())
        by_id = {t["id"]: t for t in tickets}
        lines = []
        for item in dcl.parse(cl_path):
            t = by_id.get(item["key"])
            has_image = bool(t) and any(dcl.IMAGE.search(c.get("body", "")) and c.get("author") != "audit"
                                        and c.get("updatedAt", "") > (item["added"] or "0000") for c in t["comments"])
            if item["done"] and not has_image:
                lines.append(f"- {item['key']} {item['text']}: ticked in the checklist, but no image is on the ticket yet")
            elif not item["done"]:
                lines.append(f"- {item['key']} {item['text']}" + (" (image added; please tick it)" if has_image else ""))
        section(f"Designs and images needed ({cl_path})", lines)
    need = [t for t in tickets if any(labels.get(l) in ("needs-evidence", "needs-screenshot") for l in t["labels"])]
    section("Needs evidence from a person", [f"- {name(t)}: " + ", ".join(
        labels[l] for l in t["labels"] if labels.get(l) in ("needs-evidence", "needs-screenshot")) for t in need])
    fmt = lambda p: f"- [{p.get('kind', 'other')}] " + (f"{p['ticket']}: " if p.get("ticket") else "") + p.get("summary", "")  # noqa: E731
    created = [t for t in tickets if to_utc(t["createdAt"]) >= since_ts and any(labels.get(l) == "audit" for l in t["labels"])]
    section("New tickets raised by the audit", [f"- {name(t)} in {col(t['status'])}" for t in created])
    epic_moves = []
    for e in (t for t in tickets if t["type"] == "epic"):
        kids = [t for t in tickets if t.get("parent") == e["id"]
                or any(p.get("parent") == e["id"] and p["id"] == t.get("parent") for p in tickets)]
        if not kids:
            continue
        if kind(e) in ("backlog", "todo") and any(kind(k) not in ("backlog", "todo") for k in kids):
            epic_moves.append(f"- {e['id']} {e['title']}: work has started on its tickets, but the epic is in {col(e['status'])}")
        elif kind(e) != "done" and all(kind(k) == "done" for k in kids):
            epic_moves.append(f"- {e['id']} {e['title']}: every ticket is done; consider moving the epic to Done")
    section("Epics to update", epic_moves)
    section("Decisions for you", [fmt(p) + (f" (raised {p['day']})" if p["run"] != run_dir.name else "")
                                  for p in proposals if p.get("status", "open") == "open"])
    decided = [p for p in proposals if p.get("status", "open") != "open"]
    if decided:
        section("Decided during the audit", [fmt(p) + f" ({p['status']})" for p in decided])

    out_path = run_dir / "standup.md"
    # When this stand-up was written: the next stand-up starts from here, so
    # the moves and tickets this run made are not reported twice.
    (run_dir / "standup.json").write_text(json.dumps({"writtenAt": dt.datetime.now().astimezone().isoformat(timespec="seconds")}) + "\n",
                                          encoding="utf-8")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
