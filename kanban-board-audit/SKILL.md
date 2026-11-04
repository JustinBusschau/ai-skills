---
name: kanban-board-audit
description: Audits a kanban board built by the project-kanban-board skill against the code repositories it tracks. Scans commits, branches, and pull requests, runs the user-approved setup, test, lint, and build commands on the default branch, and captures screenshots where it can. It then records evidence on each ticket (test excerpts, commit links, screenshots with narrative), moves tickets forward only when the evidence meets a stated threshold, and asks before moving any back. It creates tickets for failures, missing work, and blockers that need a person or another team, and offers to make small fixes itself. Writes a stand-up update and can run overnight on a schedule, asking each evening first. Use when someone wants to check a board against the real state of the code, gather or verify evidence that work is done, update a board from the repositories, or get a stand-up summary of yesterday's progress.
---

# Kanban board audit

Brings a board built by `project-kanban-board` up to date with the code, so
every ticket shows the evidence for where it sits. It reads the board's
`repos` list, records evidence on tickets, moves tickets forward only on
sufficient evidence, raises tickets for work a person must do, and writes a
stand-up update.

It needs the `project-kanban-board` skill installed beside it (its scripts
change the board safely, even while the board is open in a browser), Python
3.9 or newer, and `git`, on macOS or Linux (on Windows, use WSL). Chrome or Chromium is optional, for screenshots, and
the GitHub CLI `gh` (signed in) is optional, for pull requests. Below,
`<audit>` is this skill's folder, `<kanban>` is `project-kanban-board`'s, and
`<run>` is the run folder the scan creates (`<board-dir>/audits/<date>T<time>/`),
which holds everything from one audit. If a script misbehaves,
`python3 <audit>/scripts/self_test.py` checks them all on a throwaway board.

Read `references/evidence-standard.md` before assessing any ticket; it sets
the thresholds, verdicts, and comment format. Tickets are worded to the
project-kanban-board skill's `references/ticket-writing.md` (a story, then
technical notes, then acceptance criteria); read it before raising a ticket
or drafting criteria, because evidence is judged against each ticket's
acceptance criteria. Read `references/scheduling.md`
only when setting up or running a scheduled audit.

## Modes

- **Attended** (the default): the user is present. Ask before anything the
  rules below reserve for them.
- **Overnight**: started by a scheduled prompt that says "overnight run". The
  user approved the run that evening and is not present: ask nothing, apply
  only what the rules allow without asking, and queue the rest as proposals.
- **Evening check-in**: started by the scheduled check-in prompt; follow
  `references/scheduling.md` and do nothing else.
- **Decisions only**: the user wants to go through what an audit queued
  ("what did the overnight audit want from me?"). Run `standup.py
  <board-dir> --new-run` to get a fresh run folder (so the overnight
  stand-up is kept), then do step 1, step 6 for the open proposals, step 7
  for what they approve, and step 9 with `--run-dir` set to that folder,
  without scanning.

## How the audit sees the code

Commands never run in the user's own checkout. The scan keeps a separate git
worktree per repository at `<board-dir>/.audit/worktrees/<repo-id>`, reset to
the tip of the default branch (on the remote, after a fetch) each run, with
submodules updated, so tests describe exactly the shared code whatever the
user has checked out or left uncommitted. Git hooks never run during an
audit (only a commit of an accepted fix, step 8, runs the repository's
commit hooks). Dependencies
the `setup` command installs (for example `npm ci`) stay in that worktree
between runs, and so does ignored build output, so `setup` (or `build`, which
runs before the tests) should rebuild whatever the tests import. Tell the
user the cost: a second checkout, plus its dependencies, per repository. The
user's working copy is never touched; `git worktree list` in their repository
shows the audit's worktree, `scan_repos.py <board-dir> --remove-worktrees`
deletes it, and one audit of a board runs at a time.

## Workflow

### 1. Check the board, its repositories, and earlier decisions

Run `python3 <kanban>/scripts/board_report.py <board-dir>` and read
`data/board.json`'s `repos`. If the board is served from Docker, the board's
lock does not reach it on macOS or Windows, so changes must wait; step 7
checks this right before applying (`scan_repos.py <board-dir> --board-check`).
In attended mode you can ask the user now to stop the container for the
audit.

Run `python3 <kanban>/scripts/design_checklist.py <board-dir> sync` to see
which designs and screenshots the user has supplied (the design checklist;
see the evidence standard, section 5), and
`python3 <audit>/scripts/proposals.py <board-dir> list` to see every
earlier proposal and what the manager decided, and look for run folders
holding a `PENDING`
file (changes left unapplied because the board was served from Docker; see
step 7). In attended mode, deal with those first, with the user, because the
board may already have moved on.

If no repositories are listed, ask the user which folders hold the work
(attended only; overnight, say so in the stand-up and stop). For each, look at
the repository (package.json scripts and lockfile, a Makefile, pyproject.toml,
a README) to propose its commands: `setup` to install dependencies (`npm ci`,
`pnpm install --frozen-lockfile`, `pip install -e .`), and `test`, `lint`,
`build`, and `start`. Prefer test commands that name each test in their output
(`python3 -m unittest -v`, `npx jest --verbose`), so evidence can cite them.
Confirm with the user, then add the repository:

```bash
python3 <kanban>/scripts/edit_board.py <board-dir> --op '{"op": "add-repo", "name": "Web", "path": "/abs/path", "remote": "https://github.com/org/web", "defaultBranch": "main", "appUrl": "http://localhost:3000", "commands": {"setup": "npm ci", "test": "npx jest --verbose", "lint": "npm run lint"}}'
```

### 2. Get approval for the commands it will run

Running a repository's commands executes its code on this machine. Show the
user what would run, and ask:

```bash
python3 <audit>/scripts/commands.py <board-dir> list --fetch
python3 <audit>/scripts/commands.py <board-dir> approve <repo-id> setup test lint   # name exactly the kinds agreed
python3 <audit>/scripts/commands.py <board-dir> approve <repo-id> start       # only if screenshots need the app
```

Approve only what the user agreed to, and tell them plainly what an approval
means. Tests usually need `setup` (installing dependencies) too: say so when
asking, because without it they fail with "could not test" every time. It is a standing permission to run that command, in the audit's
worktree, on the newest code of the default branch whenever the audit runs:
new commits' code does run under it, because testing it is the point. By
default (scope `strict`) it lapses when any file that decides what the
commands run or install changes on the default branch (build and task
files, package manifests, lockfiles, requirements files, package manager
settings, submodule pointers), and the command is skipped until approved
again. In a busy repository that can be most days. If the user prefers
approvals that survive dependency bumps, `--scope commands` pins only the
command text, so new dependencies install without asking; offer it, do not
choose it for them. Overnight, never approve anything.

### 3. Scan

```bash
python3 <audit>/scripts/scan_repos.py <board-dir>
```

It fetches, prepares the audit's worktree, runs the approved commands there
in the order setup, build, test, lint (with `CI=true`, so test runners do not
wait in watch mode), and prints the run folder. Overnight, add `--overnight`
(see `references/scheduling.md`). `<run>/scan.json` holds
commits and branches naming tickets and whether each is on the default
branch, pull requests when `gh` can read them, commits since the previous
stand-up, and each command's result with the commit it tested and an output
excerpt; full logs are in `<run>/logs/`. Read every problem and note it
prints: those are things the evidence cannot speak to, and the stand-up must
say so.

### 4. Assess each ticket

Work through the tickets the scan or the board gives you something to say
about: tickets named by commits, branches, or pull requests, tickets in
progress or later, and tickets in a repository whose commands failed. Decide
each verdict with the evidence standard, and compare it with the ticket's
last audit comment: if nothing has changed, it needs no new comment. A
failure caused by the environment (a failed setup, a missing module, a
refused database connection) is "could not test", never a reason to move a
ticket back or raise a ticket for the code. Sort what you find into:

- changes you may make without asking: evidence comments, `add-link` for
  commits and pull requests, labels, and forward moves that meet the
  threshold;
- new tickets, only for problems no existing ticket covers (a ticket
  contradicted by the evidence gets a move-back proposal, not a second
  ticket), each written to `ticket-writing.md`;
- for a ticket with no story or no acceptance criteria, a proposal to add
  them, with your draft (it cannot move past In progress without them);
- proposals for the manager: moves back, moves into or out of Blocked or
  Awaiting action, small fixes, environment problems, and anything else that
  is their call.

### 5. Screenshots

For tickets whose next move needs a screenshot and whose other evidence is
sufficient (evidence standard, sections 2 and 4), start the app with the
gated helper, which refuses an unapproved start command or a port something
else is using, and serves the default branch from the audit's worktree:

```bash
python3 <audit>/scripts/app_server.py <board-dir> start <repo-id>
python3 <audit>/scripts/capture_screenshot.py <url> <run>/shots/<KEY>.png
python3 <audit>/scripts/app_server.py <board-dir> stop <repo-id>     # always, even after a failure
```

The start command must keep running in the foreground (`npm run dev`, not
`pm2 start` or `docker compose up -d`): the helper can only stop what it
started. Headless capture only works for pages that need no sign-in. Look at every
image before using it: a sign-in page or an error screen is not evidence.
When a screenshot needs a person, plan a label and instructions for them
(evidence standard, section 5) instead.

### 6. Decide

Before raising a proposal, check what the manager already decided:

```bash
python3 <audit>/scripts/proposals.py <board-dir> check move-back:RCP-4
```

Raise it only if that says `raise`. `open` means repeat the existing one with
its `id`; `wait` (declined within a week) and `never` (dismissed) mean do not
ask again. For a declined move back, leave the ticket, note once on it that
the manager kept it where it is, and do not repeat that note.

Write the proposals to `<run>/proposals.json`: a list of `{"id": "<run>-<n>",
"key": "move-back:RCP-4" | "fix:<repo-id>:<slug>" | "other:<slug>", "kind":
"move-back" | "fix" | "other", "ticket": "KEY", "target": "<column, for
move-back>", "summary": "...", "evidence": "...", "status": "open"}`. For one
the board has overtaken, repeat its `id` and `key` with `"status":
"superseded"`, or it stays on every stand-up.

In attended mode, ask the user now, before changing the board, so the
comments you write describe what actually happened. Group the questions
(moves back, fixes, other) and use `AskUserQuestion` where it helps. Record
each answer by repeating the proposal's `id` with `"status": "approved"` or
`"declined"`, or `"dismissed"` if the manager says not to ask again.
Overnight, ask nothing and leave them open.

### 7. Apply

Bring together everything decided: the changes allowed without asking, plus
the moves the manager approved in step 6. Create new tickets first, so their
keys exist for comments to mention and the `audit` label exists:

```bash
python3 <kanban>/scripts/validate_board.py --plan <run>/new-tickets.json --board <board-dir>
python3 <kanban>/scripts/create_board.py --plan <run>/new-tickets.json --out <board-dir> --append
```

Then write the audit's own operations to `<run>/ops.json` (starting with any
`add-label` it needs) and apply them as one batch, which succeeds or fails as
a whole. Put the manager's approved moves, each with its evidence comment, in
a second batch with their own actor, so the stand-up shows they were the
manager's decisions and no comment can claim a move that failed:

```bash
python3 <kanban>/scripts/edit_board.py <board-dir> <run>/ops.json --actor audit
python3 <kanban>/scripts/edit_board.py <board-dir> <run>/approved-ops.json --actor "manager via audit"
```

Each evidence comment states the outcome: moved, held (and why), or "move
back proposed, awaiting your decision" overnight. If a command reports an
error, nothing from that batch was applied: fix the cause and rerun rather
than applying pieces by hand.

Right before applying, run `python3 <audit>/scripts/scan_repos.py <board-dir>
--board-check`. If it reports the board is served from Docker (exit code 3),
do not apply anything: leave `new-tickets.json`, `ops.json`, and
`approved-ops.json` in the run folder and write a `PENDING` file there (the
stand-up says so). Because the new tickets do not exist yet, `ops.json` must
not refer to their keys. The next attended or decisions-only run, once the
container is stopped: for each run folder with `PENDING`, oldest first,
compare its operations with the board as it is now and drop any the board
has overtaken, create its new tickets, apply the rest, and delete the
marker.

### 8. Small fixes the manager accepted

Follow section 7 of the evidence standard. Ask before creating the branch,
then:

```bash
python3 <audit>/scripts/fix_worktree.py <board-dir> create <repo-id> <slug>
python3 <audit>/scripts/fix_worktree.py <board-dir> run <repo-id> <slug> setup   # if the repo has one
# make the change inside <board-dir>/.audit/fixes/<repo-id>-<slug>
python3 <audit>/scripts/fix_worktree.py <board-dir> run <repo-id> <slug> lint
python3 <audit>/scripts/fix_worktree.py <board-dir> diff <repo-id> <slug>
```

It works on its own branch (which does not track `main`) and worktree, never
the user's checkout, and runs only approved commands. Ask before
committing, and say that committing runs the repository's own commit hooks,
which execute its code. Never push. Add one follow-up
comment to the tickets the fix unblocks, quoting the command's result and
naming the branch (the one exception to "one comment per ticket per audit").

### 9. Stand-up

```bash
python3 <audit>/scripts/standup.py <board-dir>
```

It writes `<run>/standup.md`: what was completed and what moved since the
last overnight stand-up (the team's moves, the manager's decisions the audit
applied, and the audit's own, each marked), commits, work in progress, what
is blocked or waiting and on whom, test and build health with the lines that
name each failure, what the audit could not see, tickets needing evidence
from a person, tickets the audit raised, epics to update, and every open
decision from any run. In attended mode, show it to the user; overnight,
leave it for the morning.

Then summarise for the user: how many tickets you examined, moved forward,
commented on, and created; what is waiting for their decision; what needs
evidence from a person; and what the audit could not see. If the design
checklist was created or changed in this run, give its path and how many
items are new, and ask the user to tick each item in the file once they have
added that image to the board; mention any item ticked without an image on
its ticket. Overnight, the stand-up's "Designs and images needed" section
carries this instead.

### 10. Offer a schedule

If the user wants a regular overnight audit, follow
`references/scheduling.md`: explain its limits, then set up the evening
check-in.

## Rules that always apply

- **Evidence first.** Never move a ticket forward without evidence that meets
  the threshold, and never claim more than the evidence shows.
- **Backward is the manager's call.** Ask before moving any ticket back, out
  of Done, or into or out of Blocked or Awaiting action.
- **Tickets only for real work.** Raise tickets only for work a person,
  another team, or another agent must do; never for an environment problem
  or a small fix; never duplicating an open ticket.
- **The user's repositories are read-only** (the audit works in its own
  worktree) unless the user accepts a small fix: then ask before a branch and
  before a commit, and never push.
- **Only approved commands run.** Overnight, nothing new is approved.
- **Board changes go through `edit_board.py` (with `--actor audit`, or
  `--actor "manager via audit"` for decisions the manager made) and
  `create_board.py`**, never by hand-editing `board.json`.
- **No secrets on the board.** Check output excerpts and screenshots for
  secrets and personal data before adding them (evidence standard, section 4).
- **Say what the audit could not see.**
