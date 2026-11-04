#!/usr/bin/env python3
"""Keep a checklist of designs and images the user must provide, and check it against the board.

    design_checklist.py <board-dir> add <KEY> <kind> "<what it must show>" [--how "<how to get it>"] [--file path]
    design_checklist.py <board-dir> list
    design_checklist.py <board-dir> sync

kind is design, screenshot, or image. The checklist is a Markdown file in the
current working folder (<project-slug>-designs-needed.md, or --file the
first time); its location is remembered in <board-dir>/.design-checklist-path
so later commands, and the kanban-board-audit skill, find it from any folder.

Each item names the ticket the image belongs on. The user adds the image to
that ticket on the board and then ticks the item ("- [x]"). `add` never
duplicates an item (same ticket, kind, and wording). `sync` compares the file
with the board and reports, for each item: verified (ticked, and the ticket
has an image added after the request), ticked but no image found, image found
but not ticked, or still outstanding. Exit status is 0 unless the file or
board cannot be read.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "assets" / "app"))
import boardlib  # noqa: E402

KINDS = ("design", "screenshot", "image")
ITEM = re.compile(r"^- \[( |x|X)\] \*\*(?P<key>[A-Z][A-Z0-9]*-\d+)\*\* (?P<text>.*)$")
META = re.compile(r"<!-- item: (?P<id>\S+); added: (?P<added>\S+) -->")
IMAGE = re.compile(r"uploads/[a-f0-9]{32}\.(png|jpg|gif|webp)")


def board_dir_paths(board_dir):
    root = Path(board_dir).expanduser().resolve()
    board_path = root / "data" / "board.json"
    if not board_path.exists():
        sys.exit(f"{root} is not a board folder (no data/board.json).")
    return root, board_path


def checklist_path(root: Path, board: dict, explicit: str | None) -> Path:
    pointer = root / ".design-checklist-path"
    if explicit:
        return Path(explicit).expanduser().resolve()
    if pointer.exists():
        return Path(pointer.read_text(encoding="utf-8").strip())
    return (Path.cwd() / f"{boardlib.slugify(board['board']['title'], 'board')}-designs-needed.md").resolve()


def parse(path: Path) -> list:
    """Items in file order: {done, key, text, id, added, line}."""
    if not path.exists():
        return []
    items, lines = [], path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        m = ITEM.match(line)
        if not m:
            continue
        meta = None
        for follow in lines[i + 1:i + 4]:
            meta = META.search(follow)
            if meta or ITEM.match(follow):
                break
        items.append({"done": m.group(1).lower() == "x", "key": m.group("key"), "text": m.group("text"),
                      "id": meta.group("id") if meta else None, "added": meta.group("added") if meta else None,
                      "line": i})
    return items


def header(board: dict, root: Path) -> str:
    return (f"# Designs and images needed: {board['board']['title']}\n\n"
            f"Board: {root}\n\n"
            "For each item, open the ticket on the board, paste or drop the image into a comment, and add a line "
            "saying what it shows. Then tick the item here by changing `- [ ]` to `- [x]`. Claude checks ticked items "
            "against the board and will tell you if an image is missing.\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("action", choices=("add", "list", "sync"))
    ap.add_argument("key", nargs="?")
    ap.add_argument("kind", nargs="?", choices=KINDS)
    ap.add_argument("what", nargs="?")
    ap.add_argument("--how", default="", help="How the user can produce or find the image.")
    ap.add_argument("--file", help="Checklist file (only needed the first time; the board remembers it).")
    args = ap.parse_args(argv)
    root, board_path = board_dir_paths(args.board_dir)
    board = json.loads(board_path.read_text(encoding="utf-8"))
    path = checklist_path(root, board, args.file)
    tickets = {t["id"]: t for t in board["tickets"]}

    if args.action == "add":
        if not (args.key and args.kind and args.what):
            ap.error('add needs: <KEY> <kind> "<what it must show>"')
        if args.key not in tickets:
            ap.error(f"There is no ticket {args.key} on the board.")
        item_id = f"{args.key}/{args.kind}/{hashlib.sha1(args.what.strip().lower().encode()).hexdigest()[:8]}"
        existing = parse(path)
        if any(i["id"] == item_id for i in existing):
            print(f"Already listed in {path}: {args.key} {args.kind}.")
            return 0
        added = boardlib.now_iso()
        what = args.what.strip().replace("\n", " ")
        block = f"- [ ] **{args.key}** {tickets[args.key]['title']}: {what} ({args.kind})\n"
        if args.how.strip():
            block += f"  How: {args.how.strip()}\n"
        block += f"  <!-- item: {item_id}; added: {added} -->\n"
        created = not path.exists()
        text = header(board, root) + "\n" if created else path.read_text(encoding="utf-8").rstrip("\n") + "\n"
        boardlib.atomic_write(path, (text + block).encode("utf-8"))
        (root / ".design-checklist-path").write_text(str(path) + "\n", encoding="utf-8")
        print(f"{'Created' if created else 'Updated'} {path}: added {args.key} {args.kind} "
              f"({len(existing) + 1} item{'s' if existing else ''} in the file).")
        return 0

    items = parse(path)
    if not path.exists():
        print("No design checklist for this board yet.")
        return 0
    if args.action == "list":
        open_items = [i for i in items if not i["done"]]
        print(f"{path}: {len(items)} items, {len(open_items)} not yet ticked.")
        for i in items:
            print(f"  [{'x' if i['done'] else ' '}] {i['key']} {i['text']}")
        return 0

    # sync: compare ticks with images on the tickets
    verified, missing, untick, outstanding = [], [], [], []
    for i in items:
        t = tickets.get(i["key"])
        since = i["added"] or "0000"
        # Only an image added after the request, and not one the audit attached itself, answers it.
        has_image = bool(t) and any(IMAGE.search(c.get("body", "")) and c.get("author") != "audit"
                                    and c.get("updatedAt", c.get("createdAt", "")) > since
                                    for c in t.get("comments", []))
        if i["done"] and has_image:
            verified.append(i)
        elif i["done"]:
            missing.append(i)
        elif has_image:
            untick.append(i)
        else:
            outstanding.append(i)
    print(f"{path}")
    for title, group in (("Verified (ticked, image on the ticket)", verified),
                         ("Ticked, but no new image found on the ticket", missing),
                         ("Image found on the ticket, but not ticked", untick),
                         ("Still needed", outstanding)):
        print(f"{title}: {len(group)}")
        for i in group:
            print(f"  {i['key']} {i['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
