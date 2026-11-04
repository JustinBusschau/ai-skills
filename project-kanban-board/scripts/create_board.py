#!/usr/bin/env python3
"""Create a runnable kanban board project from a plan, or add a plan to an existing board.

    create_board.py --plan plan.json --out ./my-project-board
    create_board.py --plan more.json --out ./my-project-board --append
    create_board.py --out ./my-project-board --update-app
    create_board.py ... --vendor-mermaid

New boards: --out must not exist or must be empty. The app files are copied in
and the plan is expanded into data/board.json.

--append: the plan's people, labels, and tickets are added to the existing
data/board.json (numbering continues). The previous board is backed up first.

--update-app: refreshes server.py, boardlib.py, and static/ from the skill
without touching data/. The code it replaces is copied to
.previous-app-<time>/ first. A Dockerfile, docker-compose.yml, or README.md
that differs from the skill's version is kept, with the new one beside it as
<name>.new.

--append refuses a plan whose tickets would duplicate existing titles (same
type, same parent), which usually means the plan was already applied. Pass
--allow-duplicates if the duplicates are intended.

--vendor-mermaid: downloads the pinned Mermaid build into static/vendor/ and
checks its SHA-256, so diagrams render without internet access.

Exit status is non-zero on any problem, with every problem listed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
sys.dont_write_bytecode = True  # keep the skill folder free of caches
import urllib.request
from collections import Counter
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
APP_SRC = SKILL_DIR / "assets" / "app"
sys.path.insert(0, str(APP_SRC))
import boardlib  # noqa: E402

CODE_FILES = ["server.py", "boardlib.py", ".dockerignore"]
# Files a user may reasonably customise (ports, notes). --update-app never
# overwrites a changed copy; it writes <name>.new beside it instead.
USER_FILES = ["Dockerfile", "docker-compose.yml"]
GITIGNORE = """# Board backups, lock file, and Python caches are machine-local.
data/backups/
data/.board.lock
data/.kanban-token
data/.server.json
.design-checklist-path
__pycache__/
*.new
.previous-app-*/
"""
APPEND_IGNORED = boardlib.APPEND_IGNORED
MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"
MERMAID_SHA256 = "581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8"


def snapshot_code(out: Path) -> Path | None:
    """Before --update-app replaces code, keep a copy so local fixes can be recovered."""
    import datetime as dt

    present = [n for n in CODE_FILES if (out / n).exists()] + (["static"] if (out / "static").exists() else [])
    if not present:
        return None
    dest = out / f".previous-app-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    dest.mkdir()
    for name in present:
        src = out / name
        if src.is_dir():
            shutil.copytree(src, dest / name, ignore=shutil.ignore_patterns("vendor", "__pycache__"))
        else:
            shutil.copy2(src, dest / name)
    return dest


def copy_app(out: Path, title: str | None) -> list:
    """Copy the app into out. Returns notes about files left alone."""
    notes = []
    out.mkdir(parents=True, exist_ok=True)
    gitignore = out / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(GITIGNORE, encoding="utf-8")
    else:  # an older board: add any lines it lacks, keeping the user's own
        have = gitignore.read_text(encoding="utf-8").splitlines()
        missing = [l for l in GITIGNORE.splitlines() if l and not l.startswith("#") and l not in have]
        if missing:
            with gitignore.open("a", encoding="utf-8") as fh:
                fh.write(("" if not have or have[-1] == "" else "\n") + "\n".join(missing) + "\n")
    for name in CODE_FILES:
        shutil.copy2(APP_SRC / name, out / name)
    for name in USER_FILES:
        target = out / name
        if target.exists() and target.read_bytes() != (APP_SRC / name).read_bytes():
            shutil.copy2(APP_SRC / name, out / (name + ".new"))
            notes.append(f"{name} differs from the skill's version, so it was kept; the new version is in {name}.new.")
        else:
            shutil.copy2(APP_SRC / name, target)
    static_out = out / "static"
    vendor = static_out / "vendor"
    keep_vendor = vendor.exists()
    if keep_vendor:
        tmp_vendor = out / ".vendor-keep"
        if tmp_vendor.exists():
            shutil.rmtree(tmp_vendor)
        shutil.move(str(vendor), str(tmp_vendor))
    if static_out.exists():
        shutil.rmtree(static_out)
    shutil.copytree(APP_SRC / "static", static_out, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
    if keep_vendor:
        shutil.move(str(out / ".vendor-keep"), str(vendor))
    readme = out / "README.md"
    text = (APP_SRC / "README.md").read_text(encoding="utf-8")
    if title is not None or not readme.exists():
        readme.write_text(text.replace("__TITLE__", title or "Project board"), encoding="utf-8")
    else:  # --update-app: keep the board's title line; never overwrite local edits
        first = readme.read_text(encoding="utf-8").splitlines()[:1] or ["# Project board"]
        fresh = "\n".join(first + text.splitlines()[1:]) + "\n"
        if readme.read_text(encoding="utf-8") != fresh:
            (out / "README.md.new").write_text(fresh, encoding="utf-8")
            notes.append("README.md differs from the skill's version, so it was kept; the new version is in README.md.new.")
    (out / "data" / "uploads").mkdir(parents=True, exist_ok=True)
    return notes


def vendor_mermaid(out: Path) -> str:
    target = out / "static" / "vendor" / "mermaid.min.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(MERMAID_URL, timeout=60) as resp:
        data = resp.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != MERMAID_SHA256:
        raise RuntimeError(f"Mermaid download hash mismatch (got {digest}); not installed.")
    boardlib.atomic_write(target, data)
    return str(target)


def keep_plan(out: Path, plan_path: str, label: str) -> None:
    """Keep a copy of every plan applied, so the board can be traced back to its inputs."""
    import datetime as dt

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = out / "data" / "plans" / f"{stamp}-{label}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(plan_path, dest)


def summarise(board) -> str:
    cols = {c["id"]: c["name"] for c in board["columns"]}
    types = Counter(t["type"] for t in board["tickets"])
    status = Counter(cols[t["status"]] for t in board["tickets"] if t["type"] != "epic")
    assigned = Counter(t["assignee"] or "unassigned" for t in board["tickets"] if t["type"] != "epic")
    people = {p["id"]: p["name"] for p in board["people"]}
    lines = [
        f"Board: {board['board']['title']} (keys {board['board']['keyPrefix']}-1 to "
        f"{board['board']['keyPrefix']}-{board['board']['nextNumber'] - 1})",
        "Tickets: " + ", ".join(f"{types.get(t, 0)} {t}s" for t in boardlib.TICKET_TYPES),
        "Columns: " + " | ".join(f"{c['name']} ({status.get(c['name'], 0)})" for c in board["columns"]),
        "Assignees: " + (", ".join(f"{people.get(k, k)} {v}" for k, v in assigned.most_common()) or "none"),
        f"People: {len(board['people'])}, labels: {len(board['labels'])}",
    ]
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", help="Plan JSON file (see references/plan-format.md).")
    ap.add_argument("--out", required=True, help="Board project directory.")
    ap.add_argument("--append", action="store_true", help="Add the plan to an existing board.")
    ap.add_argument("--update-app", action="store_true", help="Refresh app files only; leave data/ alone.")
    ap.add_argument("--vendor-mermaid", action="store_true", help="Download Mermaid for offline diagrams.")
    ap.add_argument("--allow-duplicates", action="store_true", help="With --append, allow titles that already exist.")
    args = ap.parse_args(argv)

    out = Path(args.out).expanduser().resolve()
    board_path = out / "data" / "board.json"

    if args.update_app:
        if not board_path.exists():
            ap.error(f"{board_path} not found; --update-app only refreshes an existing board.")
        saved = snapshot_code(out)
        for note in copy_app(out, None):
            print("note: " + note)
        if saved:
            print(f"The previous code is in {saved.name}/ in case it had local fixes.")
        print(f"Refreshed app files in {out} (data/ untouched). Restart the server, then run smoke_test.py on it.")
        if args.vendor_mermaid:
            try:
                print("Mermaid installed at", vendor_mermaid(out))
            except Exception as exc:  # network errors should not hide a good update
                print(f"Warning: could not vendor Mermaid ({exc}); diagrams will load from the CDN instead.", file=sys.stderr)
        return 0

    if not args.plan:
        ap.error("--plan is required unless --update-app is given.")
    try:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read plan: {exc}", file=sys.stderr)
        return 2

    if args.append:
        if not board_path.exists():
            ap.error(f"{board_path} not found; --append needs an existing board.")
        ignored = [k for k in APPEND_IGNORED if k in plan]
        if ignored:
            print(f"note: --append ignores {', '.join(ignored)}; change those in Board settings or with edit_board.py.")
        # Same lock as the server's saves, so a browser save cannot interleave.
        with boardlib.board_lock(board_path):
            existing = json.loads(board_path.read_text(encoding="utf-8"))
            problems = boardlib.validate_board(existing)
            if problems:
                print("The existing board is invalid; fix it before appending:", file=sys.stderr)
                for p in problems:
                    print("  - " + p, file=sys.stderr)
                return 1
            try:
                board = boardlib.build_board_from_plan(plan, existing=existing)
            except boardlib.BoardError as exc:
                print("Plan problems (nothing was written):", file=sys.stderr)
                for p in exc.problems:
                    print("  - " + p, file=sys.stderr)
                return 1
            before = len(existing["tickets"])
            if not args.allow_duplicates:
                dupes = boardlib.append_duplicates(existing, board)
                if dupes:
                    print("Nothing written: these tickets already exist with the same title and parent, so the "
                          "plan may already have been applied:", file=sys.stderr)
                    for t in dupes:
                        print(f"  - {t['type']} '{t['title']}'", file=sys.stderr)
                    print("Remove them from the plan, or pass --allow-duplicates if they are intended.", file=sys.stderr)
                    return 1
            boardlib.backup(board_path, out / "data" / "backups", "before-append")
            boardlib.atomic_write(board_path, boardlib.serialise(board))
        keep_plan(out, args.plan, "append")
        added = len(board["tickets"]) - before
        print(f"Appended {added} ticket{'' if added == 1 else 's'} to {board_path} (previous version in data/backups/).")
        print(summarise(board))
        return 0

    if out.exists() and any(out.iterdir()):
        print(
            f"{out} already exists and is not empty. Choose a new --out, use --append to add to "
            "an existing board, or --update-app to refresh its app files.",
            file=sys.stderr,
        )
        return 1
    try:
        board = boardlib.build_board_from_plan(plan)
    except boardlib.BoardError as exc:
        print("Plan problems (nothing was written):", file=sys.stderr)
        for p in exc.problems:
            print("  - " + p, file=sys.stderr)
        return 1

    copy_app(out, board["board"]["title"])
    boardlib.atomic_write(board_path, boardlib.serialise(board))
    keep_plan(out, args.plan, "initial")
    problems = boardlib.validate_board(json.loads(board_path.read_text(encoding="utf-8")))
    if problems:
        print("Written board failed re-validation:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        return 1
    print(f"Created board project at {out}")
    print(summarise(board))
    for w in boardlib.board_warnings(board):
        print("warning: " + w)
    if args.vendor_mermaid:
        try:
            print("Mermaid installed at", vendor_mermaid(out))
        except Exception as exc:  # network errors should not undo a good board
            print(f"Warning: could not vendor Mermaid ({exc}); diagrams will load from the CDN instead.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
