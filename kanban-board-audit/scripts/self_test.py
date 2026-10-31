#!/usr/bin/env python3
"""Check this skill's scripts against a throwaway board and repository.

    self_test.py

Builds the fixture from make_fixture.py in a temporary folder and checks:
command approval and its invalidation (command text and definition files);
that commands run in the audit's own worktree at the default branch, even
while the user has a dirty feature branch checked out, and never touch the
user's checkout; that stashes do not count as evidence; commit, branch, and
key matching; separate run folders; the stand-up's handling of open,
decided, and superseded proposals; app_server's approval gate and that it
serves the default branch, not the user's checkout; screenshots (if Chrome
is installed); and attaching evidence through edit_board.py --actor audit.
Prints PASS, FAIL, or SKIP per check and exits 1 if any check failed.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from auditlib import EDIT_BOARD, key_regex, run_dirs, board_paths  # noqa: E402

ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{(': ' + str(detail)[:300]) if detail and not ok else ''}")


def run(*cmd, **kw):
    return subprocess.run([sys.executable, *map(str, cmd)], capture_output=True, text=True, env=ENV, **kw)


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def latest_scan(board):
    return json.loads((run_dirs(board_paths(board))[-1] / "scan.json").read_text())


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="audit-selftest-"))
    try:
        r = run(HERE / "make_fixture.py", tmp)
        check("fixture builds", r.returncode == 0, r.stderr)
        board, repo = tmp / "recipe-board", tmp / "recipe-app"

        run(HERE / "scan_repos.py", board, "--since", "2026-10-29", "--no-fetch")
        cmds = latest_scan(board)["repos"][0]["commands"]
        check("unapproved commands are skipped, not run", cmds and all("skipped" in v for v in cmds.values()), cmds)

        r = run(HERE / "commands.py", board, "approve", "recipe-app")
        check("approve without kinds covers setup, test, lint, build but not start",
              r.returncode == 0 and "start" not in r.stdout and "test" in r.stdout, r.stdout + r.stderr)

        # The user is mid-way through work on a feature branch, with uncommitted changes and a stash.
        git(repo, "checkout", "-q", "-b", "feature/other")
        (repo / "recipes" / "scale.py").write_text("def scale(q, a, b):\n    return q * b / a\n")
        git(repo, "stash", "push", "-q", "-m", "trying RCP-5 export")
        (repo / "app" / "index.html").write_text("<h1>Unmerged feature</h1>")
        git(repo, "commit", "-q", "-am", "Unmerged experiment")
        (repo / "README.md").write_text("local edit\n")
        before = git(repo, "status", "--porcelain")

        run(HERE / "scan_repos.py", board, "--since", "2026-10-29", "--no-fetch")
        rep = latest_scan(board)["repos"][0]
        test = rep["commands"].get("test", {})
        main_tip = git(repo, "rev-parse", "main").strip()
        check("commands run in the audit's worktree on the default branch, whatever the user has checked out",
              test.get("exitCode") == 1 and "50.0 != 200" in test.get("tail", "") and test.get("commit") == main_tip,
              test)
        check("the user's checkout is untouched", git(repo, "status", "--porcelain") == before
              and git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip() == "feature/other")
        keys = sorted(k for c in rep["keyedCommits"] for k in c["keys"])
        check("setup runs before the tests", rep["commands"].get("setup", {}).get("exitCode") == 0, rep["commands"].get("setup"))
        check("stashes are not evidence; commits naming tickets are found with web links",
              keys == ["RCP-2", "RCP-3", "RCP-4"] and all(c["onDefaultBranch"] for c in rep["keyedCommits"])
              and all(c["url"].startswith("https://github.com/example/recipe-app/commit/") for c in rep["keyedCommits"]),
              keys)
        check("each scan gets its own run folder", len(run_dirs(board_paths(board))) >= 2)

        kr = key_regex("RCP")
        found = [bool(kr.search(b)) for b in ("RCP-5_export_list", "feature/rcp-2-search", "XRCP-2", "RCP-123")]
        check("ticket keys are matched in branch names", found == [True, True, False, True]
              and kr.findall("RCP-12 and RCP-123") == ["RCP-12", "RCP-123"], found)

        # Approval invalidation: a definition file changes on the default branch, then the command text.
        git(repo, "checkout", "-q", "main")
        git(repo, "stash", "list")
        (repo / "packages" / "api").mkdir(parents=True)
        (repo / "packages" / "api" / "package.json").write_text('{"scripts": {"test": "echo changed"}}')
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "Add api package")
        r = run(HERE / "commands.py", board, "list")
        check("a changed definition file anywhere in the repository revokes approval",
              "DEFINITION FILES CHANGED" in r.stdout, r.stdout)
        run(HERE / "commands.py", board, "approve", "recipe-app")
        b = json.loads((board / "data" / "board.json").read_text())
        b["repos"][0]["commands"]["test"] = "python3 -m unittest discover -v"
        (tmp / "ops.json").write_text(json.dumps([{"op": "update-repo", "repo": "recipe-app",
                                                    "commands": b["repos"][0]["commands"]}]))
        run(EDIT_BOARD, board, tmp / "ops.json")
        r = run(HERE / "commands.py", board, "list")
        check("a changed command loses its approval", "COMMAND CHANGED SINCE APPROVAL" in r.stdout, r.stdout)
        r = run(HERE / "commands.py", board, "revoke", "recipe-app")
        check("revoke without kinds revokes everything", "revoked recipe-app" in r.stdout and
              "approved" not in run(HERE / "commands.py", board, "list").stdout.replace("not approved", ""), r.stdout)

        # Proposals: open ones carry over; decided and superseded ones do not.
        runs = run_dirs(board_paths(board))
        (runs[0] / "proposals.json").write_text(json.dumps([
            {"id": "a", "kind": "other", "summary": "Decide RCP-5's owner", "status": "open"},
            {"id": "b", "kind": "move-back", "ticket": "RCP-4", "summary": "Overtaken proposal", "status": "open"},
            {"id": "c", "kind": "fix", "summary": "Old decided fix", "status": "approved"}]))
        (runs[-1] / "proposals.json").write_text(json.dumps([
            {"id": "b", "kind": "move-back", "ticket": "RCP-4", "summary": "Overtaken proposal", "status": "superseded"},
            {"id": "d", "kind": "move-back", "ticket": "RCP-4", "summary": "Move RCP-4 back to In progress", "status": "open"},
            {"id": "e", "kind": "fix", "summary": "Trailing whitespace", "status": "declined"}]))
        run(HERE / "standup.py", board)
        text = (runs[-1] / "standup.md").read_text()
        decisions = text.split("## Decisions for you")[1].split("##")[0]
        check("stand-up names the failing test, the lint problem, and what the audit could not see",
              "50.0 != 200" in text and "trailing whitespace" in text
              and "## What this audit could not see" in text, text[:1500])
        from standup import redact
        masked = redact("connect postgres://app:hunter2@db.internal token=abc123secret ghp_abcdefghij1234567890 "
                        "{'user': 'a', 'password': 'pw-quoted-1'} Authorization: Basic dXNlcjpwYXNzd29yZA==")
        check("stand-up masks common secrets", all(x not in masked for x in
              ("hunter2", "abc123secret", "ghp_abcdefghij", "pw-quoted-1", "dXNlcjpwYXNzd29yZA")), masked)
        check("stand-up lists open decisions from every run, not decided or superseded ones, and epic suggestions",
              "RCP-5's owner" in decisions and "Move RCP-4 back" in decisions and "Overtaken" not in decisions
              and "Trailing" not in decisions and "Old decided" not in text
              and "RCP-1" in text.split("## Epics to update")[1], decisions)

        # The app helper: gated, and serving the default branch even with a feature branch checked out.
        r = run(HERE / "app_server.py", board, "start", "recipe-app")
        check("app_server refuses an unapproved start command", r.returncode == 1 and "not approved" in r.stdout, r.stdout)
        port = free_port()
        b = json.loads((board / "data" / "board.json").read_text())
        cmds = b["repos"][0]["commands"]
        cmds["start"] = f"python3 -m http.server {port} --bind 127.0.0.1 --directory app"
        (tmp / "ops.json").write_text(json.dumps([{"op": "update-repo", "repo": "recipe-app", "commands": cmds,
                                                    "appUrl": f"http://127.0.0.1:{port}/"}]))
        run(EDIT_BOARD, board, tmp / "ops.json")
        run(HERE / "commands.py", board, "approve", "recipe-app", "start")
        git(repo, "checkout", "-q", "feature/other")
        r = run(HERE / "app_server.py", board, "start", "recipe-app", "--wait", "20")
        try:
            page = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
                f"http://127.0.0.1:{port}/", timeout=5).read().decode() if r.returncode == 0 else ""
            check("app_server serves the default branch, not the user's feature branch",
                  "Pancakes" in page and "Unmerged" not in page, r.stdout + page[:200])
            png = tmp / "shot.png"
            if shutil.which("google-chrome") or Path("/Applications/Google Chrome.app").exists():
                r2 = run(HERE / "capture_screenshot.py", f"http://127.0.0.1:{port}/", png)
                check("screenshot captured", r2.returncode == 0 and png.read_bytes().startswith(b"\x89PNG"), r2.stdout)
            else:
                print("SKIP  screenshot: no Chrome found")
                png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 16)
        finally:
            r3 = run(HERE / "app_server.py", board, "stop", "recipe-app")
        check("app_server stop frees the port", r3.returncode == 0 and "no longer answers" in r3.stdout, r3.stdout)
        r = run(HERE / "capture_screenshot.py", f"http://127.0.0.1:{port}/", tmp / "none.png")
        check("an unreachable page is refused", r.returncode == 1 and "did not answer" in r.stdout, r.stdout)

        r = run(EDIT_BOARD, board, "--actor", "audit", "--op", json.dumps(
            {"op": "attach", "id": "RCP-3", "file": str(png), "body": "Detail page for Pancakes."}))
        last = next(t for t in json.loads((board / "data" / "board.json").read_text())["tickets"]
                    if t["id"] == "RCP-3")["comments"][-1]
        check("screenshot attached to a ticket and marked as the audit's",
              r.returncode == 0 and "uploads/" in last["body"] and last.get("author") == "audit", r.stderr)

        # Hooks committed to the repository must never run.
        git(repo, "checkout", "-q", "main")
        (repo / ".githooks").mkdir()
        marker = tmp / "hook-ran"
        (repo / ".githooks" / "post-checkout").write_text(f"#!/bin/sh\ntouch {marker}\n")
        os.chmod(repo / ".githooks" / "post-checkout", 0o755)
        git(repo, "add", "-A")
        git(repo, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "Add hooks")
        git(repo, "config", "core.hooksPath", ".githooks")
        run(HERE / "scan_repos.py", board, "--no-fetch")
        check("git hooks in the repository never run during a scan", not marker.exists())
        git(repo, "config", "--unset", "core.hooksPath")

        # Scope: a lockfile change ends a strict approval but not a commands-only one.
        run(HERE / "commands.py", board, "approve", "recipe-app", "test")
        run(HERE / "commands.py", board, "approve", "recipe-app", "lint", "--scope", "commands")
        (repo / "requirements.txt").write_text("requests==2.0\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "Add requirements")
        listed = run(HERE / "commands.py", board, "list").stdout
        check("a new requirements file ends a strict approval but not a commands-only one",
              "test   " in listed and "DEFINITION FILES CHANGED" in listed.split("lint")[0]
              and "command text only" in listed, listed)

        # One audit at a time per board.
        sys.path.insert(0, str(HERE))
        from auditlib import audit_lock
        with audit_lock(board_paths(board)):
            r = run(HERE / "scan_repos.py", board, "--no-fetch")
        check("a second audit of the same board refuses to start while one runs",
              r.returncode != 0 and "Another audit" in (r.stdout + r.stderr), r.stdout + r.stderr)

        # The repository moves on disk: the worktree is repaired or recreated.
        moved = tmp / "moved-app"
        shutil.move(str(repo), str(moved))
        (tmp / "ops.json").write_text(json.dumps([{"op": "update-repo", "repo": "recipe-app", "path": str(moved)}]))
        run(EDIT_BOARD, board, tmp / "ops.json")
        run(HERE / "commands.py", board, "approve", "recipe-app", "test")
        run(HERE / "scan_repos.py", board, "--no-fetch")
        rep = latest_scan(board)["repos"][0]
        check("a moved repository's worktree is recovered", rep["commands"].get("test", {}).get("exitCode") == 1
              and not rep["problems"], rep["problems"] or rep["commands"])
        repo = moved

        # Fix worktree: its own branch and folder, approved commands only, user's checkout untouched.
        run(HERE / "commands.py", board, "approve", "recipe-app", "lint")
        head_before = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        r = run(HERE / "fix_worktree.py", board, "create", "recipe-app", "trailing-whitespace")
        fix_dir = board / ".audit" / "fixes" / "recipe-app-trailing-whitespace"
        target = fix_dir / "recipes" / "search.py"
        target.write_text(target.read_text().replace("term):   ", "term):"))
        r2 = run(HERE / "fix_worktree.py", board, "run", "recipe-app", "trailing-whitespace", "lint")
        r3 = run(HERE / "fix_worktree.py", board, "run", "recipe-app", "trailing-whitespace", "start")
        check("fix_worktree: separate branch, approved command passes, unapproved refused, user's checkout untouched",
              r.returncode == 0 and r2.returncode == 0 and "passed" in r2.stdout and r3.returncode == 1
              and git(repo, "rev-parse", "--abbrev-ref", "HEAD") == head_before
              and "audit-fix/" in git(repo, "branch", "--list", "audit-fix/*"), r.stdout + r2.stdout + r3.stdout)
        run(HERE / "fix_worktree.py", board, "remove", "recipe-app", "trailing-whitespace", "--delete-branch")

        # Earlier decisions are respected: declined waits a week, dismissed is final.
        runs = run_dirs(board_paths(board))
        (runs[-1] / "proposals.json").write_text(json.dumps([
            {"id": "x1", "key": "move-back:RCP-4", "kind": "move-back", "ticket": "RCP-4", "summary": "m", "status": "declined"},
            {"id": "x2", "key": "fix:recipe-app:ws", "kind": "fix", "summary": "f", "status": "dismissed"}]))
        c1 = run(HERE / "proposals.py", board, "check", "move-back:RCP-4")
        c2 = run(HERE / "proposals.py", board, "check", "fix:recipe-app:ws")
        c3 = run(HERE / "proposals.py", board, "check", "other:new-thing")
        check("proposals.py respects earlier decisions", c1.stdout.startswith("wait") and c2.stdout.startswith("never")
              and c3.returncode == 0 and c3.stdout.startswith("raise"), c1.stdout + c2.stdout + c3.stdout)

        # A commit made before the last stand-up but only now on the default branch still counts.
        run(HERE / "standup.py", board)  # the last run now has a stand-up; its tip starts the next window
        env_old = dict(os.environ, GIT_AUTHOR_DATE="2026-01-02T10:00:00", GIT_COMMITTER_DATE="2026-01-02T10:00:00")
        (repo / "late.txt").write_text("late\n")
        git(repo, "checkout", "-q", "main")
        subprocess.run(["git", "-C", str(repo), "add", "late.txt"], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m",
                        "RCP-5 late-pushed export work"], check=True, env=env_old)
        run(HERE / "scan_repos.py", board, "--no-fetch")
        recent = [c["subject"] for c in latest_scan(board)["repos"][0]["recentCommits"]]
        check("an old-dated commit new on the default branch is counted", "RCP-5 late-pushed export work" in recent,
              recent)
        check("a local-only default branch is flagged", any("local main" in n for n in latest_scan(board)["repos"][0]["notes"]))
        r = run(HERE / "scan_repos.py", board, "--board-check")
        check("board-check reports a board not served from Docker", r.returncode == 0, r.stdout)

        # Decisions-only runs get their own folder.
        before_runs = len(run_dirs(board_paths(board)))
        r = run(HERE / "standup.py", board, "--new-run")
        check("decisions-only mode gets its own run folder", len(run_dirs(board_paths(board))) == before_runs + 1
              and "Run folder" in r.stdout, r.stdout + r.stderr)
        newest = run_dirs(board_paths(board))[-1]
        check("a decisions-only stand-up says it has no scan results",
              "records decisions only" in (newest / "standup.md").read_text())

        run(HERE / "scan_repos.py", board, "--remove-worktrees")
        check("the audit's worktrees can be removed", "audit" not in git(repo, "worktree", "list").split("\n", 1)[-1])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = results.count(False)
    print(f"\n{len(results) - failed} passed, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
