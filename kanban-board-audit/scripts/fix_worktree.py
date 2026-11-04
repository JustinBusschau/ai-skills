#!/usr/bin/env python3
"""A separate place to make a small fix the manager accepted, away from their own checkout.

    fix_worktree.py <board-dir> create <repo-id> <slug>        new branch audit-fix/<date>-<slug> + worktree
    fix_worktree.py <board-dir> run <repo-id> <slug> <kind>    run an approved command (lint, test, ...) there
    fix_worktree.py <board-dir> diff <repo-id> <slug>          show what changed
    fix_worktree.py <board-dir> remove <repo-id> <slug> [--delete-branch]

Ask the manager before `create`: it adds a branch to their repository. The
branch starts at the default branch's tip and its worktree lives at
<board-dir>/.audit/fixes/<repo-id>-<slug>, so the user's checkout, its
branch, and their uncommitted work are never touched. Make the change in
that folder. The worktree is new, so run the approved `setup` command there
first if the repository has one (dependencies are not shared with the
audit's own worktree), then `run` the relevant approved command to show the
fix works (only approved commands run, as in a scan; git hooks do not run).
Ask before committing, and say that committing runs the repository's own
commit hooks (husky, lint-staged, pre-commit), which execute its code;
commit with `git -C <worktree> commit`. Never push: tell the
manager the branch name so they can review and push it. `remove` deletes the
worktree (and, with --delete-branch, the branch).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # set before importing auditlib, so no cache lands in the skill
from auditlib import require_git, approval_state, board_paths, default_branch, git, latest_run_dir, load_approvals, load_board

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scan_repos import run_command  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("action", choices=("create", "run", "diff", "remove"))
    ap.add_argument("repo")
    ap.add_argument("slug")
    ap.add_argument("kind", nargs="?")
    ap.add_argument("--delete-branch", action="store_true")
    args = ap.parse_args(argv)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", args.slug):
        ap.error("slug must be lower-case letters, digits, and hyphens, e.g. trailing-whitespace")
    require_git()
    paths = board_paths(args.board_dir)
    board = load_board(paths)
    repo = next((r for r in board.get("repos", []) if r["id"] == args.repo), None)
    if repo is None:
        ap.error(f"No repository '{args.repo}' on this board.")
    wt = paths["root"] / ".audit" / "fixes" / f"{repo['id']}-{args.slug}"
    record = wt.parent / f"{repo['id']}-{args.slug}.json"

    if args.action == "create":
        ref, branch = default_branch(repo)
        if not ref:
            print("No default branch found; set defaultBranch on the board.")
            return 1
        if wt.exists():
            print(f"{wt} already exists; use it, or remove it first.")
            return 1
        name = f"audit-fix/{dt.date.today().isoformat()}-{args.slug}"
        wt.parent.mkdir(parents=True, exist_ok=True)
        try:
            # --no-track: the fix branch must not track main, so no push or sync can land it there.
            git(repo["path"], "worktree", "add", "--no-track", "-b", name, str(wt), ref, timeout=900)
        except RuntimeError as exc:
            print(f"Could not create the fix branch: {exc}")
            return 1
        record.write_text(json.dumps({"branch": name, "base": ref}), encoding="utf-8")
        print(f"Created branch {name} from {branch} in {wt}. Make the change there.")
        return 0

    if not wt.exists():
        print(f"No fix worktree {wt}; create it first.")
        return 1
    info = json.loads(record.read_text(encoding="utf-8")) if record.exists() else {}

    if args.action == "run":
        if not args.kind:
            ap.error("run needs a command kind, e.g. lint")
        cmd = (repo.get("commands") or {}).get(args.kind)
        state = approval_state(load_approvals(paths), repo, args.kind, info.get("base"))
        if not cmd or state != "approved":
            print(f"The {args.kind} command is {state if cmd else 'not defined'}; not running it.")
            return 1
        run = latest_run_dir(paths)
        log_dir = (run / "logs") if run else wt.parent
        result = run_command(cmd, wt, log_dir / f"{repo['id']}-fix-{args.slug}-{args.kind}.log", 900)
        print(f"{args.kind}: {'passed' if result['exitCode'] == 0 else 'FAILED'} (exit {result['exitCode']}) on "
              f"{info.get('branch', 'the fix branch')}\n{result['tail'][-2000:]}")
        return 0 if result["exitCode"] == 0 else 1

    if args.action == "diff":
        print(git(wt, "status", "--short") + git(wt, "diff", "--stat") + git(wt, "diff"))
        return 0

    git(repo["path"], "worktree", "remove", "--force", str(wt), check=False)
    if args.delete_branch and info.get("branch"):
        git(repo["path"], "branch", "-D", info["branch"], check=False)
    record.unlink(missing_ok=True)
    print(f"Removed {wt}" + (f" and branch {info['branch']}" if args.delete_branch and info.get("branch") else
                             f"; branch {info.get('branch')} is kept"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
