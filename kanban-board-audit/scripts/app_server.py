#!/usr/bin/env python3
"""Start or stop a repository's app for screenshots, under the same approval rules as other commands.

    app_server.py <board-dir> start <repo-id> [--wait 60]
    app_server.py <board-dir> stop <repo-id>

start: runs the repository's `start` command only if it is approved
(commands.py approve <repo-id> start), in the audit's own worktree reset to
the default branch's tip (the same one scan_repos.py uses, so dependencies
its setup command installed are there), never in the user's checkout; and
only if nothing already answers at its appUrl, so the screenshot cannot come
from a different program. Waits until appUrl answers.
The command runs in its own process group, recorded in
<board-dir>/.audit/app-<repo-id>.json, with output in the latest run folder's logs/.

stop: ends that whole process group (dev servers start child processes),
then confirms appUrl no longer answers. Always run stop when done, including
after a failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True  # set before importing auditlib, so no cache lands in the skill
from auditlib import require_git, approval_state, board_paths, default_branch, latest_run_dir, load_approvals, load_board, prepare_worktree


def answers(url) -> bool:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=3):
            return True
    except urllib.error.HTTPError:
        return True  # something is answering, even if with an error status
    except Exception:
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("action", choices=("start", "stop"))
    ap.add_argument("repo")
    ap.add_argument("--wait", type=int, default=60, help="Seconds to wait for the app to answer (default 60).")
    args = ap.parse_args(argv)
    require_git()
    paths = board_paths(args.board_dir)
    board = load_board(paths)
    repo = next((r for r in board.get("repos", []) if r["id"] == args.repo), None)
    if repo is None:
        ap.error(f"No repository '{args.repo}' on this board.")
    url = repo.get("appUrl")
    if not url:
        print(f"{repo['id']} has no appUrl, so there is nothing to screenshot. Add one with edit_board.py update-repo.")
        return 1
    record = paths["root"] / ".audit" / f"app-{repo['id']}.json"

    if args.action == "stop":
        try:
            info = json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("No app started by the audit is recorded for this repository.")
            return 0 if not answers(url) else 1
        # After a crash or reboot the recorded process group may now belong to
        # something else: only signal it if its leader still runs from the worktree.
        cwd = None
        try:
            cwd = os.readlink(f"/proc/{info['pgid']}/cwd")  # Linux
        except OSError:
            if shutil.which("lsof"):
                cwd = subprocess.run(["lsof", "-a", "-p", str(info["pgid"]), "-d", "cwd", "-Fn"],
                                     capture_output=True, text=True).stdout
        if cwd is None:
            print(f"Cannot confirm process group {info['pgid']} is the app (no /proc or lsof); stop it yourself.")
            return 1
        if info.get("cwd") and info["cwd"] not in cwd:
            record.unlink(missing_ok=True)
            print("The recorded app process is gone (or the id now belongs to another program); nothing signalled.")
            return 0 if not answers(url) else 1
        try:
            os.killpg(info["pgid"], signal.SIGTERM)
            for _ in range(50):
                time.sleep(0.2)
                os.killpg(info["pgid"], 0)
            os.killpg(info["pgid"], signal.SIGKILL)
        except ProcessLookupError:
            pass
        record.unlink(missing_ok=True)
        time.sleep(0.5)
        if answers(url):
            print(f"Stopped the audit's process group, but {url} still answers: something else is serving it.")
            return 1
        print(f"Stopped {repo['id']}; {url} no longer answers.")
        return 0

    ref, branch = default_branch(repo)
    if not ref:
        print("No default branch found; set defaultBranch for this repository on the board.")
        return 1
    state = approval_state(load_approvals(paths), repo, "start", ref)
    if state != "approved":
        print(f"The start command is {state}. Ask the user, then: commands.py {args.board_dir} approve {repo['id']} start")
        return 1
    if answers(url):
        print(f"Something already answers at {url}; a screenshot could show the wrong program. Not starting.")
        return 1
    try:
        wt = prepare_worktree(paths, repo, ref)
    except RuntimeError as exc:
        print(f"Could not prepare the audit's worktree: {exc}")
        return 1
    run = latest_run_dir(paths)
    log_dir = (run / "logs") if run else (paths["root"] / ".audit")
    log_dir.mkdir(parents=True, exist_ok=True)
    log = open(log_dir / f"{repo['id']}-start.log", "wb")
    proc = subprocess.Popen(repo["commands"]["start"], shell=True, cwd=wt, stdout=log, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, start_new_session=True,
                            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
    record.parent.mkdir(parents=True, exist_ok=True)
    record.write_text(json.dumps({"pgid": proc.pid, "url": url, "cwd": str(wt)}), encoding="utf-8")
    deadline = time.time() + args.wait
    while time.time() < deadline:
        if proc.poll() is not None:
            record.unlink(missing_ok=True)
            if answers(url):
                print(f"The start command exited at once but {url} now answers: it started a server in the "
                      "background, which the audit cannot stop. Tell the user (it is running from "
                      f"{wt}), and change the start command to one that stays in the foreground.")
            else:
                print(f"The start command exited with {proc.returncode}; see {log.name}.")
            return 1
        if answers(url):
            print(f"Started {repo['id']} from {branch} at the default branch's tip (process group {proc.pid}); "
                  f"{url} answers. Stop it with: app_server.py {args.board_dir} stop {repo['id']}")
            return 0
        time.sleep(1)
    print(f"{url} did not answer within {args.wait} s; stopping it again.")
    main([args.board_dir, "stop", repo["id"]])
    return 1


if __name__ == "__main__":
    sys.exit(main())
