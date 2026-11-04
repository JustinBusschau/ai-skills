#!/usr/bin/env python3
"""Gather evidence from the repositories a board lists.

    scan_repos.py <board-dir> [--since YYYY-MM-DD[THH:MM:SS]] [--run setup,test,lint,build]
                  [--timeout 900] [--no-fetch]
    scan_repos.py <board-dir> --remove-worktrees

Creates a run folder, audits/<date>T<HHMMSS>/ (printed at the end), holding
scan.json and full command logs. For each repository in the board's `repos`
it records:

- the default branch (the repo's `defaultBranch`, else origin's HEAD, else
  main or master; the remote-tracking branch when there is one) and the
  commit at its tip;
- every commit on a branch, remote branch, or tag (never stashes) whose
  message names a ticket key, and every such commit since --since, each with
  its files, whether it is on the default branch, and a web link for GitHub,
  GitLab, or Bitbucket;
- branches whose names contain a ticket key, with the commits only they hold
  (for teams that put keys in branch names rather than messages);
- with the GitHub CLI `gh` signed in, pull requests whose title or branch
  names a key, including the merge commit of merged ones.

Commands run in the audit's own worktree at .audit/worktrees/<repo-id>, reset
to the default branch's tip each time, so they test exactly the shared code
whatever the user has checked out, and the user's working copy is never
touched. Approved commands run in the order setup, build, test, lint (setup
installs dependencies, e.g. `npm ci`), with CI=true so test runners do not
wait in watch mode. Each result records the commit tested, its exit code and
duration, the last 200 lines of output, and the full log in the run folder.
Only approved commands run (commands.py); others are listed as skipped.

The scan runs `git fetch` first unless --no-fetch (updating remote-tracking
branches only). --since defaults to when the previous stand-up was written,
so a daily stand-up covers everything since the last one, or to yesterday
00:00 for the first audit. --remove-worktrees deletes the audit's worktrees.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True  # set before importing auditlib, so no cache lands in the skill
from auditlib import (require_git, NO_HOOKS, approval_state, audit_lock, board_in_container, board_paths, default_branch,
                      ensure_gitignore, git,
                      key_regex, load_approvals, load_board, new_run_dir, prepare_worktree, remove_worktree, run_dirs)

TAIL_LINES = 200
LOG_FORMAT = "--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1d"
RUN_ORDER = ("setup", "build", "test", "lint")  # build first: tests often import built packages


def web_base(remote: str):
    """https://host/owner/repo for GitHub, GitLab, and Bitbucket remotes (https or ssh), else None."""
    if not remote:
        return None
    m = re.match(r"^(?:git@|ssh://git@)([^:/]+)[:/](.+?)(?:\.git)?/?$", remote) or \
        re.match(r"^https?://(?:[^@/]+@)?([^/]+)/(.+?)(?:\.git)?/?$", remote)
    if not m or not any(h in m.group(1) for h in ("github", "gitlab", "bitbucket")):
        return None
    return f"https://{m.group(1)}/{m.group(2)}"


def commit_url(base, sha):
    if not base:
        return None
    return f"{base}/commits/{sha}" if "bitbucket" in base else f"{base}/commit/{sha}"


def parse_log(text, key_re):
    commits = []
    for block in text.split("\x1e"):
        block = block.strip("\n")
        if not block:
            continue
        head, _, files = block.partition("\x1d")
        sha, author, date, subject, body = (head.split("\x1f") + [""] * 5)[:5]
        commits.append({
            "sha": sha, "author": author, "date": date, "subject": subject,
            "keys": sorted(set(k.upper() for k in key_re.findall(subject + "\n" + body))),
            "files": [f for f in files.strip().splitlines() if f.strip()],
        })
    return commits


def pull_requests(base, key_re):
    """Pull requests naming tickets via the GitHub CLI; (list, None) or (None, reason)."""
    if not base or "github" not in base:
        return None, "pull requests are only read for GitHub remotes"
    if not shutil.which("gh"):
        return None, "the GitHub CLI (gh) is not installed"
    slug = base.split("github.com/", 1)[-1]
    try:
        r = subprocess.run(["gh", "pr", "list", "--repo", slug, "--state", "all", "--limit", "200",
                            "--json", "number,title,headRefName,state,url,mergedAt,mergeCommit"],
                           capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return None, "gh timed out"
    if r.returncode != 0:
        return None, "gh could not list pull requests: " + (r.stderr.strip().splitlines() or ["unknown error"])[0]
    prs = []
    for pr in json.loads(r.stdout or "[]"):
        keys = sorted(set(k.upper() for k in key_re.findall(pr["title"] + " " + pr["headRefName"])))
        if keys:
            merge = (pr.get("mergeCommit") or {}).get("oid")
            prs.append({"number": pr["number"], "title": pr["title"], "branch": pr["headRefName"], "state": pr["state"],
                        "url": pr["url"], "mergedAt": pr.get("mergedAt"), "mergeCommit": merge, "keys": keys})
    return prs, None


def run_command(cmd, cwd, log_path, timeout):
    """Run one approved command in its own process group; kill the group on timeout."""
    start = time.time()
    # CI=true keeps test runners out of watch mode; no __pycache__ in the worktree.
    env = dict(os.environ, CI="true", PYTHONDONTWRITEBYTECODE="1")
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(cmd, shell=True, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, start_new_session=True, env=env)
        try:
            code, timed_out = proc.wait(timeout=timeout), False
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            code, timed_out = None, True
    lines = Path(log_path).read_text(encoding="utf-8", errors="replace").splitlines()
    return {"exitCode": code, "timedOut": timed_out, "seconds": round(time.time() - start, 1),
            "tail": "\n".join(lines[-TAIL_LINES:]), "log": str(log_path)}


def previous_standup_tips(paths) -> dict:
    """Each repository's default-branch tip as recorded by the run the stand-up window starts from."""
    full = []
    for run in run_dirs(paths):
        try:
            data = json.loads((run / "scan.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (run / "standup.md").exists() and not data.get("decisionsOnly"):
            full.append((run, data))
    pick = [d for r, d in full if (r / "OVERNIGHT").exists()] or [d for r, d in full]
    return {r["id"]: r.get("defaultTip") for r in pick[-1]["repos"]} if pick else {}


def previous_standup_time(paths):
    """Start of the window for the next stand-up.

    The previous overnight run's time if there has been one (so ad hoc daytime
    audits do not shorten the daily stand-up), otherwise the previous full
    audit that wrote a stand-up; decisions-only runs never count.
    """
    full = []
    for run in run_dirs(paths):
        try:
            data = json.loads((run / "scan.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (run / "standup.md").exists() and not data.get("decisionsOnly"):
            try:  # when the stand-up was written, after that run's own changes
                written = json.loads((run / "standup.json").read_text(encoding="utf-8"))["writtenAt"]
            except (OSError, ValueError, KeyError):
                written = data.get("scannedAt")
            full.append((run, written))
    overnight = [t for r, t in full if (r / "OVERNIGHT").exists()]
    if overnight:
        return overnight[-1]
    return full[-1][1] if full else None


def scan_repo(repo, paths, run_dir, approvals, kinds, since, key_re, prefix, known, fetch, timeout, previous_tips=None):
    entry = {"id": repo["id"], "path": repo["path"], "problems": [], "notes": [], "commands": {}}
    path = repo["path"]
    if not Path(path).is_dir():
        entry["problems"].append(f"{path} does not exist on this machine.")
        return entry
    try:
        git(path, "rev-parse", "--is-inside-work-tree")
    except RuntimeError as exc:
        entry["problems"].append(f"Not a git repository: {exc}")
        return entry
    if fetch:
        try:
            r = subprocess.run(["git", *NO_HOOKS, "-C", path, "fetch", "--all", "--prune", "--quiet"], capture_output=True,
                               text=True, timeout=120, env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
            if r.returncode != 0:
                entry["notes"].append("git fetch failed, so remote work since the last fetch is not visible: "
                                      + (r.stderr.strip().splitlines() or ["unknown error"])[-1])
        except subprocess.TimeoutExpired:
            entry["notes"].append("git fetch timed out; remote work since the last fetch is not visible.")
    remote = repo.get("remote") or git(path, "remote", "get-url", "origin", check=False).strip()
    base = web_base(remote)
    ref, branch = default_branch(repo)
    if not ref:
        entry["problems"].append("No default branch found; set defaultBranch for this repository on the board.")
        return entry
    tip = git(path, "rev-parse", ref, check=False).strip()
    entry.update({"defaultBranch": branch, "defaultRef": ref, "defaultTip": tip, "webBase": base})
    if not ref.startswith("origin/"):
        entry["notes"].append(f"No remote-tracking branch was found, so the audit used the local {ref}, which may "
                              "include commits nobody has pushed. Set defaultBranch or fetch the remote.")
    if git(path, "rev-parse", "--is-shallow-repository", check=False).strip() == "true":
        entry["notes"].append("This is a shallow clone, so older commits are missing: 'on the default branch' "
                              "can be wrong for them. Run `git fetch --unshallow` for reliable evidence.")
    ancestry = {}

    def on_default(sha):
        """Whether `sha` is in the default branch's history (exact, whatever the repository's size)."""
        if sha not in ancestry:
            r = subprocess.run(["git", "-C", path, "merge-base", "--is-ancestor", sha, ref], capture_output=True)
            ancestry[sha] = r.returncode == 0
        return ancestry[sha]

    # Branches, remote branches, and tags only: never stashes or other private refs.
    scope = ("--branches", "--remotes", "--tags")
    # git's --grep is a coarse first pass; key_re (in parse_log) decides what really names a ticket.
    keyed = parse_log(git(path, "log", *scope, "-i", "--max-count=3000", f"--grep={prefix}-[0-9]",
                          "--name-only", LOG_FORMAT, check=False), key_re)
    # New on the default branch since the previous stand-up's tip (by ancestry, so a
    # commit made yesterday but pushed today still counts), plus other branches by date.
    prev_tip = (previous_tips or {}).get(repo["id"])
    if prev_tip and subprocess.run(["git", "-C", path, "merge-base", "--is-ancestor", prev_tip, ref],
                                   capture_output=True).returncode == 0:
        on_main = parse_log(git(path, "log", f"{prev_tip}..{ref}", "--max-count=1000", "--name-only", LOG_FORMAT,
                                check=False), key_re)
    else:
        on_main = parse_log(git(path, "log", ref, f"--since={since}", "--max-count=1000", "--name-only", LOG_FORMAT,
                                check=False), key_re)
    others = parse_log(git(path, "log", *scope, "--not", ref, f"--since={since}", "--max-count=1000", "--name-only",
                           LOG_FORMAT, check=False), key_re)
    recent = on_main + [c for c in others if c["sha"] not in {x["sha"] for x in on_main}]
    for c in keyed + recent:
        c["url"] = commit_url(base, c["sha"])
        c["onDefaultBranch"] = on_default(c["sha"])
        c["unknownKeys"] = [k for k in c["keys"] if k not in known]
    entry["keyedCommits"] = [c for c in keyed if c["keys"]]
    entry["recentCommits"] = recent

    branches = [b for b in git(path, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes",
                               check=False).splitlines() if key_re.search(b) and not b.endswith("/HEAD")]
    entry["keyedBranches"] = []
    for b in branches:
        own = parse_log(git(path, "log", f"{ref}..{b}", "--max-count=200", "--name-only", LOG_FORMAT, check=False), key_re)
        for c in own:
            c["url"] = commit_url(base, c["sha"])
        entry["keyedBranches"].append({"branch": b, "keys": sorted(set(k.upper() for k in key_re.findall(b))),
                                       "commitsNotOnDefault": own})
    prs, why = pull_requests(base, key_re)
    entry["pullRequests"] = prs
    if prs is None:
        entry["notes"].append(f"Pull requests not checked: {why}.")
    else:
        for pr in prs:
            pr["mergeCommitOnDefault"] = bool(pr.get("mergeCommit")) and on_default(pr["mergeCommit"])

    # Commands: in the audit's own worktree at the default branch's tip.
    wanted = [k for k in RUN_ORDER if k in kinds and (repo.get("commands") or {}).get(k)]
    if wanted:
        try:
            wt = prepare_worktree(paths, repo, ref)
        except RuntimeError as exc:
            entry["problems"].append(f"Could not prepare the audit's worktree: {exc}")
            wanted = []
    setup_failed = False
    if "setup" in (repo.get("commands") or {}) and approval_state(approvals, repo, "setup", ref) != "approved" \
            and any(k != "setup" for k in wanted):
        entry["notes"].append("The setup command is not approved, so dependencies may be missing in the audit's "
                              "worktree; failures such as 'Cannot find module' then mean 'could not test'.")
    for kind in wanted:
        cmd = repo["commands"][kind]
        state = approval_state(approvals, repo, kind, ref)
        if state != "approved":
            entry["commands"][kind] = {"command": cmd, "skipped": state}
            continue
        if setup_failed:
            entry["commands"][kind] = {"command": cmd, "skipped": "not run because setup failed"}
            continue
        log_path = run_dir / "logs" / f"{repo['id']}-{kind}.log"
        print(f"running {repo['id']} {kind} on {branch} {tip[:7]}: {cmd}", flush=True)
        entry["commands"][kind] = {"command": cmd, "commit": tip, "branch": branch,
                                   **run_command(cmd, wt, log_path, timeout)}
        if kind == "setup" and entry["commands"][kind]["exitCode"] != 0:
            setup_failed = True
            entry["problems"].append("Setup failed, so the environment is not ready: treat this as 'could not "
                                     "test', not as a code failure. See the setup log.")
    return entry


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("board_dir")
    ap.add_argument("--since", help="YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS; defaults to the previous stand-up's time.")
    ap.add_argument("--run", default="setup,test,lint,build", help="Approved command kinds to run.")
    ap.add_argument("--timeout", type=int, default=900, help="Seconds allowed per command (default 900).")
    ap.add_argument("--no-fetch", action="store_true", help="Do not run git fetch first.")
    ap.add_argument("--remove-worktrees", action="store_true", help="Delete the audit's worktrees and stop.")
    ap.add_argument("--overnight", action="store_true", help="Mark this run as tonight's scheduled run.")
    ap.add_argument("--board-check", action="store_true",
                    help="Only report whether the board is served from Docker right now (exit 3 if so), then stop.")
    args = ap.parse_args(argv)

    require_git()
    paths = board_paths(args.board_dir)
    board = load_board(paths)
    if args.board_check:
        live = board_in_container(paths)
        print("The board is served from Docker right now: do not apply changes; leave them PENDING." if live
              else "The board is not served from Docker: changes can be applied.")
        return 3 if live else 0
    if args.remove_worktrees:
        with audit_lock(paths):
            outcomes = [remove_worktree(paths, repo) for repo in board.get("repos", [])]
        print("\n".join(outcomes) or "No repositories.")
        return 1 if any("could not" in o for o in outcomes) else 0
    approvals = load_approvals(paths)
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat() + "T00:00:00"
    since = args.since or previous_standup_time(paths) or yesterday
    if len(since) == 10:
        since += "T00:00:00"  # a date means its start, as the stand-up reads it (git would use the current time)
    try:
        dt.datetime.fromisoformat(since)
    except ValueError:
        ap.error("--since must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS.")
    kinds = [k.strip() for k in args.run.split(",") if k.strip()]

    ensure_gitignore(paths["root"])
    with audit_lock(paths):
        return scan(args, paths, board, approvals, since, kinds)


def scan(args, paths, board, approvals, since, kinds) -> int:
    run_dir = new_run_dir(paths)
    if args.overnight:
        (run_dir / "OVERNIGHT").write_text(dt.datetime.now().isoformat(timespec="seconds") + "\n")
    prefix = board["board"]["keyPrefix"]
    key_re = key_regex(prefix)
    known = {t["id"] for t in board["tickets"]}
    result = {"board": board["board"]["title"], "keyPrefix": prefix, "since": since, "runDir": str(run_dir),
              "boardInContainer": board_in_container(paths),
              "scannedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "repos": []}
    tips = {} if args.since else previous_standup_tips(paths)
    for repo in board.get("repos", []):
        result["repos"].append(scan_repo(repo, paths, run_dir, approvals, kinds, since, key_re, prefix, known,
                                         not args.no_fetch, args.timeout, tips))

    scan_path = run_dir / "scan.json"
    scan_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    for r in result["repos"]:
        cmds = ", ".join(f"{k} " + (f"skipped ({v['skipped']})" if "skipped" in v else
                                    "timed out" if v.get("timedOut") else f"exit {v['exitCode']}")
                         for k, v in r["commands"].items()) or "no commands run"
        print(f"{r['id']}: {len(r.get('keyedCommits', []))} commits name tickets, "
              f"{len(r.get('recentCommits', []))} since {since}; {cmds}"
              + "".join(f"\n  problem: {p}" for p in r["problems"]) + "".join(f"\n  note: {n}" for n in r["notes"]))
    print(f"Run folder: {run_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
