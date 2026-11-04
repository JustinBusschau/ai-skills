"""Shared board logic: schema validation, plan expansion, and safe file writes.

Used by server.py at runtime and by the skill's scripts when a board is first
built, so the rules a board is checked against are the same in both places.
Standard library only; Python 3.9 or newer.
"""

from __future__ import annotations

import contextlib
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

try:  # POSIX
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None
try:  # Windows
    import msvcrt
except ImportError:
    msvcrt = None

SCHEMA_VERSION = 1

TICKET_TYPES = ("epic", "task", "subtask")
PRIORITIES = ("low", "medium", "high", "critical")
COLUMN_KINDS = (
    "backlog",      # captured but not yet planned
    "todo",         # ready to start
    "in_progress",  # being worked on
    "blocked",      # cannot proceed; needs blockedReason
    "waiting",      # awaiting an action from someone else; needs waitingOn
    "testing",      # awaiting or under testing / review
    "signoff",      # awaiting sign-off or acceptance
    "done",         # complete
)
# Who a "waiting" ticket is waiting for, so waiting work can be grouped by party.
WAITING_FOR = ("stakeholder", "third_party", "team", "other")
SWIMLANE_MODES = ("none", "epic", "assignee")
LINK_TYPES = ("commit", "pr", "branch", "url")
REPO_COMMANDS = ("setup", "test", "lint", "build", "start")
IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)


def sniff_image(data: bytes):
    """The image type from its first bytes (png, jpg, gif, webp), or None. Never trusts a file name."""
    for sig, ext in IMAGE_SIGNATURES:
        if data.startswith(sig):
            return ext
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None
COLOUR_MODES = ("epic", "label", "none")

COLUMN_PRESETS = {
    "simple": [
        ("todo", "To do", "todo"),
        ("in-progress", "In progress", "in_progress"),
        ("blocked", "Blocked", "blocked"),
        ("waiting", "Waiting on others", "waiting"),
        ("done", "Done", "done"),
    ],
    "standard": [
        ("backlog", "Backlog", "backlog"),
        ("todo", "To do", "todo"),
        ("in-progress", "In progress", "in_progress"),
        ("blocked", "Blocked", "blocked"),
        ("waiting", "Awaiting action", "waiting"),
        ("signoff", "Awaiting sign-off", "signoff"),
        ("done", "Done", "done"),
    ],
    "delivery": [
        ("backlog", "Backlog", "backlog"),
        ("ready", "Ready", "todo"),
        ("in-progress", "In progress", "in_progress"),
        ("blocked", "Blocked", "blocked"),
        ("waiting", "Awaiting action", "waiting"),
        ("testing", "Awaiting testing", "testing"),
        ("signoff", "Awaiting sign-off", "signoff"),
        ("done", "Done", "done"),
    ],
}

# Twelve hues that stay distinguishable as card stripes and lane headers in
# both themes, then twelve deeper shades of the same hues for boards with more
# epics. Past 24 colours repeat, so the planning guide caps epics well below.
EPIC_PALETTE = [
    "#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2",
    "#dc2626", "#65a30d", "#c026d3", "#0d9488", "#ea580c", "#4f46e5",
    "#1e3a8a", "#92400e", "#065f46", "#9d174d", "#4c1d95", "#155e75",
    "#7f1d1d", "#3f6212", "#701a75", "#134e4a", "#9a3412", "#312e81",
]
PERSON_PALETTE = [
    "#1d4ed8", "#b45309", "#047857", "#be185d", "#6d28d9", "#0e7490",
    "#b91c1c", "#4d7c0f", "#a21caf", "#0f766e", "#c2410c", "#4338ca",
]

HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
KEY_PREFIX = re.compile(r"^[A-Z][A-Z0-9]{0,9}$")
ISO_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

MAX_DEPTH = 3  # epic > task > subtask
MAX_TITLE = 300  # the browser's title field has the same limit


class BoardError(ValueError):
    """Raised when a board or plan fails validation. Carries every problem found."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("\n".join(self.problems))


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(text: str, fallback: str = "item") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:48] or fallback


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def validate_board(board) -> list:
    """Return a list of human-readable problems. An empty list means valid."""
    problems = []
    if not isinstance(board, dict):
        return ["Board must be a JSON object."]

    if board.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion must be {SCHEMA_VERSION}.")

    meta = board.get("board")
    if not isinstance(meta, dict) or not isinstance(meta.get("title"), str) or not meta["title"].strip():
        problems.append("board.title is required.")
    elif not KEY_PREFIX.match(str(meta.get("keyPrefix", ""))):
        problems.append("board.keyPrefix must be 1 to 10 upper-case letters or digits, starting with a letter.")
    if isinstance(meta, dict) and not isinstance(meta.get("nextNumber"), int):
        problems.append("board.nextNumber must be an integer.")

    columns = board.get("columns")
    column_ids = set()
    if not isinstance(columns, list) or len(columns) < 2:
        problems.append("columns must be a list of at least two columns.")
        columns = []
    kinds = set()
    for i, col in enumerate(columns):
        where = f"columns[{i}]"
        if not isinstance(col, dict):
            problems.append(f"{where} must be an object.")
            continue
        cid = col.get("id")
        if not isinstance(cid, str) or not ID_PATTERN.match(cid):
            problems.append(f"{where}.id is missing or invalid.")
        elif cid in column_ids:
            problems.append(f"{where}.id '{cid}' is duplicated.")
        else:
            column_ids.add(cid)
        if not isinstance(col.get("name"), str) or not col["name"].strip():
            problems.append(f"{where}.name is required.")
        if col.get("kind") not in COLUMN_KINDS:
            problems.append(f"{where}.kind must be one of {', '.join(COLUMN_KINDS)}.")
        else:
            kinds.add(col["kind"])
        wip = col.get("wipLimit")
        if wip is not None and (not isinstance(wip, int) or isinstance(wip, bool) or wip < 1):
            problems.append(f"{where}.wipLimit must be a positive integer or null.")
    if columns and "done" not in kinds:
        problems.append("At least one column must have kind 'done' so progress can be measured.")

    people_ids = _check_named_list(board, "people", problems)
    label_ids = _check_named_list(board, "labels", problems)

    tickets = board.get("tickets")
    if not isinstance(tickets, list):
        problems.append("tickets must be a list.")
        tickets = []
    by_id = {}
    for i, t in enumerate(tickets):
        where = f"tickets[{i}]"
        if not isinstance(t, dict):
            problems.append(f"{where} must be an object.")
            continue
        tid = t.get("id")
        if not isinstance(tid, str) or not ID_PATTERN.match(tid):
            problems.append(f"{where}.id is missing or invalid.")
            continue
        if tid in by_id:
            problems.append(f"Ticket id '{tid}' is duplicated.")
            continue
        by_id[tid] = t
        where = f"ticket {tid}"
        if t.get("type") not in TICKET_TYPES:
            problems.append(f"{where}: type must be one of {', '.join(TICKET_TYPES)}.")
        if not isinstance(t.get("title"), str) or not t["title"].strip():
            problems.append(f"{where}: title is required.")
        elif len(t["title"]) > MAX_TITLE:
            problems.append(f"{where}: title is longer than {MAX_TITLE} characters.")
        if not isinstance(t.get("description", ""), str):
            problems.append(f"{where}: description must be a string.")
        if t.get("status") not in column_ids:
            problems.append(f"{where}: status '{t.get('status')}' is not a column id.")
        if t.get("assignee") is not None and t.get("assignee") not in people_ids:
            problems.append(f"{where}: assignee '{t.get('assignee')}' is not a person id.")
        if t.get("priority", "medium") not in PRIORITIES:
            problems.append(f"{where}: priority must be one of {', '.join(PRIORITIES)}.")
        labels = t.get("labels", [])
        if not isinstance(labels, list) or any(l not in label_ids for l in labels):
            problems.append(f"{where}: labels must be a list of label ids.")
        colour = t.get("colour")
        if colour is not None and not (isinstance(colour, str) and HEX_COLOUR.match(colour)):
            problems.append(f"{where}: colour must be a #rrggbb hex string or null.")
        due = t.get("due")
        if due is not None and not _real_date(due):
            problems.append(f"{where}: due must be a real date written YYYY-MM-DD, or null.")
        if t.get("waitingFor", "") not in ("",) + WAITING_FOR:
            problems.append(f"{where}: waitingFor must be one of {', '.join(WAITING_FOR)}, or empty.")
        for field in ("blockedReason", "waitingOn"):
            if not isinstance(t.get(field, ""), str):
                problems.append(f"{where}: {field} must be a string.")
        for field in ("createdAt", "updatedAt"):
            if not (isinstance(t.get(field), str) and ISO_TS.match(t[field])):
                problems.append(f"{where}: {field} must be an ISO 8601 UTC timestamp ending in Z.")
        if not isinstance(t.get("order", 0), (int, float)) or isinstance(t.get("order", 0), bool):
            problems.append(f"{where}: order must be a number.")
        links = t.get("links", [])
        if not isinstance(links, list) or any(
            not isinstance(l, dict) or l.get("type") not in LINK_TYPES
            or not (isinstance(l.get("url"), str) and re.match(r"^https?://", l["url"])
                    or isinstance(l.get("ref"), str) and l["ref"].strip())
            for l in links
        ):
            problems.append(f"{where}: links must be a list of {{type ({', '.join(LINK_TYPES)}), url (http or https) "
                            "and/or ref, repo?, title?}}.")
        history = t.get("history", [])
        if not isinstance(history, list) or any(
            not isinstance(e, dict) or not (isinstance(e.get("at"), str) and ISO_TS.match(e["at"])) or "to" not in e
            for e in history
        ):
            problems.append(f"{where}: history must be a list of {{at, from, to}} status changes.")
        _check_comments(t, where, problems)

    # Cross-references: parents, hierarchy shape, cycles, and dependencies.
    for tid, t in by_id.items():
        parent = t.get("parent")
        ttype = t.get("type")
        if parent is None:
            if ttype == "subtask":
                problems.append(f"ticket {tid}: a subtask needs a parent task.")
        elif parent not in by_id:
            problems.append(f"ticket {tid}: parent '{parent}' does not exist.")
        else:
            ptype = by_id[parent].get("type")
            if ttype == "epic":
                problems.append(f"ticket {tid}: an epic cannot have a parent.")
            elif ttype == "task" and ptype != "epic":
                problems.append(f"ticket {tid}: a task's parent must be an epic.")
            elif ttype == "subtask" and ptype != "task":
                problems.append(f"ticket {tid}: a subtask's parent must be a task.")
        blocked_by = t.get("blockedBy", [])
        if not isinstance(blocked_by, list):
            problems.append(f"ticket {tid}: blockedBy must be a list.")
        else:
            for dep in blocked_by:
                if dep not in by_id:
                    problems.append(f"ticket {tid}: blockedBy '{dep}' does not exist.")
                elif dep == tid:
                    problems.append(f"ticket {tid}: cannot be blocked by itself.")
    cycle = _dependency_cycle(by_id)
    if cycle:
        problems.append("Dependencies form a loop: " + " -> ".join(cycle) + ".")
    for tid in by_id:
        seen = set()
        cur = tid
        depth = 0
        while cur is not None and cur in by_id:
            if cur in seen:
                problems.append(f"ticket {tid}: parent chain contains a cycle.")
                break
            seen.add(cur)
            depth += 1
            cur = by_id[cur].get("parent")
        if depth > MAX_DEPTH:
            problems.append(f"ticket {tid}: nested more than {MAX_DEPTH} levels deep.")

    repos = board.get("repos", [])
    repo_ids = set()
    if not isinstance(repos, list):
        problems.append("repos must be a list.")
        repos = []
    for i, r in enumerate(repos):
        where = f"repos[{i}]"
        if not isinstance(r, dict):
            problems.append(f"{where} must be an object.")
            continue
        if not isinstance(r.get("id"), str) or not ID_PATTERN.match(r["id"]) or r["id"] in repo_ids:
            problems.append(f"{where}.id is missing, invalid, or duplicated.")
        else:
            repo_ids.add(r["id"])
        if not isinstance(r.get("path"), str) or not r["path"].strip():
            problems.append(f"{where}.path is required (the repository's folder on this machine).")
        commands = r.get("commands", {})
        if not isinstance(commands, dict) or any(k not in REPO_COMMANDS or not isinstance(v, str) for k, v in commands.items()):
            problems.append(f"{where}.commands must map {', '.join(REPO_COMMANDS)} to command strings.")
        for key in ("remote", "appUrl"):
            if r.get(key) and not (isinstance(r[key], str) and re.match(r"^https?://", r[key])):
                problems.append(f"{where}.{key} must be an http or https URL.")
    for t in by_id.values():
        for l in t.get("links", []) if isinstance(t.get("links"), list) else []:
            if isinstance(l, dict) and l.get("repo") and l["repo"] not in repo_ids:
                problems.append(f"ticket {t.get('id')}: link names repo '{l['repo']}', which is not in repos.")

    settings = board.get("settings", {})
    if not isinstance(settings, dict):
        problems.append("settings must be an object.")
    else:
        for flag in ("showEpicCards", "showSubtasks"):
            if flag in settings and not isinstance(settings[flag], bool):
                problems.append(f"settings.{flag} must be true or false, not {json.dumps(settings[flag])}.")
        if settings.get("swimlanes", "none") not in SWIMLANE_MODES:
            problems.append(f"settings.swimlanes must be one of {', '.join(SWIMLANE_MODES)}.")
        if settings.get("colourBy", "epic") not in COLOUR_MODES:
            problems.append(f"settings.colourBy must be one of {', '.join(COLOUR_MODES)}.")

    if isinstance(meta, dict) and isinstance(meta.get("nextNumber"), int):
        prefix = str(meta.get("keyPrefix", ""))
        for tid in by_id:
            m = re.match(rf"^{re.escape(prefix)}-(\d+)$", tid)
            if m and int(m.group(1)) >= meta["nextNumber"]:
                problems.append(
                    f"board.nextNumber ({meta['nextNumber']}) must be greater than every ticket number; {tid} would be reissued."
                )
                break
    return problems


def _real_date(value) -> bool:
    if not (isinstance(value, str) and ISO_DATE.match(value)):
        return False
    try:
        _dt.date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _dependency_cycle(by_id):
    """Return one blockedBy cycle as a list of ids (first id repeated at the end), or None."""
    state = {}
    stack = []

    def visit(tid):
        state[tid] = 1
        stack.append(tid)
        deps = by_id[tid].get("blockedBy", [])
        for dep in deps if isinstance(deps, list) else []:
            if dep not in by_id:
                continue
            if state.get(dep) == 1:
                return stack[stack.index(dep):] + [dep]
            if dep not in state:
                found = visit(dep)
                if found:
                    return found
        stack.pop()
        state[tid] = 2
        return None

    for tid in by_id:
        if tid not in state:
            found = visit(tid)
            if found:
                return found
    return None


# Ticket writing (references/ticket-writing.md): a story in one of three forms,
# then optional technical notes, then acceptance criteria or a definition of done.
STORY_FORMS = (
    (re.compile(r"^as\b", re.I), ("i want", "so that"), "As a <type of user>, I want <some goal> so that <some reason>"),
    (re.compile(r"^given\b", re.I), ("when", "then"), "Given <pre-condition>, When <action>, Then <result>"),
    (re.compile(r"^when\b", re.I), ("i want to", "so i can"), "When <situation>, I want to <motivation>, so I can <expected outcome>"),
)
CRITERIA_HEADING = re.compile(r"^#{1,6}\s*(acceptance criteria|definition of done)\b[^\n]*\n(?:\s*\n)*\s*[-*]\s+\S",
                              re.I | re.M)


def ticket_writing_problems(ticket) -> list:
    """What a ticket's description lacks under the ticket-writing standard (empty when it complies)."""
    text = str(ticket.get("description") or "")
    first = next((l for l in text.splitlines() if l.strip()), "")
    plain = re.sub(r"[*_`]", "", first).strip()
    problems = []
    form = next((f for f in STORY_FORMS if f[0].match(plain)), None)
    if form is None:
        problems.append("its description does not start with a story (As a ... I want ... so that ...; "
                        "Given ... When ... Then ...; or When ... I want to ... so I can ...)")
    elif not all(word in plain.lower() for word in form[1]):
        problems.append(f"its story is incomplete; use the form: {form[2]}")
    if not CRITERIA_HEADING.search(text):
        problems.append("it has no '### Acceptance criteria' (or '### Definition of done') section with at least one item")
    return problems


# Screens (references/screen-design.md): a ticket labelled "screen" carries a
# "### Screen data" table saying where each data element comes from.
SCREEN_LABEL = "screen"
SCREEN_DATA_HEADING = re.compile(r"^#{1,6}\s*screen data\b.*$", re.I | re.M)
IMAGE_REF = re.compile(r"uploads/[a-f0-9]{32}\.(png|jpg|gif|webp)")


def screen_data_problems(ticket) -> list:
    """What a screen ticket's screen data table lacks (empty when it complies)."""
    text = str(ticket.get("description") or "")
    m = SCREEN_DATA_HEADING.search(text)
    if not m:
        return ["it is labelled screen but has no '### Screen data' table saying where each data element comes from"]
    rows = []
    for line in text[m.end():].splitlines():
        if line.strip().startswith("#"):
            break
        if line.strip().startswith("|"):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    header = [c.lower() for c in rows[0]] if rows else []
    if "source" not in header or len(rows) < 3:
        return ["its '### Screen data' table needs a 'Source' column and at least one row "
                "(Element | Shows | Source | Loaded / refreshed | States and notes)"]
    src = header.index("source")
    if not any(len(r) > src and r[src] for r in rows[2:]):
        return ["its '### Screen data' table has no source filled in"]
    return []


def board_warnings(board) -> list:
    """Things that are allowed (the browser can save them) but make the board less useful."""
    warnings = []
    kinds = {c.get("id"): c.get("kind") for c in board.get("columns", []) if isinstance(c, dict)}
    for t in board.get("tickets", []):
        if not isinstance(t, dict):
            continue
        kind = kinds.get(t.get("status"))
        if kind == "blocked" and not str(t.get("blockedReason", "")).strip():
            warnings.append(f"ticket {t.get('id')}: blocked with no reason recorded.")
        if kind == "waiting" and not str(t.get("waitingOn", "")).strip():
            warnings.append(f"ticket {t.get('id')}: waiting with nothing recorded for who or what it waits on.")
    label_names = {l.get("id"): str(l.get("name", "")).lower() for l in board.get("labels", []) if isinstance(l, dict)}
    for t in board.get("tickets", []):
        if isinstance(t, dict):
            for p in ticket_writing_problems(t):
                warnings.append(f"ticket {t.get('id')}: {p} (see references/ticket-writing.md).")
            if SCREEN_LABEL in {label_names.get(l) for l in t.get("labels", [])}:
                for p in screen_data_problems(t):
                    warnings.append(f"ticket {t.get('id')}: {p} (see references/screen-design.md).")
                if not any(IMAGE_REF.search(str(c.get("body", ""))) for c in t.get("comments", []) if isinstance(c, dict)):
                    warnings.append(f"ticket {t.get('id')}: screen ticket with no design image yet; attach a wireframe "
                                    "or list it in the design checklist (scripts/design_checklist.py).")
    by_id = {t.get("id"): t for t in board.get("tickets", []) if isinstance(t, dict)}
    backlog = next((c.get("name") for c in board.get("columns", []) if isinstance(c, dict) and c.get("kind") == "backlog"), None)
    for t in by_id.values():
        kind = kinds.get(t.get("status"))
        if kind == "done" and t.get("type") != "epic":
            open_kids = [c["id"] for c in by_id.values() if c.get("parent") == t.get("id") and kinds.get(c.get("status")) != "done"]
            if open_kids:
                warnings.append(f"ticket {t.get('id')}: done, but its sub-tasks {', '.join(open_kids)} are not.")
        if kind == "todo":
            open_deps = [d for d in t.get("blockedBy", []) if d in by_id and kinds.get(by_id[d].get("status")) != "done"]
            # With no Backlog column, low priority is the documented way to mark later work.
            if open_deps and (backlog or t.get("priority") != "low"):
                fix = (f"move it to {backlog} until they are done" if backlog
                       else "this board has no Backlog column, so give it low priority until they are done")
                warnings.append(f"ticket {t.get('id')}: in a To do column but depends on unfinished "
                                f"{', '.join(open_deps)}; {fix}.")
        if isinstance(t.get("title"), str) and len(t["title"]) > 100:
            warnings.append(f"ticket {t.get('id')}: title is {len(t['title'])} characters; cards read best under about 70.")
        for e in t.get("history", []) if isinstance(t.get("history"), list) else []:
            if isinstance(e, dict) and (e.get("to") not in kinds or (e.get("from") is not None and e.get("from") not in kinds)):
                warnings.append(f"ticket {t.get('id')}: status history mentions a column id that no longer exists; "
                                "column ids should never be renamed (rename the column's name instead).")
                break
    return warnings


HISTORY_LIMIT = 100


def set_status(board, ticket, column, ts, reason=None, waiting_for=None, actor=None):
    """Move a ticket to a column: record the change in its history and clear
    a blocked or waiting reason that no longer applies (the history keeps it)."""
    old = ticket.get("status")
    kinds = {c["id"]: c["kind"] for c in board["columns"]}
    if old != column["id"]:
        entry = {"at": ts, "from": old, "to": column["id"]}
        if actor:
            entry["by"] = actor  # who made the change, when it was not the board manager in the browser
        if kinds.get(old) == "blocked" and ticket.get("blockedReason"):
            entry["note"] = "was blocked: " + ticket["blockedReason"]
        if kinds.get(old) == "waiting" and ticket.get("waitingOn"):
            entry["note"] = "was waiting on: " + ticket["waitingOn"]
        ticket["history"] = (ticket.get("history") or []) + [entry]
        ticket["history"] = ticket["history"][-HISTORY_LIMIT:]
    ticket["status"] = column["id"]
    if column["kind"] != "blocked":
        ticket["blockedReason"] = ""
    if column["kind"] != "waiting":
        ticket["waitingOn"] = ""
        ticket["waitingFor"] = ""
    if reason is not None:
        if column["kind"] == "blocked":
            ticket["blockedReason"] = reason
        elif column["kind"] == "waiting":
            ticket["waitingOn"] = reason
    if waiting_for is not None and column["kind"] == "waiting":
        ticket["waitingFor"] = waiting_for


def _check_named_list(board, key, problems):
    items = board.get(key, [])
    ids = set()
    if not isinstance(items, list):
        problems.append(f"{key} must be a list.")
        return ids
    for i, item in enumerate(items):
        where = f"{key}[{i}]"
        if not isinstance(item, dict):
            problems.append(f"{where} must be an object.")
            continue
        iid = item.get("id")
        if not isinstance(iid, str) or not ID_PATTERN.match(iid):
            problems.append(f"{where}.id is missing or invalid.")
        elif iid in ids:
            problems.append(f"{where}.id '{iid}' is duplicated.")
        else:
            ids.add(iid)
        if not isinstance(item.get("name"), str) or not item["name"].strip():
            problems.append(f"{where}.name is required.")
        colour = item.get("colour")
        if colour is not None and not (isinstance(colour, str) and HEX_COLOUR.match(colour)):
            problems.append(f"{where}.colour must be a #rrggbb hex string.")
    return ids


def _check_comments(ticket, where, problems):
    comments = ticket.get("comments", [])
    if not isinstance(comments, list):
        problems.append(f"{where}: comments must be a list.")
        return
    ids = set()
    for j, c in enumerate(comments):
        cw = f"{where} comment {j}"
        if not isinstance(c, dict):
            problems.append(f"{cw} must be an object.")
            continue
        if not isinstance(c.get("id"), str) or c["id"] in ids:
            problems.append(f"{cw}: id is missing or duplicated.")
        else:
            ids.add(c["id"])
        if not isinstance(c.get("body"), str):
            problems.append(f"{cw}: body must be a string.")
        for field in ("createdAt", "updatedAt"):
            if not (isinstance(c.get(field), str) and ISO_TS.match(c[field])):
                problems.append(f"{cw}: {field} must be an ISO 8601 UTC timestamp ending in Z.")


# --------------------------------------------------------------------------
# Plan expansion: a nested, hand-writable plan becomes a full board.
# --------------------------------------------------------------------------

def build_board_from_plan(plan, existing=None) -> dict:
    """Expand a plan (see references/plan-format.md) into a board.

    With ``existing``, the plan's people, labels, and tickets are appended to
    that board instead: ticket numbering continues, and people and labels that
    already exist (matched by name, case-insensitively) are reused.
    Raises BoardError listing every problem found.
    """
    problems = []
    if not isinstance(plan, dict):
        raise BoardError(["Plan must be a JSON object."])
    _check_plan_shape(plan)
    ts = now_iso()

    if existing is None:
        title = plan.get("title")
        if not isinstance(title, str) or not title.strip():
            problems.append("Plan needs a title.")
            title = "Untitled project"
        prefix = plan.get("keyPrefix") or _default_prefix(title)
        if not KEY_PREFIX.match(prefix):
            problems.append("keyPrefix must be 1 to 10 upper-case letters or digits, starting with a letter.")
        board = {
            "schemaVersion": SCHEMA_VERSION,
            "board": {
                "title": title.strip(),
                "description": plan.get("description", ""),
                "keyPrefix": prefix,
                "nextNumber": 1,
                "createdAt": ts,
                "updatedAt": ts,
                "assumptions": list(plan.get("assumptions", [])),
            },
            "columns": _plan_columns(plan, problems),
            "people": [],
            "labels": [],
            "tickets": [],
            "settings": {
                "swimlanes": "none",
                "colourBy": "epic",
                "showEpicCards": False,
                "showSubtasks": True,
            },
        }
        board["settings"].update({k: v for k, v in (plan.get("settings") or {}).items()})
    else:
        board = json.loads(json.dumps(existing))  # deep copy
        board["board"]["updatedAt"] = ts
        for a in plan.get("assumptions", []):
            board["board"].setdefault("assumptions", []).append(a)

    people_by_name = {p["name"].lower(): p["id"] for p in board["people"]}
    for raw in plan.get("people", []):
        person = {"name": raw} if isinstance(raw, str) else dict(raw)
        name = str(person.get("name", "")).strip()
        if not name:
            problems.append("Every person needs a name.")
            continue
        if name.lower() in people_by_name:
            continue
        pid = _unique_id("p-" + slugify(name, "person"), {p["id"] for p in board["people"]})
        entry = {
            "id": pid,
            "name": name,
            "role": person.get("role", ""),
            "colour": person.get("colour") or PERSON_PALETTE[len(board["people"]) % len(PERSON_PALETTE)],
        }
        board["people"].append(entry)
        people_by_name[name.lower()] = pid

    labels_by_name = {l["name"].lower(): l["id"] for l in board["labels"]}
    for raw in plan.get("labels", []):
        label = {"name": raw} if isinstance(raw, str) else dict(raw)
        name = str(label.get("name", "")).strip()
        if not name:
            problems.append("Every label needs a name.")
            continue
        if name.lower() in labels_by_name:
            continue
        lid = _unique_id("l-" + slugify(name, "label"), {l["id"] for l in board["labels"]})
        board["labels"].append({
            "id": lid,
            "name": name,
            "colour": label.get("colour") or EPIC_PALETTE[(len(board["labels"]) + 5) % len(EPIC_PALETTE)],
        })
        labels_by_name[name.lower()] = lid

    board.setdefault("repos", [])
    repo_names = {str(r.get("name", r["id"])).lower() for r in board["repos"]}
    for r in plan.get("repos", []) or []:
        if str(r.get("name", "")).lower() in repo_names:
            continue
        rid = _unique_id(slugify(r["name"], "repo"), {x["id"] for x in board["repos"]})
        entry = {"id": rid, "name": r["name"], "path": os.path.expanduser(r["path"]), "commands": dict(r.get("commands") or {})}
        for key in ("remote", "appUrl", "defaultBranch"):
            if r.get(key):
                entry[key] = r[key]
        board["repos"].append(entry)
        repo_names.add(r["name"].lower())

    column_ids = [c["id"] for c in board["columns"]]
    default_status = column_ids[0] if column_ids else None
    refs = {}  # plan-local "ref" -> ticket id
    pending_deps = []  # (ticket, [refs])
    epic_count = sum(1 for t in board["tickets"] if t["type"] == "epic")
    order_counter = [max([t.get("order", 0) for t in board["tickets"]] + [0])]

    def resolve_person(name, where):
        if name in (None, ""):
            return None
        pid = people_by_name.get(str(name).lower())
        if pid is None:
            problems.append(f"{where}: assignee '{name}' is not in people.")
        return pid

    def resolve_labels(names, where):
        out = []
        for n in names or []:
            lid = labels_by_name.get(str(n).lower())
            if lid is None:
                problems.append(f"{where}: label '{n}' is not in labels.")
            else:
                out.append(lid)
        return out

    def resolve_status(value, where):
        if value in (None, ""):
            return default_status
        if value in column_ids:
            return value
        for c in board["columns"]:
            if c["name"].lower() == str(value).lower() or c["kind"] == value:
                return c["id"]
        problems.append(f"{where}: status '{value}' matches no column id, name, or kind.")
        return default_status

    def make(item, ttype, parent_id, inherit_assignee=None):
        where = f"{ttype} '{item.get('title', '?')}'"
        if not isinstance(item.get("title"), str) or not item["title"].strip():
            problems.append(f"A {ttype} is missing its title.")
        number = board["board"]["nextNumber"]
        board["board"]["nextNumber"] = number + 1
        tid = f"{board['board']['keyPrefix']}-{number}"
        order_counter[0] += 1
        ticket = {
            "id": tid,
            "type": ttype,
            "title": str(item.get("title", "")).strip(),
            "description": item.get("description", ""),
            "parent": parent_id,
            "status": resolve_status(item.get("status"), where),
            # A sub-task with no "assignee" key takes its parent task's owner;
            # "assignee": null leaves it unassigned on purpose.
            "assignee": resolve_person(item["assignee"], where) if "assignee" in item else (inherit_assignee if ttype == "subtask" else None),
            "priority": item.get("priority", "medium"),
            "labels": resolve_labels(item.get("labels"), where),
            "colour": None,
            "due": item.get("due"),
            "blockedReason": item.get("blockedReason", ""),
            "waitingOn": item.get("waitingOn", ""),
            "waitingFor": item.get("waitingFor", ""),
            "blockedBy": [],
            "order": order_counter[0],
            "createdAt": ts,
            "updatedAt": ts,
            "history": [],
            "comments": [],
        }
        for p in ticket_writing_problems(ticket):
            problems.append(f"{where}: {p}. See references/ticket-writing.md.")
        if SCREEN_LABEL in {str(n).lower() for n in (item.get("labels") or [])}:
            for p in screen_data_problems(ticket):
                problems.append(f"{where}: {p}. See references/screen-design.md.")
        kind = next((c["kind"] for c in board["columns"] if c["id"] == ticket["status"]), None)
        if kind == "blocked" and not str(ticket["blockedReason"]).strip():
            problems.append(f"{where}: is blocked but has no blockedReason; the card is not actionable without one.")
        if kind == "waiting" and not str(ticket["waitingOn"]).strip():
            problems.append(f"{where}: is waiting but has no waitingOn saying who or what it waits on.")
        if ttype == "epic":
            ticket["colour"] = item.get("colour") or EPIC_PALETTE[epic_index[0] % len(EPIC_PALETTE)]
            epic_index[0] += 1
        for k, note in enumerate(item.get("comments", []) or []):
            ticket["comments"].append({
                "id": f"c-{tid.lower()}-{k + 1}",
                "body": str(note),
                "createdAt": ts,
                "updatedAt": ts,
            })
        if item.get("ref"):
            if item["ref"] in refs:
                problems.append(f"{where}: ref '{item['ref']}' is used twice.")
            refs[item["ref"]] = tid
        if item.get("blockedBy"):
            pending_deps.append((ticket, list(item["blockedBy"]), where))
        board["tickets"].append(ticket)
        return tid

    existing_by_id = {t["id"]: t for t in board["tickets"]}

    def resolve_parent(value, want_type, where):
        # A plan-local ref, or the key of a ticket already on the board.
        target = refs.get(value) or (value if value in existing_by_id else None)
        if target is None:
            problems.append(f"{where}: '{value}' is not a ref in this plan or an existing ticket key.")
            return None
        actual = next((t["type"] for t in board["tickets"] if t["id"] == target), None)
        if actual != want_type:
            article = lambda w: "an" if str(w)[:1] in "aeiou" else "a"  # noqa: E731
            problems.append(f"{where}: '{value}' is {article(actual)} {actual}, not {article(want_type)} {want_type}.")
            return None
        return target

    def owner(tid):
        return next((t["assignee"] for t in board["tickets"] if t["id"] == tid), None)

    epic_index = [epic_count]
    for epic in plan.get("epics", []) or []:
        eid = make(epic, "epic", None)
        for task in epic.get("tasks", []) or []:
            tid = make(task, "task", eid)
            for sub in task.get("subtasks", []) or []:
                make(sub, "subtask", tid, owner(tid))
    for task in plan.get("tasks", []) or []:
        parent = None
        if task.get("epic"):
            parent = resolve_parent(task["epic"], "epic", f"task '{task.get('title')}'")
        tid = make(task, "task", parent)
        for sub in task.get("subtasks", []) or []:
            make(sub, "subtask", tid, owner(tid))
    for sub in plan.get("subtasks", []) or []:
        where = f"subtask '{sub.get('title')}'"
        if not sub.get("parent"):
            problems.append(f"{where}: top-level subtasks need a parent (a task ref or key).")
            continue
        parent = resolve_parent(sub["parent"], "task", where)
        if parent:
            make(sub, "subtask", parent, owner(parent))

    existing_ids = {t["id"] for t in board["tickets"]}
    for ticket, deps, where in pending_deps:
        for dep in deps:
            target = refs.get(dep) or (dep if dep in existing_ids else None)
            if target is None:
                problems.append(f"{where}: blockedBy '{dep}' is not a ref or ticket id.")
            else:
                ticket["blockedBy"].append(target)

    problems.extend(validate_board(board))
    if problems:
        raise BoardError(problems)
    return board


PLAN_TOP_KEYS = {"title", "description", "keyPrefix", "columnPreset", "columns", "people", "labels",
                 "assumptions", "settings", "epics", "tasks", "subtasks", "repos"}
PLAN_REPO_KEYS = {"name", "path", "remote", "appUrl", "commands", "defaultBranch"}
TICKET_KEYS = {"title", "description", "status", "assignee", "priority", "labels", "due", "blockedReason",
               "waitingOn", "waitingFor", "blockedBy", "ref", "comments"}
# "epic" and "parent" are only meaningful at the top level of a plan (a nested
# task already has its epic), so they are rejected when nested.
PLAN_ITEM_KEYS = {
    "epic": TICKET_KEYS | {"colour", "tasks"},
    "task": TICKET_KEYS | {"subtasks"},
    "top-task": TICKET_KEYS | {"subtasks", "epic"},
    "subtask": TICKET_KEYS,
    "top-subtask": TICKET_KEYS | {"parent"},
}


def _unknown_keys(obj, allowed, where, problems):
    """A misspelt key ("asignee", "subTasks") would otherwise be dropped without a word."""
    import difflib

    for key in obj:
        if key not in allowed:
            close = difflib.get_close_matches(key, sorted(allowed), n=1, cutoff=0.6)
            hint = f" Did you mean '{close[0]}'?" if close else f" Allowed: {', '.join(sorted(allowed))}."
            if key in ("epic", "parent"):
                hint = (f" '{key}' is only used on top-level tasks and subtasks; a nested item already belongs "
                        "to the item it is nested in.")
            problems.append(f"{where}: unknown key '{key}'.{hint}")


def _check_plan_shape(plan):
    """Catch structural mistakes (a string where a list belongs, a misspelt key) before they are misread."""
    problems = []
    _unknown_keys(plan, PLAN_TOP_KEYS, "plan", problems)
    for key in ("people", "labels", "assumptions", "epics", "tasks", "subtasks", "columns", "repos"):
        if key in plan and not isinstance(plan[key], list):
            problems.append(f"'{key}' must be a list, for example \"{key}\": [ ... ].")
    if "settings" in plan and not isinstance(plan["settings"], dict):
        problems.append("'settings' must be an object.")

    def items(container, key, where):
        value = container.get(key, [])
        if value in (None,):
            return []
        if not isinstance(value, list):
            problems.append(f"{where}: '{key}' must be a list.")
            return []
        out = []
        for i, item in enumerate(value):
            if not isinstance(item, dict):
                problems.append(f"{where}: {key}[{i}] must be an object with at least a title, not {json.dumps(item)[:40]}.")
            else:
                out.append(item)
        return out

    def check(obj, kind):
        label = kind.replace("top-", "")
        _unknown_keys(obj, PLAN_ITEM_KEYS[kind], f"{label} '{obj.get('title', '?')}'", problems)
        for key in ("blockedBy", "labels", "comments"):
            if key in obj and not isinstance(obj[key], list):
                problems.append(f"{label} '{obj.get('title', '?')}': '{key}' must be a list, for example [\"{obj[key]}\"].")
        title = obj.get("title")
        if isinstance(title, str) and len(title) > MAX_TITLE:
            problems.append(f"{label} '{title[:40]}...': title is {len(title)} characters; keep it under about 70 "
                            f"(the limit is {MAX_TITLE}) and put detail in the description.")

    if isinstance(plan.get("epics", []), list):
        for e in items(plan, "epics", "plan"):
            check(e, "epic")
            for t in items(e, "tasks", f"epic '{e.get('title', '?')}'"):
                check(t, "task")
                for sub in items(t, "subtasks", f"task '{t.get('title', '?')}'"):
                    check(sub, "subtask")
    if isinstance(plan.get("tasks", []), list):
        for t in items(plan, "tasks", "plan"):
            check(t, "top-task")
            for sub in items(t, "subtasks", f"task '{t.get('title', '?')}'"):
                check(sub, "subtask")
    if isinstance(plan.get("subtasks", []), list):
        for sub in items(plan, "subtasks", "plan"):
            check(sub, "top-subtask")
    for r in plan.get("repos", []) if isinstance(plan.get("repos"), list) else []:
        if not isinstance(r, dict):
            problems.append("Each entry in 'repos' must be an object with name and path.")
            continue
        _unknown_keys(r, PLAN_REPO_KEYS, f"repo '{r.get('name', '?')}'", problems)
        if not r.get("name") or not r.get("path"):
            problems.append(f"repo '{r.get('name', '?')}': name and path are required.")
        elif not os.path.isabs(os.path.expanduser(str(r["path"]))):
            problems.append(f"repo '{r['name']}': path must be absolute.")
    if isinstance(plan.get("settings"), dict):
        _unknown_keys(plan["settings"], {"swimlanes", "colourBy", "showEpicCards", "showSubtasks"}, "settings", problems)
    for key in ("assumptions",):
        if isinstance(plan.get(key), list) and any(not isinstance(a, str) for a in plan[key]):
            problems.append("'assumptions' must be a list of strings.")
    if problems:
        raise BoardError(problems)


def _plan_columns(plan, problems):
    if plan.get("columns"):
        cols = []
        for i, c in enumerate(plan["columns"]):
            if isinstance(c, str):
                problems.append(f"columns[{i}] must be an object with name and kind.")
                continue
            cols.append({
                "id": c.get("id") or slugify(c.get("name", ""), f"col-{i + 1}"),
                "name": c.get("name", ""),
                "kind": c.get("kind"),
                "wipLimit": c.get("wipLimit"),
            })
        return cols
    preset = plan.get("columnPreset", "standard")
    if preset not in COLUMN_PRESETS:
        problems.append(f"columnPreset must be one of {', '.join(COLUMN_PRESETS)}.")
        preset = "standard"
    return [{"id": i, "name": n, "kind": k, "wipLimit": None} for i, n, k in COLUMN_PRESETS[preset]]


def _default_prefix(title):
    words = re.findall(r"[A-Za-z0-9]+", title)
    letters = "".join(w[0] for w in words[:4]).upper()
    if not letters or not letters[0].isalpha():
        letters = "PRJ"
    return letters[:10]


def append_duplicates(existing, board) -> list:
    """Tickets an append would add whose type, parent, and title match an existing ticket."""
    before = len(existing["tickets"])
    seen = {(t["type"], t.get("parent"), t["title"].strip().lower()) for t in existing["tickets"]}
    return [t for t in board["tickets"][before:] if (t["type"], t.get("parent"), t["title"].strip().lower()) in seen]


APPEND_IGNORED = ("title", "description", "keyPrefix", "columnPreset", "columns", "settings")


def referenced_uploads(board) -> set:
    """Names of uploaded images still referenced by any description or comment."""
    names = set()
    pattern = re.compile(r"uploads/([a-f0-9]{32}\.(?:png|jpg|gif|webp))")
    for t in board.get("tickets", []):
        names.update(pattern.findall(t.get("description", "") or ""))
        for c in t.get("comments", []):
            names.update(pattern.findall(c.get("body", "") or ""))
    return names


def _unique_id(base, taken):
    candidate = base
    n = 2
    while candidate in taken:
        candidate = f"{base}-{n}"
        n += 1
    return candidate


# --------------------------------------------------------------------------
# File handling
# --------------------------------------------------------------------------

def content_etag(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest()[:32] + '"'


def serialise(board) -> bytes:
    return (json.dumps(board, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    """Write via a temp file in the same directory and rename, so a crash never leaves half a file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".board-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        # mkstemp creates files readable only by their owner; keep an existing
        # file's mode, otherwise use 0644 so a container user can read it too.
        try:
            mode = os.stat(path).st_mode & 0o777
        except FileNotFoundError:
            mode = 0o644
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


@contextlib.contextmanager
def board_lock(board_path):
    """Exclusive lock shared by the server and the skill's scripts (data/.board.lock).

    Held around every read-modify-write of board.json so a browser save and a
    script edit cannot interleave. Works across processes on one machine; it
    does not reach across a Docker bind mount from macOS or Windows.
    """
    lock_path = Path(board_path).with_name(".board.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(lock_path, "a+b")
    try:
        if fcntl is not None:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        elif msvcrt is not None:  # pragma: no cover
            fh.seek(0)
            while True:
                try:
                    msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
                    break
                except OSError:
                    time.sleep(0.05)
        yield
    finally:
        try:
            if fcntl is not None:
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            elif msvcrt is not None:  # pragma: no cover
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            fh.close()


BACKUP_NAME = re.compile(r"^board-(\d{8}T\d{6})\d*Z(?:-([a-z-]+))?\.json$")


def backup(path: Path, backups_dir: Path, label: str = "") -> None:
    """Copy the current board aside before it is overwritten, then prune old copies.

    Ordinary backups are thinned with age (see prune_backups). A backup with a
    label, such as "before-delete", is kept until there are more than 100
    labelled copies, so a deletion can always be undone.
    """
    path = Path(path)
    if not path.exists():
        return
    backups_dir = Path(backups_dir)
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    suffix = f"-{label}" if label and re.match(r"^[a-z-]{1,30}$", label) else ""
    shutil.copy2(path, backups_dir / f"board-{stamp}{suffix}.json")
    prune_backups(backups_dir)


def prune_backups(backups_dir: Path, now=None) -> None:
    """Keep every backup from the last two hours, the newest per hour for 14 days,
    the newest per day for a year, and the newest 100 labelled backups."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    plain, labelled = [], []
    for f in Path(backups_dir).glob("board-*.json"):
        m = BACKUP_NAME.match(f.name)
        if not m:
            continue
        when = _dt.datetime.strptime(m.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=_dt.timezone.utc)
        (labelled if m.group(2) else plain).append((when, f))
    for _, f in sorted(labelled, reverse=True)[100:]:
        f.unlink(missing_ok=True)
    seen = set()
    for when, f in sorted(plain, reverse=True):  # newest first, so the first in a bucket is kept
        age = now - when
        if age <= _dt.timedelta(hours=2):
            continue
        if age <= _dt.timedelta(days=14):
            bucket = ("h", when.strftime("%Y%m%d%H"))
        elif age <= _dt.timedelta(days=365):
            bucket = ("d", when.strftime("%Y%m%d"))
        else:
            f.unlink(missing_ok=True)
            continue
        if bucket in seen:
            f.unlink(missing_ok=True)
        else:
            seen.add(bucket)
