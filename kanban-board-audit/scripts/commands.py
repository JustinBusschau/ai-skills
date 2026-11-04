#!/usr/bin/env python3
"""List, approve, or revoke the repository commands an audit may run.

    commands.py <board-dir> list [--fetch]
    commands.py <board-dir> approve <repo-id> [setup test lint build] [start] [--scope strict|commands]
    commands.py <board-dir> revoke <repo-id> [kinds]

Running a repository's setup, test, lint, build, or start command executes
that repository's code on this machine, so scan_repos.py and app_server.py
run only approved commands. Show the user `list` and get their explicit
agreement before running `approve`.

What an approval means: the audit may run that command, in its own worktree
of the default branch, whenever it runs. Each run tests the newest code on
that branch: that is the purpose, so new commits' code does run under an
approval. What the approval pins depends on its scope:

- strict (the default): the command text, plus every file that decides what
  the commands run or what setup installs, anywhere in the repository, as
  committed now: build and task files, package manifests, lockfiles,
  requirements files, package manager settings, and submodule pointers. When
  any of those changes on the default branch (a merged dependency bump, say),
  the approval lapses and the command is skipped until approved again. In a
  busy repository that can be most days.
- commands: the command text only. Approvals do not lapse when dependencies
  or scripts change, so new dependencies are installed and changed scripts
  run without asking. Offer this only if the user accepts that.

`list --fetch` fetches first, so it shows what the next scan will see. Without
kinds, `approve` covers setup, test, lint, and build; `start` (which launches
the app) must be named. `revoke` without kinds revokes everything for that
repository, start included.

Approvals are kept in <board-dir>/.audit/approvals.json, outside data/, so
neither the browser nor the board server can change them.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

sys.dont_write_bytecode = True  # set before importing auditlib, so no cache lands in the skill
from auditlib import (require_git, KINDS, approval_state, board_paths, command_hash, default_branch, definitions_hash,
                      ensure_gitignore, git, load_approvals, load_board, save_approvals)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("action", choices=("list", "approve", "revoke"))
    ap.add_argument("repo", nargs="?")
    ap.add_argument("kinds", nargs="*")
    ap.add_argument("--fetch", action="store_true", help="With list: git fetch first.")
    ap.add_argument("--scope", choices=("strict", "commands"), default="strict", help="With approve: what it pins.")
    args = ap.parse_args(argv)
    require_git()
    paths = board_paths(args.board_dir)
    board = load_board(paths)
    approvals = load_approvals(paths)
    repos = board.get("repos", [])

    if args.action == "list":
        if not repos:
            print("This board lists no repositories. Add them with edit_board.py add-repo.")
            return 1
        for r in repos:
            if args.fetch:
                git(r["path"], "fetch", "--all", "--quiet", check=False, timeout=120)
            ref, name = default_branch(r)
            print(f"{r['id']}  ({r['path']}, default branch {name or 'not found'})")
            for kind in KINDS:
                cmd = (r.get("commands") or {}).get(kind)
                if not cmd:
                    continue
                entry = approvals.get(r["id"], {}).get(kind)
                state = approval_state(approvals, r, kind, ref)
                state = (f"approved {entry['approvedAt']}" + (", scope: command text only" if entry.get("scope") == "commands" else "")
                         if state == "approved" else state.upper() if entry else state)
                print(f"  {kind:6} {cmd}    [{state}]")
        return 0

    repo = next((r for r in repos if r["id"] == args.repo), None)
    if repo is None:
        ap.error(f"No repository '{args.repo}'. Repositories: {', '.join(r['id'] for r in repos) or 'none'}.")
    commands = repo.get("commands") or {}
    if args.action == "revoke":
        kinds = args.kinds or list(KINDS)
    else:
        kinds = args.kinds or [k for k in ("setup", "test", "lint", "build") if commands.get(k)]
    bad = [k for k in kinds if k not in KINDS or (args.action == "approve" and not commands.get(k))]
    if bad:
        ap.error(f"{repo['id']} has no {', '.join(bad)} command.")
    ref, branch = default_branch(repo)
    if args.action == "approve" and not ref:
        ap.error(f"No default branch found for {repo['id']}; set defaultBranch on the board first.")
    entry = approvals.setdefault(repo["id"], {})
    for kind in kinds:
        if args.action == "approve":
            cmd = commands[kind]
            entry[kind] = {"command": cmd, "path": repo["path"], "sha256": command_hash(repo["path"], cmd),
                           "definitions": definitions_hash(repo["path"], ref), "definitionsAt": ref,
                           "scope": args.scope, "approvedAt": dt.datetime.now().isoformat(timespec="minutes")}
            print(f"approved {repo['id']} {kind}: {cmd}  (scope {args.scope}, as defined on {branch})")
        elif entry.pop(kind, None):
            print(f"revoked {repo['id']} {kind}")
    save_approvals(paths, approvals)
    ensure_gitignore(paths["root"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
