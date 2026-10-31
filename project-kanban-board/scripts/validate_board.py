#!/usr/bin/env python3
"""Validate a board.json, or check that a plan expands into a valid board.

    validate_board.py path/to/data/board.json
    validate_board.py --plan plan.json
    validate_board.py --plan more.json --board path/to/board-project   (an append plan)

Prints every problem found and exits 1 if there are any, 0 if valid.
"""

from __future__ import annotations

import argparse
import json
import sys
sys.dont_write_bytecode = True  # keep the skill folder free of caches
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "assets" / "app"))
import boardlib  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", help="board.json, or a plan file with --plan")
    ap.add_argument("--plan", action="store_true", help="Treat the file as a plan and test its expansion.")
    ap.add_argument("--board", help="With --plan: test it as an append to this board (project dir or board.json).")
    ap.add_argument("--allow-duplicates", action="store_true",
                    help="With --board: accept tickets that duplicate existing titles, as create_board.py --append can.")
    args = ap.parse_args(argv)
    try:
        data = json.loads(Path(args.path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read {args.path}: {exc}")
        return 1
    if args.plan:
        existing = None
        if args.board:
            bp = Path(args.board)
            bp = bp / "data" / "board.json" if bp.is_dir() else bp
            try:
                existing = json.loads(bp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"Could not read {bp}: {exc}")
                return 1
        try:
            board = boardlib.build_board_from_plan(data, existing=existing)
        except boardlib.BoardError as exc:
            problems = exc.problems
        else:
            problems = []
            new_ids = {t["id"] for t in board["tickets"][len(existing["tickets"]) if existing else 0:]}
            if existing:
                # Same refusals and notes as create_board.py --append.
                for t in ([] if args.allow_duplicates else boardlib.append_duplicates(existing, board)):
                    problems.append(f"{t['type']} '{t['title']}' already exists with the same parent; "
                                    "create_board.py --append will refuse it (unless --allow-duplicates).")
                ignored = [k for k in boardlib.APPEND_IGNORED if k in data]
                if ignored:
                    print(f"  note: appending ignores {', '.join(ignored)}.")
            if not problems:
                print(f"Plan is valid: {len(new_ids)} ticket{'' if len(new_ids) == 1 else 's'} would be "
                      f"{'added to the board' if existing else 'created'}.")
            for w in boardlib.board_warnings(board):
                if any(w.startswith(f"ticket {tid}:") for tid in new_ids) or not w.startswith("ticket "):
                    print("  warning: " + w)
    else:
        problems = boardlib.validate_board(data)
        if not problems:
            print(f"Board is valid: {len(data['tickets'])} tickets.")
            for w in boardlib.board_warnings(data):
                print("  warning: " + w)
    for p in problems:
        print("  - " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
