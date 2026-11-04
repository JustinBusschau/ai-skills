#!/usr/bin/env python3
"""Build a throwaway board and git repository for testing the audit skill.

    make_fixture.py <out-dir>

Creates <out-dir>/recipe-board (a board with a `repos` entry) and
<out-dir>/recipe-app (a git repository whose commits name ticket keys, with
one passing and one failing test, a lint problem a fixer could correct, and a
static page to screenshot). The scenario:

- RCP-2 "Find recipes by title" is In progress and has a commit plus a passing test.
- RCP-3 "Read a recipe's details" is in Ready, has a commit and a visible page.
- RCP-4 "Scale ingredients to my servings" is Done, but its test fails (contradicted).
- RCP-5 "Export a shopping list" is In progress with no commits, and its
  description has a story but no acceptance criteria.
- lint.py flags trailing whitespace in recipes/search.py (a small fix).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

KANBAN = Path(os.environ.get("KANBAN_SKILL_DIR") or Path(__file__).resolve().parents[2] / "project-kanban-board")


def git(repo, *args, env_date=None):
    env = dict(os.environ, GIT_AUTHOR_NAME="Sam Patel", GIT_AUTHOR_EMAIL="sam@example.com",
               GIT_COMMITTER_NAME="Sam Patel", GIT_COMMITTER_EMAIL="sam@example.com")
    if env_date:
        env.update(GIT_AUTHOR_DATE=env_date, GIT_COMMITTER_DATE=env_date)
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main():
    out = Path(sys.argv[1]).resolve()
    repo, board_dir = out / "recipe-app", out / "recipe-board"
    if repo.exists() or board_dir.exists():
        sys.exit(f"{out} already has a fixture; choose an empty folder.")
    repo.mkdir(parents=True)
    git(repo, "init", "-q", "-b", "main")
    git(repo, "remote", "add", "origin", "https://github.com/example/recipe-app.git")
    write(repo / "README.md", "# Recipe app\n\nRun tests with `python3 -m unittest`, lint with `python3 lint.py`.\n")
    write(repo / "lint.py", (
        "import pathlib, sys\n"
        "bad = [f'{p}:{i}: trailing whitespace' for p in pathlib.Path('recipes').rglob('*.py')\n"
        "       for i, line in enumerate(p.read_text().splitlines(), 1) if line != line.rstrip()]\n"
        "print('\\n'.join(bad) or 'lint clean')\n"
        "sys.exit(1 if bad else 0)\n"))
    write(repo / "recipes" / "__init__.py", "")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "Initial project layout", env_date="2026-10-20T09:00:00")

    write(repo / "recipes" / "search.py", "def search(recipes, term):   \n    term = term.lower()\n"
          "    return [r for r in recipes if term in r['title'].lower()]\n")
    write(repo / "tests" / "__init__.py", "")
    write(repo / "tests" / "test_search.py", "import unittest\nfrom recipes.search import search\n\n\n"
          "class SearchTest(unittest.TestCase):\n    def test_finds_by_title(self):\n"
          "        self.assertEqual(len(search([{'title': 'Pancakes'}, {'title': 'Soup'}], 'pan')), 1)\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "RCP-2 Add recipe search by title", env_date="2026-10-29T10:00:00")

    write(repo / "recipes" / "scale.py", "def scale(quantity, servings_from, servings_to):\n"
          "    return quantity * servings_from / servings_to  # inverted\n")
    write(repo / "tests" / "test_scale.py", "import unittest\nfrom recipes.scale import scale\n\n\n"
          "class ScaleTest(unittest.TestCase):\n    def test_doubles_for_twice_the_servings(self):\n"
          "        self.assertEqual(scale(100, 2, 4), 200)\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "RCP-4 Fix ingredient scaling", env_date="2026-10-29T15:00:00")

    write(repo / "app" / "index.html", "<!doctype html><html><head><meta charset='utf-8'><title>Pancakes</title></head>"
          "<body style='font-family:sans-serif;padding:2rem'><h1>Pancakes</h1><p>Serves 4. 20 minutes.</p>"
          "<h2>Ingredients</h2><ul><li>200 g flour</li><li>2 eggs</li><li>300 ml milk</li></ul></body></html>\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "RCP-3 Recipe detail page", env_date="2026-10-30T11:00:00")

    plan = {
        "title": "Recipe app", "keyPrefix": "RCP", "columnPreset": "delivery",
        "people": ["Sam Patel", "Ana Costa"], "labels": ["backend", "web"],
        "repos": [{"name": "recipe-app", "path": str(repo), "remote": "https://github.com/example/recipe-app",
                   "appUrl": "http://localhost:8765/",
                   "commands": {"setup": "python3 -c \"print('nothing to install')\"", "test": "python3 -m unittest -v", "lint": "python3 lint.py",
                                "start": "python3 -m http.server 8765 --bind 127.0.0.1 --directory app"}}],
        "epics": [{"title": "Recipes",
                   "description": "**As a** home cook, **I want** to find and follow recipes **so that** I can cook "
                                  "something new without fuss.\n\n### Definition of done\n- [ ] Cooks can search "
                                  "recipes, read one, and scale it to their servings.",
                   "tasks": [
            {"title": "Find recipes by title", "status": "In progress", "assignee": "Sam Patel", "labels": ["backend"],
             "description": "**As a** home cook, **I want** to search recipes by title **so that** I can find a dish "
                            "quickly.\n\n### Acceptance criteria\n- [ ] Searching 'pan' returns Pancakes and not Soup.\n"
                            "- [ ] Search ignores capital letters."},
            {"title": "Read a recipe's details", "status": "Ready", "assignee": "Ana Costa", "labels": ["web"],
             "description": "**As a** home cook, **I want** to see a recipe's servings, time, and ingredients **so that** "
                            "I know what I need before I start.\n\n### Acceptance criteria\n- [ ] The page shows the "
                            "title, servings, and preparation time.\n- [ ] The page lists every ingredient with its quantity."},
            {"title": "Scale ingredients to my servings", "status": "Done", "assignee": "Sam Patel", "labels": ["backend"],
             "description": "**Given** a recipe for 2, **When** I choose 4 servings, **Then** every ingredient quantity "
                            "doubles.\n\n### Acceptance criteria\n- [ ] 100 g for 2 servings becomes 200 g for 4.\n"
                            "- [ ] Halving the servings halves the quantities."},
            {"title": "Export a shopping list", "status": "In progress", "assignee": "Ana Costa",
             "description": "**When** I have chosen recipes for the week, **I want to** export one shopping list, **so I "
                            "can** buy everything in one trip.\n\n### Acceptance criteria\n- [ ] placeholder"},
        ]}],
    }
    plan_path = out / "fixture-plan.json"
    plan_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    subprocess.run([sys.executable, str(KANBAN / "scripts" / "create_board.py"), "--plan", str(plan_path),
                    "--out", str(board_dir)], check=True, capture_output=True)
    # RCP-5 deliberately lacks acceptance criteria, as a hand-made ticket might, so the
    # audit's "propose criteria" path can be exercised (plans themselves must have them).
    subprocess.run([sys.executable, str(KANBAN / "scripts" / "edit_board.py"), str(board_dir), "--op", json.dumps(
        {"op": "set", "id": "RCP-5", "fields": {"description": "**When** I have chosen recipes for the week, **I want to** "
                                                "export one shopping list, **so I can** buy everything in one trip."}})],
                   check=True, capture_output=True)
    print(f"Board: {board_dir}\nRepository: {repo}")


if __name__ == "__main__":
    main()
