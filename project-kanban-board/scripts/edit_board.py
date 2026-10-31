#!/usr/bin/env python3
"""Apply small edits to an existing board safely, whether or not its server is running.

    edit_board.py path/to/board-project ops.json
    edit_board.py path/to/board-project --op '{"op": "move", "id": "WEB-12", "status": "Done"}'

Operations (a JSON list, or a single object):

  Tickets
  {"op": "move",    "id": "KEY", "status": "<column id, name, or kind>",
                    "reason": "blocked reason or waiting-on text",
                    "waitingFor": "stakeholder | third_party | team | other"}
  {"op": "set",     "id": "KEY", "fields": {...}}   fields: title, description, status,
                    assignee (name, id, or null), priority, due (YYYY-MM-DD or null),
                    labels (names), blockedReason, waitingOn, waitingFor,
                    blockedBy (keys), parent (key or null), colour (epics, #rrggbb),
                    type (epic, task, subtask; set parent in the same op to match)
  {"op": "delete",  "id": "KEY"}                    also deletes its child tickets

  Comments
  {"op": "comment",        "id": "KEY", "body": "Markdown text"}
  {"op": "edit-comment",   "id": "KEY", "comment": "<comment id>", "body": "..."}
  {"op": "delete-comment", "id": "KEY", "comment": "<comment id>"}

  People and labels
  {"op": "add-person",    "name": "...", "role": "..."}
  {"op": "rename-person", "person": "<name or id>", "name": "...", "role": "...", "colour": "#rrggbb"}
  {"op": "remove-person", "person": "<name or id>"}  unassigns their tickets
  {"op": "add-label",     "name": "...", "colour": "#rrggbb"}
  {"op": "rename-label",  "label": "<name or id>", "name": "...", "colour": "#rrggbb"}
  {"op": "remove-label",  "label": "<name or id>"}   removes it from tickets

  Columns (a column's id never changes, so status history stays meaningful)
  {"op": "add-column",    "name": "...", "kind": "<kind>", "before": "<column>"}
  {"op": "update-column", "column": "<id, name, or kind>", "name": "...",
                          "kind": "<kind>", "wipLimit": 3 or null}
  {"op": "remove-column", "column": "<id or name>"}  only when it is empty
  kinds: backlog, todo, in_progress, blocked, waiting, testing, signoff, done

  Board
  {"op": "set-board", "title": "...", "description": "...", "assumptions": ["...", ...]}

  Repositories the board tracks, and evidence on tickets
  {"op": "add-repo",    "name": "...", "path": "/abs/path", "remote": "https://...",
                        "appUrl": "http://localhost:3000", "commands": {"test": "...", "lint": "...",
                        "build": "...", "start": "..."}}
  {"op": "update-repo", "repo": "<id or name>", ...same fields...}
  {"op": "remove-repo", "repo": "<id or name>"}
  {"op": "add-link",    "id": "KEY", "type": "commit | pr | branch | url", "url": "https://...",
                        "ref": "sha or branch", "repo": "<repo id>", "title": "..."}
  {"op": "remove-link", "id": "KEY", "url": "..." or "ref": "..."}
  {"op": "attach",      "id": "KEY", "file": "/path/to/image.png", "body": "Markdown narrative"}
                        copies a PNG, JPEG, GIF, or WebP into data/uploads/ and adds a comment
                        with the narrative followed by the image

Unknown keys in an operation are rejected, so a misspelling cannot be ignored
silently. To add new tickets, use create_board.py --append with a plan.

    edit_board.py path/to/board-project --clean-uploads
    edit_board.py path/to/board-project --purge-text-stdin --clean-uploads --include-recent <<'END'
    the exact text to remove
    END
    edit_board.py path/to/board-project --find-text-stdin <<'END'
    the exact text to look for
    END

removes images in data/uploads/ that no description or comment references any
more (for example a screenshot whose comment was deleted). Images less than an
hour old are kept and counted, because one pasted into a comment that is not
posted yet is unreferenced too; add --include-recent to remove those as well
(right for a sensitive screenshot deleted moments ago). --purge-text deletes
every backup in data/backups/ and every plan copy in data/plans/ that contains
the given text, once the text is gone from the board itself, because backups
otherwise keep deleted comments for up to a year. --clean-uploads and
--purge-text can be given together; neither can be combined with --op.

Pass sensitive text on standard input with a quoted heredoc (<<'END', as
above), never as "--purge-text "..."": inside double quotes the shell changes
$, backticks, and backslashes, so the wrong text would be searched for and
the purge would find nothing. One trailing newline is dropped.
--find-text-stdin lists every file under the board folder that still holds
the text, in raw or JSON-escaped form; use it to confirm a purge.

Moving a ticket records the change in its status history and clears a blocked
or waiting reason that no longer applies (the history keeps the old reason).

All operations apply together or not at all, and the result is validated
before it is written. The read, edit, and write happen while holding the same
lock the board server takes for its saves (data/.board.lock), so a browser
save cannot land in between. (The lock does not reach a server running in
Docker on macOS or Windows; stop the container before editing in that case.)
An open browser tab with no unsaved changes reloads within a few seconds. If
the tab had an unsaved change at that moment, its save is refused and it asks
the manager which version to keep. A backup is kept in data/backups/; edits
that delete anything get a pinned "before-delete" backup.
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
sys.dont_write_bytecode = True  # keep the skill folder free of caches
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "assets" / "app"))
import boardlib  # noqa: E402

SETTABLE = {"title", "description", "status", "assignee", "priority", "due", "labels", "blockedReason",
            "waitingOn", "waitingFor", "blockedBy", "parent", "colour", "type"}
DESTRUCTIVE = {"delete", "delete-comment", "remove-person", "remove-label", "remove-column", "remove-repo"}
OP_KEYS = {
    "move": {"id", "status", "reason", "waitingFor"},
    "set": {"id", "fields"},
    "delete": {"id"},
    "comment": {"id", "body"},
    "edit-comment": {"id", "comment", "body"},
    "delete-comment": {"id", "comment"},
    "add-person": {"name", "role", "colour"},
    "rename-person": {"person", "name", "role", "colour"},
    "remove-person": {"person"},
    "add-label": {"name", "colour"},
    "rename-label": {"label", "name", "colour"},
    "remove-label": {"label"},
    "add-column": {"name", "kind", "before", "wipLimit"},
    "update-column": {"column", "name", "kind", "wipLimit"},
    "remove-column": {"column"},
    "set-board": {"title", "description", "assumptions"},
    "add-repo": {"id", "name", "path", "remote", "appUrl", "commands", "defaultBranch"},
    "update-repo": {"repo", "name", "path", "remote", "appUrl", "commands", "defaultBranch"},
    "remove-repo": {"repo"},
    "add-link": {"id", "type", "url", "ref", "repo", "title"},
    "remove-link": {"id", "url", "ref"},
    "attach": {"id", "file", "body"},
}


def check_keys(op):
    import difflib

    kind = op.get("op")
    if kind not in OP_KEYS:
        raise OpError(f"Unknown op '{kind}'. Ops: {', '.join(OP_KEYS)}.")
    for key in op:
        if key != "op" and key not in OP_KEYS[kind]:
            close = difflib.get_close_matches(key, sorted(OP_KEYS[kind]), n=1, cutoff=0.5)
            hint = f" Did you mean '{close[0]}'?" if close else ""
            if kind == "move" and key in ("blockedReason", "waitingOn"):
                hint = " With move, pass the reason as \"reason\"."
            raise OpError(f"'{kind}' does not take \"{key}\".{hint} It takes: {', '.join(sorted(OP_KEYS[kind]))}.")


def unique_name(items, name, what, current=None):
    clash = [x for x in items if x["name"].lower() == name.lower() and x is not current]
    if clash:
        raise OpError(f"There is already a {what} called {clash[0]['name']}.")


class OpError(Exception):
    pass


def need(op, key):
    if key not in op or op[key] in (None, ""):
        raise OpError(f"'{op.get('op')}' needs \"{key}\".")
    return op[key]


def find_column(board, value):
    for c in board["columns"]:
        if value == c["id"] or str(value).lower() in (c["name"].lower(), c["kind"]):
            return c
    raise OpError(f"No column matches '{value}'. Columns: {', '.join(c['name'] for c in board['columns'])}.")


def find_person(board, value, allow_none=True):
    if value in (None, "") and allow_none:
        return None
    for p in board["people"]:
        if value == p["id"] or str(value).lower() == p["name"].lower():
            return p
    raise OpError(f"No person matches '{value}'. People: {', '.join(p['name'] for p in board['people']) or 'none'}.")


def find_label(board, value):
    for l in board["labels"]:
        if value == l["id"] or str(value).lower() == l["name"].lower():
            return l
    raise OpError(f"No label matches '{value}'. Labels: {', '.join(l['name'] for l in board['labels']) or 'none'}.")


def find_repo(board, value):
    for r in board.get("repos", []):
        if value == r["id"] or str(value).lower() == str(r.get("name", "")).lower():
            return r
    names = ", ".join(r.get("name") or r["id"] for r in board.get("repos", [])) or "none"
    raise OpError(f"No repository matches '{value}'. Repositories: {names}.")


def repo_fields(op, repo):
    for key in ("name", "remote", "appUrl", "defaultBranch"):
        if key in op:
            repo[key] = op[key]
    if "path" in op:
        path = Path(str(op["path"])).expanduser()
        if not path.is_absolute():
            raise OpError("A repository path must be absolute, so it works from any folder.")
        repo["path"] = str(path)
    if "commands" in op:
        if not isinstance(op["commands"], dict):
            raise OpError('"commands" must be an object such as {"test": "npm test"}.')
        repo["commands"] = op["commands"]


def get_ticket(board, tid):
    for t in board["tickets"]:
        if t["id"] == tid:
            return t
    raise OpError(f"No ticket {tid}.")


def get_comment(ticket, cid):
    for c in ticket["comments"]:
        if c["id"] == cid:
            return c
    ids = ", ".join(c["id"] for c in ticket["comments"]) or "none"
    raise OpError(f"{ticket['id']} has no comment {cid}. Its comments: {ids}.")


# --actor: recorded on status changes and comments this run makes, so the board
# (and a stand-up) can tell an automated audit's changes from the manager's.
ACTOR = [None]


def stamp(comment):
    if ACTOR[0]:
        comment["author"] = ACTOR[0]
    return comment


# Images from "attach" are written only once the whole batch has validated.
pending_files = []
path_holder = [None]


def apply_ops(board, ops):
    ts = boardlib.now_iso()
    notes = []
    for op in ops:
        if not isinstance(op, dict):
            raise OpError(f"Each operation must be a JSON object, not {json.dumps(op)[:60]}.")
        check_keys(op)
        kind = op.get("op")
        if kind == "move":
            t = get_ticket(board, need(op, "id"))
            col = find_column(board, need(op, "status"))
            boardlib.set_status(board, t, col, ts, op.get("reason"), op.get("waitingFor"), ACTOR[0])
            same = [x for x in board["tickets"] if x["status"] == col["id"] and x is not t]
            t["order"] = max([x.get("order", 0) for x in same] + [0]) + 10
            t["updatedAt"] = ts
            notes.append(f"{t['id']} -> {col['name']}")
        elif kind == "set":
            t = get_ticket(board, need(op, "id"))
            fields = need(op, "fields")
            if not isinstance(fields, dict):
                raise OpError("'set' needs \"fields\" as an object.")
            unknown = sorted(set(fields) - SETTABLE)
            if unknown:
                raise OpError(f"Cannot set {', '.join(unknown)}. Settable fields: {', '.join(sorted(SETTABLE))}.")
            for field, value in fields.items():
                if field == "assignee":
                    p = find_person(board, value)
                    value = p["id"] if p else None
                elif field == "labels":
                    if not isinstance(value, list):
                        raise OpError('"labels" must be a list of label names, for example ["venue"].')
                    value = [find_label(board, v)["id"] for v in value]
                elif field == "status":
                    boardlib.set_status(board, t, find_column(board, value), ts, actor=ACTOR[0])
                    continue
                elif field == "colour" and fields.get("type", t["type"]) != "epic":
                    raise OpError(f"Only epics have a colour; {t['id']} is a {t['type']}.")
                elif field == "type":
                    if value not in boardlib.TICKET_TYPES:
                        raise OpError(f"type must be one of {', '.join(boardlib.TICKET_TYPES)}.")
                    if value == "epic" and not t.get("colour") and "colour" not in fields:
                        used = {x.get("colour") for x in board["tickets"]}
                        t["colour"] = next((c for c in boardlib.EPIC_PALETTE if c not in used), boardlib.EPIC_PALETTE[0])
                    elif value != "epic":
                        t["colour"] = None
                t[field] = value
            t["updatedAt"] = ts
            notes.append(f"{t['id']} updated: {', '.join(fields)}")
        elif kind == "delete":
            t = get_ticket(board, need(op, "id"))
            doomed = {t["id"]}
            grew = True
            while grew:
                grew = False
                for x in board["tickets"]:
                    if x.get("parent") in doomed and x["id"] not in doomed:
                        doomed.add(x["id"])
                        grew = True
            board["tickets"] = [x for x in board["tickets"] if x["id"] not in doomed]
            for x in board["tickets"]:
                x["blockedBy"] = [d for d in x.get("blockedBy", []) if d not in doomed]
            notes.append(f"deleted {', '.join(sorted(doomed))}")
        elif kind == "comment":
            t = get_ticket(board, need(op, "id"))
            body = str(need(op, "body")).strip()
            t["comments"].append(stamp({"id": "c-" + secrets.token_hex(6), "body": body, "createdAt": ts, "updatedAt": ts}))
            t["updatedAt"] = ts
            notes.append(f"{t['id']} comment {t['comments'][-1]['id']} added")
        elif kind == "edit-comment":
            t = get_ticket(board, need(op, "id"))
            c = get_comment(t, need(op, "comment"))
            c["body"] = str(need(op, "body")).strip()
            c["updatedAt"] = ts
            t["updatedAt"] = ts
            notes.append(f"{t['id']} comment {c['id']} edited")
        elif kind == "delete-comment":
            t = get_ticket(board, need(op, "id"))
            c = get_comment(t, need(op, "comment"))
            t["comments"].remove(c)
            t["updatedAt"] = ts
            notes.append(f"{t['id']} comment {c['id']} deleted")
        elif kind == "add-person":
            name = str(need(op, "name")).strip()
            if any(p["name"].lower() == name.lower() for p in board["people"]):
                notes.append(f"{name} already exists")
                continue
            pid = boardlib._unique_id("p-" + boardlib.slugify(name, "person"), {p["id"] for p in board["people"]})
            board["people"].append({
                "id": pid, "name": name, "role": op.get("role", ""),
                "colour": op.get("colour") or boardlib.PERSON_PALETTE[len(board["people"]) % len(boardlib.PERSON_PALETTE)],
            })
            notes.append(f"added person {name}")
        elif kind == "rename-person":
            p = find_person(board, need(op, "person"), allow_none=False)
            old = p["name"]
            if op.get("name"):
                unique_name(board["people"], str(op["name"]).strip(), "person", p)
                p["name"] = str(op["name"]).strip()
            if op.get("role") is not None:
                p["role"] = op["role"]
            if op.get("colour"):
                p["colour"] = op["colour"]
            notes.append(f"person {old} is now {p['name']}" + (f" ({p['role']})" if p.get("role") else ""))
        elif kind == "remove-person":
            p = find_person(board, need(op, "person"), allow_none=False)
            n = 0
            for t in board["tickets"]:
                if t.get("assignee") == p["id"]:
                    t["assignee"] = None
                    t["updatedAt"] = ts
                    n += 1
            board["people"].remove(p)
            notes.append(f"removed {p['name']}; {n} ticket{'' if n == 1 else 's'} now unassigned")
        elif kind == "add-label":
            name = str(need(op, "name")).strip()
            if any(l["name"].lower() == name.lower() for l in board["labels"]):
                notes.append(f"label {name} already exists")
                continue
            lid = boardlib._unique_id("l-" + boardlib.slugify(name, "label"), {l["id"] for l in board["labels"]})
            board["labels"].append({"id": lid, "name": name, "colour": op.get("colour") or "#0891b2"})
            notes.append(f"added label {name}")
        elif kind == "rename-label":
            l = find_label(board, need(op, "label"))
            old = l["name"]
            if op.get("name"):
                unique_name(board["labels"], str(op["name"]).strip(), "label", l)
                l["name"] = str(op["name"]).strip()
            if op.get("colour"):
                l["colour"] = op["colour"]
            notes.append(f"label {old} is now {l['name']}")
        elif kind == "remove-label":
            l = find_label(board, need(op, "label"))
            for t in board["tickets"]:
                if l["id"] in t.get("labels", []):
                    t["labels"] = [x for x in t["labels"] if x != l["id"]]
                    t["updatedAt"] = ts
            board["labels"].remove(l)
            notes.append(f"removed label {l['name']}")
        elif kind == "set-board":
            meta = board["board"]
            if not any(k in op for k in ("title", "description", "assumptions")):
                raise OpError("set-board needs at least one of title, description, or assumptions.")
            for k in ("title", "description"):
                if k in op and not isinstance(op[k], str):
                    raise OpError(f'"{k}" must be a string.')
            if "title" in op:
                if not str(op["title"]).strip():
                    raise OpError("The board title cannot be empty.")
                meta["title"] = str(op["title"]).strip()
            if "description" in op:
                meta["description"] = str(op["description"])
            if "assumptions" in op:
                if not isinstance(op["assumptions"], list) or not all(isinstance(a, str) for a in op["assumptions"]):
                    raise OpError('"assumptions" must be a list of strings.')
                meta["assumptions"] = op["assumptions"]
            notes.append("board details updated: " + ", ".join(k for k in ("title", "description", "assumptions") if k in op))
        elif kind == "add-repo":
            name = str(need(op, "name")).strip()
            need(op, "path")
            board.setdefault("repos", [])
            unique_name([{"name": r.get("name", r["id"])} for r in board["repos"]], name, "repository")
            rid = op.get("id") or boardlib._unique_id(boardlib.slugify(name, "repo"), {r["id"] for r in board["repos"]})
            repo = {"id": rid, "name": name, "commands": {}}
            repo_fields(op, repo)
            board["repos"].append(repo)
            if not Path(repo["path"]).is_dir():
                notes.append(f"  note: {repo['path']} does not exist on this machine yet.")
            notes.append(f"added repository {name} ({rid})")
        elif kind == "update-repo":
            repo = find_repo(board, need(op, "repo"))
            repo_fields(op, repo)
            notes.append(f"repository {repo['id']} updated")
        elif kind == "remove-repo":
            repo = find_repo(board, need(op, "repo"))
            used = [t["id"] for t in board["tickets"] if any(l.get("repo") == repo["id"] for l in t.get("links", []))]
            if used:
                raise OpError(f"Tickets {', '.join(used[:10])} link to {repo['id']}; remove those links first.")
            board["repos"].remove(repo)
            notes.append(f"removed repository {repo['id']}")
        elif kind == "add-link":
            t = get_ticket(board, need(op, "id"))
            link = {k: op[k] for k in ("type", "url", "ref", "repo", "title") if op.get(k)}
            if link.get("repo"):
                link["repo"] = find_repo(board, link["repo"])["id"]
            existing = t.setdefault("links", [])
            if any((l.get("url") and l.get("url") == link.get("url")) or
                   (l.get("ref") and l.get("ref") == link.get("ref") and l.get("repo") == link.get("repo"))
                   for l in existing):
                notes.append(f"{t['id']} already has that link")
                continue
            existing.append(link)
            t["updatedAt"] = ts
            notes.append(f"{t['id']} linked to {link.get('title') or link.get('ref') or link.get('url')}")
        elif kind == "remove-link":
            t = get_ticket(board, need(op, "id"))
            key = op.get("url") or op.get("ref")
            if not key:
                raise OpError("remove-link needs \"url\" or \"ref\".")
            before = len(t.get("links", []))
            t["links"] = [l for l in t.get("links", []) if l.get("url") != key and l.get("ref") != key]
            if len(t["links"]) == before:
                raise OpError(f"{t['id']} has no link {key}.")
            t["updatedAt"] = ts
            notes.append(f"{t['id']} link removed")
        elif kind == "attach":
            t = get_ticket(board, need(op, "id"))
            src = Path(str(need(op, "file"))).expanduser()
            try:
                data = src.read_bytes()
            except OSError as exc:
                raise OpError(f"Cannot read {src}: {exc}")
            ext = boardlib.sniff_image(data)
            if ext is None:
                raise OpError(f"{src} is not a PNG, JPEG, GIF, or WebP image.")
            if len(data) > 10 * 1024 * 1024:
                raise OpError(f"{src} is larger than 10 MB.")
            name = f"{secrets.token_hex(16)}.{ext}"
            pending_files.append((path_holder[0].parent / "uploads" / name, data))
            body = str(op.get("body") or "").strip()
            caption = src.stem.replace("]", "").replace("[", "")
            t["comments"].append(stamp({"id": "c-" + secrets.token_hex(6), "body": (body + "\n\n" if body else "")
                                  + f"![{caption}](uploads/{name})", "createdAt": ts, "updatedAt": ts}))
            t["updatedAt"] = ts
            notes.append(f"{t['id']} image attached as comment {t['comments'][-1]['id']}")
        elif kind == "add-column":
            name = str(need(op, "name")).strip()
            ckind = need(op, "kind")
            if ckind not in boardlib.COLUMN_KINDS:
                raise OpError(f"kind must be one of {', '.join(boardlib.COLUMN_KINDS)}.")
            unique_name(board["columns"], name, "column")
            cid = boardlib._unique_id(boardlib.slugify(name, "column"), {c["id"] for c in board["columns"]})
            col = {"id": cid, "name": name, "kind": ckind, "wipLimit": op.get("wipLimit")}
            if op.get("before"):
                at = board["columns"].index(find_column(board, op["before"]))
            else:
                done = [i for i, c in enumerate(board["columns"]) if c["kind"] == "done"]
                at = done[0] if done else len(board["columns"])
            board["columns"].insert(at, col)
            notes.append(f"added column {name}")
        elif kind == "update-column":
            col = find_column(board, need(op, "column"))
            if op.get("name"):
                unique_name(board["columns"], str(op["name"]).strip(), "column", col)
                col["name"] = str(op["name"]).strip()
            if op.get("kind"):
                if op["kind"] not in boardlib.COLUMN_KINDS:
                    raise OpError(f"kind must be one of {', '.join(boardlib.COLUMN_KINDS)}.")
                col["kind"] = op["kind"]
            if "wipLimit" in op:
                col["wipLimit"] = op["wipLimit"]
            notes.append(f"column {col['id']} is now {col['name']} ({col['kind']})")
        elif kind == "remove-column":
            col = find_column(board, need(op, "column"))
            n = sum(1 for t in board["tickets"] if t["status"] == col["id"])
            if n:
                raise OpError(f"{col['name']} still holds {n} ticket{'' if n == 1 else 's'}; move them first.")
            board["columns"].remove(col)
            notes.append(f"removed column {col['name']}")
    board["board"]["updatedAt"] = ts
    return notes


def clean_uploads(path: Path, include_recent: bool = False) -> int:
    import time

    with boardlib.board_lock(path):
        used = boardlib.referenced_uploads(json.loads(path.read_bytes()))
        uploads = path.parent / "uploads"
        removed, kept_recent = [], []
        for f in sorted(uploads.glob("*")) if uploads.exists() else []:
            if not f.is_file() or f.name in used:
                continue
            # An hour's grace by default: an image pasted into a comment not yet posted is unreferenced too.
            if not include_recent and time.time() - f.stat().st_mtime < 3600:
                kept_recent.append(f.name)
                continue
            f.unlink()
            removed.append(f.name)
    print(f"Removed {len(removed)} unused image{'' if len(removed) == 1 else 's'} from {uploads}.")
    if kept_recent:
        print(f"Kept {len(kept_recent)} unused image{'' if len(kept_recent) == 1 else 's'} less than an hour old "
              "(perhaps pasted into a comment not yet posted). Add --include-recent to remove "
              f"{'it' if len(kept_recent) == 1 else 'them'} too.")
    return 0


def purge_text(path: Path, text: str) -> int:
    if len(text.strip()) < 4:
        print("Give at least four characters, so unrelated backups are not deleted.", file=sys.stderr)
        return 2
    # The files hold JSON, where quotes, backslashes, newlines, and (in hand-edited
    # files) non-ASCII characters are escaped, so look for every written form.
    forms = text_forms(text)

    def contains(f):
        content = f.read_text(encoding="utf-8", errors="replace")
        return any(form in content for form in forms)

    with boardlib.board_lock(path):
        # Status-history notes keep old blocked and waiting reasons, and nobody
        # can edit them, so redact the text there first.
        board = json.loads(path.read_text(encoding="utf-8"))
        redacted = 0
        for t in board["tickets"]:
            for e in t.get("history", []):
                # The whole note goes, not just the matched part: the text given
                # may be only part of a secret.
                if text in (e.get("note") or ""):
                    e["note"] = "[note removed]"
                    redacted += 1
        if redacted:
            boardlib.atomic_write(path, boardlib.serialise(board))
            print(f"Redacted the text from {redacted} status-history note{'' if redacted == 1 else 's'}.")
        if contains(path):
            print("Nothing deleted: the text is still on the board. Remove it first: from a ticket's title, "
                  "description, or reason with a set op; from a comment with edit-comment or delete-comment; from "
                  "a person, label, or column with rename-person, rename-label, or update-column; or from the "
                  "board's title, description, or assumptions with set-board. Then run this again.",
                  file=sys.stderr)
            return 1
        removed = []
        for folder, pattern in (("backups", "board-*.json"), ("plans", "*.json")):
            for f in sorted((path.parent / folder).glob(pattern)):
                if contains(f):
                    f.unlink()
                    removed.append(f"{folder}/{f.name}")
    print(f"Deleted {len(removed)} file{'' if len(removed) == 1 else 's'} containing that text"
          + (f": {', '.join(removed)}." if removed else "."))
    if not removed and not redacted:
        print("warning: nothing anywhere held this text. If it was on the board, the text given probably differs "
              "from what was stored (check quoting and spacing); confirm with --find-text-stdin.")
    return 0


def text_forms(text: str) -> set:
    """Raw and JSON-escaped forms, as the text can appear in the board's files."""
    return {text, json.dumps(text)[1:-1], json.dumps(text, ensure_ascii=False)[1:-1]}


def find_text(path: Path, text: str) -> int:
    if len(text.strip()) < 4:
        print("Give at least four characters.", file=sys.stderr)
        return 2
    forms = text_forms(text)
    root = path.parent.parent  # the board project folder
    hits = []
    for f in sorted(root.rglob("*")):
        if f.is_file() and f.stat().st_size < 50 * 1024 * 1024:
            try:
                content = f.read_bytes().decode("utf-8", errors="replace")
            except OSError:
                continue
            if any(form in content for form in forms):
                hits.append(str(f.relative_to(root)))
    if hits:
        print("Still present in:\n  " + "\n  ".join(hits))
        return 1
    print(f"Not found anywhere under {root}.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", help="Board project directory, or a board.json path.")
    ap.add_argument("ops_file", nargs="?", help="JSON file with one op or a list of ops.")
    ap.add_argument("--op", action="append", default=[], help="An op as inline JSON (repeatable).")
    ap.add_argument("--actor", help="Name recorded on the status changes and comments this run makes, e.g. audit.")
    ap.add_argument("--clean-uploads", action="store_true", help="Delete uploaded images nothing references.")
    ap.add_argument("--include-recent", action="store_true", help="With --clean-uploads, include images under an hour old.")
    ap.add_argument("--purge-text", help="Delete backups containing this text (it must already be gone from the board).")
    ap.add_argument("--purge-text-stdin", action="store_true", help="Like --purge-text, reading the text from standard input.")
    ap.add_argument("--find-text-stdin", action="store_true",
                    help="List files under the board folder that hold the text read from standard input.")
    args = ap.parse_args(argv)

    path = Path(args.project)
    if path.is_dir():
        path = path / "data" / "board.json"
    if not path.exists():
        print(f"{path} not found.", file=sys.stderr)
        return 2
    if args.purge_text_stdin or args.find_text_stdin:
        stdin_text = sys.stdin.read()
        if stdin_text.endswith("\n"):
            stdin_text = stdin_text[:-1]
        if args.find_text_stdin:
            return find_text(path, stdin_text)
        args.purge_text = stdin_text
    if (args.clean_uploads or args.purge_text) and (args.op or args.ops_file):
        ap.error("--clean-uploads and --purge-text cannot be combined with operations; run them separately.")
    if args.include_recent and not args.clean_uploads:
        ap.error("--include-recent only applies to --clean-uploads.")
    if args.clean_uploads or args.purge_text:
        status = 0
        if args.purge_text:
            status = purge_text(path, args.purge_text)
        if args.clean_uploads:
            status = max(status, clean_uploads(path, args.include_recent))
        return status
    try:
        ops = json.loads(Path(args.ops_file).read_text(encoding="utf-8")) if args.ops_file else []
        ops = ops if isinstance(ops, list) else [ops]
        ops += [json.loads(o) for o in args.op]
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read ops: {exc}", file=sys.stderr)
        return 2
    if not ops:
        print("No operations given.", file=sys.stderr)
        return 2

    path_holder[0] = path
    ACTOR[0] = (args.actor or "").strip() or None
    with boardlib.board_lock(path):
        board = json.loads(path.read_bytes())
        try:
            notes = apply_ops(board, ops)
        except OpError as exc:
            print(f"Nothing changed: {exc}", file=sys.stderr)
            return 1
        problems = boardlib.validate_board(board)
        if problems:
            print("Nothing changed; the result would be invalid:", file=sys.stderr)
            for p in problems:
                print("  - " + p, file=sys.stderr)
            return 1
        label = "before-delete" if any(isinstance(o, dict) and o.get("op") in DESTRUCTIVE for o in ops) else ""
        try:
            for target, data in pending_files:
                boardlib.atomic_write(target, data)
            boardlib.backup(path, path.parent / "backups", label)
            boardlib.atomic_write(path, boardlib.serialise(board))
        except OSError as exc:
            print(f"Nothing changed: could not write {path}: {exc}", file=sys.stderr)
            return 1
    for n in notes:
        print(n)
    # Only warnings about tickets these operations touched, not the whole board.
    touched = {o.get("id") for o in ops if isinstance(o, dict) and o.get("id")}
    for w in boardlib.board_warnings(board):
        if any(w.startswith(f"ticket {tid}:") for tid in touched):
            print("warning: " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
