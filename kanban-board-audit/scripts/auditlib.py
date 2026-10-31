"""Shared helpers for the kanban-board-audit scripts.

Finds the project-kanban-board skill (whose boardlib and edit_board.py these
scripts build on), reads a board, resolves each repository's default branch,
keeps the audit's own git worktree of it, and manages command approvals.
Standard library only; Python 3.9 or newer.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # never leave caches in the skill folder


def kanban_skill_dir() -> Path:
    """project-kanban-board, normally installed beside this skill."""
    candidates = [os.environ.get("KANBAN_SKILL_DIR"), HERE.parent.parent / "project-kanban-board"]
    for c in candidates:
        if c and (Path(c) / "assets" / "app" / "boardlib.py").exists():
            return Path(c)
    sys.exit("Cannot find the project-kanban-board skill beside this one. Install it, or set KANBAN_SKILL_DIR.")


KANBAN = kanban_skill_dir()
sys.path.insert(0, str(KANBAN / "assets" / "app"))
import boardlib  # noqa: E402

EDIT_BOARD = KANBAN / "scripts" / "edit_board.py"
KINDS = ("setup", "test", "lint", "build", "start")


# ---------------------------------------------------------------------------
# Board and run folders

def board_paths(board_dir) -> dict:
    root = Path(board_dir).expanduser().resolve()
    if not (root / "data" / "board.json").exists():
        sys.exit(f"{root} is not a board folder (no data/board.json).")
    return {
        "root": root,
        "board": root / "data" / "board.json",
        "approvals": root / ".audit" / "approvals.json",
        "worktrees": root / ".audit" / "worktrees",
        "audits": root / "audits",
    }


def load_board(paths) -> dict:
    board = json.loads(paths["board"].read_text(encoding="utf-8"))
    problems = boardlib.validate_board(board)
    if problems:
        sys.exit("The board is invalid; fix it first:\n  - " + "\n  - ".join(problems[:20]))
    return board


def today() -> str:
    return dt.date.today().isoformat()


def new_run_dir(paths) -> Path:
    """Each audit run gets its own folder, audits/<date>T<HHMMSS>, so a second run never overwrites the first."""
    stamp = dt.datetime.now().strftime("%Y-%m-%dT%H%M%S")
    paths["audits"].mkdir(parents=True, exist_ok=True)
    n = 1
    while True:  # mkdir is atomic, so two runs in the same second each get their own folder
        run = paths["audits"] / (stamp if n == 1 else f"{stamp}-{n}")
        try:
            run.mkdir()
            break
        except FileExistsError:
            n += 1
    (run / "logs").mkdir()
    return run


@contextlib.contextmanager
def audit_lock(paths):
    """One audit at a time per board: concurrent runs would share (and reset) the same worktrees."""
    lock_path = paths["root"] / ".audit" / "run.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(lock_path, "a+")
    try:
        if fcntl is not None:
            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                sys.exit("Another audit of this board is running; wait for it to finish.")
        yield
    finally:
        fh.close()


def run_dirs(paths) -> list:
    """Every run folder, oldest first."""
    def order(p):  # "2026-11-05T021000" then "2026-11-05T021000-2", ...
        suffix = p.name[18:]
        return (p.name[:17], int(suffix) if suffix.isdigit() else 1)
    return sorted((p for p in paths["audits"].glob("????-??-??T??????*") if p.is_dir()), key=order)


def latest_run_dir(paths):
    runs = run_dirs(paths)
    return runs[-1] if runs else None


def ensure_gitignore(root: Path) -> None:
    """Audit output can hold test logs, and approvals and worktrees are machine-local: keep them out of git."""
    gi = root / ".gitignore"
    have = gi.read_text(encoding="utf-8").splitlines() if gi.exists() else []
    missing = [l for l in ("audits/", ".audit/") if l not in have]
    if missing:
        with gi.open("a", encoding="utf-8") as fh:
            fh.write(("" if not have or have[-1] == "" else "\n") + "\n".join(missing) + "\n")


def board_in_container(paths) -> bool:
    """True if the board's live server runs in Docker, where the board lock does not reach (macOS, Windows).

    Checks the server is really running (same instance id on its health
    endpoint), so a record left behind by a crashed container is ignored.
    """
    import urllib.request

    try:
        info = json.loads((paths["root"] / "data" / ".server.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not info.get("container"):
        return False
    port = info.get("port")
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/health", headers={"Host": f"localhost:{port}"})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=3) as resp:
            return json.loads(resp.read()).get("instance") == info.get("instance")
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Git

# Hooks are code from the repository, so the audit never lets git run them.
NO_HOOKS = ("-c", f"core.hooksPath={os.devnull}")


def git(repo, *args, check=True, timeout=120):
    try:
        r = subprocess.run(["git", *NO_HOOKS, "-C", str(repo), *args], capture_output=True, text=True,
                           errors="replace", timeout=timeout, env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
    except subprocess.TimeoutExpired:
        if check:
            raise RuntimeError(f"git {' '.join(args)} timed out")
        return ""
    if check and r.returncode != 0:
        raise RuntimeError(" ".join(r.stderr.split()) or f"git {' '.join(args)} failed")
    return r.stdout


def require_git() -> None:
    """Stop with git's own message if git cannot run at all (not installed, or an unaccepted Xcode licence)."""
    try:
        r = subprocess.run(["git", "--version"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        sys.exit(f"git cannot run: {exc}. Install git, then try again.")
    if r.returncode != 0:
        sys.exit("git cannot run on this machine, so nothing was scanned:\n  "
                 + (r.stderr.strip() or r.stdout.strip()) + "\nFix that (the user may need to do it), then try again.")


def default_branch(repo):
    """(ref, branch name): the repo's defaultBranch, else origin's HEAD, else main or master; remote first."""
    path = repo["path"]
    configured = repo.get("defaultBranch")
    candidates = [f"origin/{configured}", configured] if configured else []
    if not configured:
        head = git(path, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD", check=False).strip()
        if head:
            candidates.append(head.replace("refs/remotes/", ""))
        candidates += ["origin/main", "main", "origin/master", "master"]
    for ref in candidates:
        if git(path, "rev-parse", "--verify", "--quiet", ref + "^{commit}", check=False).strip():
            return ref, ref.split("/", 1)[1] if ref.startswith("origin/") else ref
    return None, configured


def worktree_path(paths, repo) -> Path:
    return paths["worktrees"] / repo["id"]


def _worktree_healthy(wt: Path, repo_path: str) -> bool:
    if not (wt / ".git").is_file():
        return False
    common = git(wt, "rev-parse", "--git-common-dir", check=False).strip()
    own = git(repo_path, "rev-parse", "--git-common-dir", check=False).strip()
    if not common or not own:
        return False
    common = (wt / common).resolve() if not os.path.isabs(common) else Path(common).resolve()
    own = (Path(repo_path) / own).resolve() if not os.path.isabs(own) else Path(own).resolve()
    return common == own


def prepare_worktree(paths, repo, ref) -> Path:
    """The audit's own detached checkout of `ref`, so commands test the shared code and never the user's checkout.

    Kept between runs (so installed dependencies survive); reset to `ref` each
    time, discarding anything the previous run's commands changed in tracked
    or untracked (but not ignored) files. Hooks never run. Submodules are
    brought to the commits `ref` records. If the worktree is broken (the
    repository moved, a leftover folder), it is repaired or recreated. Only
    the audit's own worktree is ever added or removed; the user's working copy
    and their other worktrees are not touched.
    """
    wt = worktree_path(paths, repo)
    if wt.exists() and not _worktree_healthy(wt, repo["path"]):
        git(repo["path"], "worktree", "repair", str(wt), check=False)
        if not _worktree_healthy(wt, repo["path"]):
            git(repo["path"], "worktree", "remove", "--force", str(wt), check=False)
            shutil.rmtree(wt, ignore_errors=True)  # the folder is the audit's own, under .audit/
    if not wt.exists():
        wt.parent.mkdir(parents=True, exist_ok=True)
        try:
            git(repo["path"], "worktree", "add", "--detach", str(wt), ref, timeout=900)
        except RuntimeError as exc:
            if "already registered" in str(exc) or "missing but" in str(exc):
                # A stale registration of this same path: forget it, then retry once.
                git(repo["path"], "worktree", "add", "--force", "--detach", str(wt), ref, timeout=900)
            else:
                raise
    git(wt, "checkout", "--detach", "--force", ref, timeout=900)
    git(wt, "reset", "--hard", ref, timeout=900)
    git(wt, "clean", "-fd")
    if (wt / ".gitmodules").exists():
        git(wt, "submodule", "update", "--init", "--recursive", "--force", timeout=900)
    return wt


def remove_worktree(paths, repo) -> str:
    """Remove the audit's worktree for `repo`; returns what happened, in words."""
    wt = worktree_path(paths, repo)
    if not wt.exists():
        return f"{repo['id']}: no worktree"
    git(repo["path"], "worktree", "remove", "--force", str(wt), check=False)
    if wt.exists():
        shutil.rmtree(wt, ignore_errors=True)
    return f"{repo['id']}: {'could not remove ' + str(wt) if wt.exists() else 'removed'}"


# ---------------------------------------------------------------------------
# Approvals

def command_hash(repo_path: str, command: str) -> str:
    """Approval is for this exact command in this exact folder; any change needs a new approval."""
    return hashlib.sha256(f"{repo_path}\0{command}".encode("utf-8")).hexdigest()


# Files that define what a command such as `npm test` runs or what `setup`
# installs, anywhere in the repository (monorepo packages included): build and
# task files, package manifests, lockfiles, dependency lists, and package
# manager settings. Submodule pointers count too. With the default "strict"
# scope, a change to any of them on the default branch ends the approval.
DEFINITION_PATTERNS = ("requirements*.txt", "*.lock", "*-lock.json", "*-lock.yaml", ".pnpmfile.cjs")
DEFINITION_FILES = {
    ".npmrc", ".yarnrc", ".yarnrc.yml", "Pipfile", "Pipfile.lock", "poetry.lock", "uv.lock", "package-lock.json",
    "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Gemfile.lock", "Cargo.lock", "go.sum",
    "composer.lock", ".gitmodules", ".tool-versions", ".nvmrc", ".python-version",
    "package.json", "Makefile", "makefile", "GNUmakefile", "pyproject.toml", "setup.cfg", "setup.py", "tox.ini",
    "noxfile.py", "justfile", "Justfile", "Taskfile.yml", "build.gradle", "build.gradle.kts", "settings.gradle",
    "settings.gradle.kts", "pom.xml", "Cargo.toml", "go.mod", "composer.json", "Rakefile", "Gemfile", "turbo.json",
    "nx.json", "project.json", "pnpm-workspace.yaml", "lerna.json", "rush.json", "deno.json", "bunfig.toml",
}


def is_definition(name: str) -> bool:
    base = Path(name).name
    return "node_modules/" not in name and (base in DEFINITION_FILES or any(fnmatch.fnmatch(base, p)
                                                                            for p in DEFINITION_PATTERNS))


def definitions_hash(repo_path: str, ref: str) -> str:
    """Hash of every definition file (by its git object id) and submodule pointer at `ref`.

    One `git ls-tree`, so it stays fast in monorepos with thousands of package files.
    """
    h = hashlib.sha256()
    for line in git(repo_path, "ls-tree", "-r", ref, check=False, timeout=300).splitlines():
        meta, _, name = line.partition("\t")
        mode, kind, oid = (meta.split() + ["", "", ""])[:3]
        if kind == "commit" or is_definition(name):  # "commit" entries are submodule pointers
            h.update(f"{name}\0{oid}\0".encode())
    return h.hexdigest()


def load_approvals(paths) -> dict:
    try:
        return json.loads(paths["approvals"].read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_approvals(paths, approvals) -> None:
    paths["approvals"].parent.mkdir(parents=True, exist_ok=True)
    boardlib.atomic_write(paths["approvals"], (json.dumps(approvals, indent=2) + "\n").encode("utf-8"))
    os.chmod(paths["approvals"], 0o600)


def approval_state(approvals, repo, kind, ref=None) -> str:
    """"approved", "not approved", "command changed since approval", or "definition files changed since approval"."""
    command = (repo.get("commands") or {}).get(kind)
    entry = approvals.get(repo["id"], {}).get(kind)
    if not command or not entry:
        return "not approved"
    if entry.get("sha256") != command_hash(repo["path"], command):
        return "command changed since approval"
    if entry.get("scope") == "commands":
        return "approved"  # the user chose to pin the command text only
    ref = ref or default_branch(repo)[0]
    if not ref or entry.get("definitions") != definitions_hash(repo["path"], ref):
        return "definition files changed since approval"
    return "approved"


def key_regex(prefix: str):
    """Ticket keys such as RCP-12, including in RCP-12_slug and feature/rcp-12-x (not XRCP-12, and RCP-123 is not RCP-12)."""
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(prefix)}-\d+(?!\d)", re.IGNORECASE)
