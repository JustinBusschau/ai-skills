#!/usr/bin/env bash
# Read-only preflight for agentic-repo-setup.
# Reports whether the current directory is inside a git repository, whether
# that repository is clean, and which agentic helper files already exist.
# It never changes the working tree, the index, or any git configuration.
#
# Exit codes:
#   0  git repo, at least one commit, clean working tree
#   10 not a git repository
#   11 git repository with no commits yet
#   12 git repository with uncommitted or untracked (non-ignored) changes

set -u

echo "== cwd"
pwd

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "== result"
  echo "NOT_A_GIT_REPO"
  exit 10
fi

toplevel="$(git rev-parse --show-toplevel)"
echo "== toplevel"
echo "$toplevel"

echo "== core.symlinks"
git config --get core.symlinks || echo "(unset, defaults to true on macOS and Linux)"

echo "== existing agentic helper files (relative to toplevel)"
cd "$toplevel" || exit 1
for f in CLAUDE.md AGENTS.md CLAUDE.local.md GEMINI.md .claude/settings.json \
         .claude/settings.local.json .cursorrules .windsurfrules \
         .github/copilot-instructions.md; do
  if [ -L "$f" ]; then
    echo "$f -> $(readlink "$f") (symlink)"
  elif [ -e "$f" ]; then
    echo "$f"
  fi
done
[ -d .cursor/rules ] && echo ".cursor/rules/ (directory)"
# Nested instruction files, skipping dependency and build directories.
find . -mindepth 2 \( -name node_modules -o -name .git -o -name vendor -o -name dist -o -name build \) -prune -o \
  \( -name CLAUDE.md -o -name AGENTS.md \) -print 2>/dev/null

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "== status"
  git status --porcelain=v1 --untracked-files=all
  echo "== result"
  echo "NO_COMMITS"
  exit 11
fi

status="$(git status --porcelain=v1 --untracked-files=all)"
echo "== status"
if [ -n "$status" ]; then
  echo "$status"
  echo "== result"
  echo "DIRTY"
  exit 12
fi

echo "(clean)"
echo "== result"
echo "CLEAN"
exit 0
