---
name: project-kanban-board
description: Builds a runnable kanban board in the browser, for one person to manage a project's execution, from whatever describes the project (architecture documents or an arc42 specification, a product brief, canvas, or PRD, or a one-line brief such as "plan our team away day" or "plan the delivery of a microservice platform with mobile apps and BI dashboards"). Breaks the work into epics, tasks, and sub-tasks at a depth that matches the project, with columns for blocked, awaiting action, testing, sign-off, and done, colour-coded epics, assignees, swimlanes by epic or assignee, and timestamped Markdown comments with screenshots and Mermaid diagrams. Also adds tickets to, updates, and reports on a board it built. Use when someone wants a board, tracker, or set of tickets to run and track a project, event, trip, or delivery, even if they do not say "kanban". Not for a plan, itinerary, or checklist wanted only as text in the chat, and not for configuring Jira, Trello, Linear, or Notion.
---

# Project kanban board

The result is a folder (by default `<project-slug>-board/` inside the current
working directory, unless step 2 finds that unsuitable) holding
a small Python server (standard library only), a plain-JavaScript browser app,
and `data/board.json`, which is the whole board. The app's own `README.md`
tells the user how to run and use it; this file tells you how to build it.

It is a single-manager tool: no logins, no multi-user editing, no
notifications. If the user needs those, say so and point them to Jira,
Linear, Trello, or Notion.

Requirements: Python 3.9 or newer on macOS or Linux (on Windows, use WSL).
Node 22 or newer and Chrome or Chromium are optional; with them the smoke test
also drives the board in a headless browser.

## Workflow

### 1. Check prerequisites and read all of the input

Run `python3 --version`. If Python is missing or older than 3.9, stop and tell
the user that the board cannot be built without it.

Read every document the user points to, in full. Convert PDF, Word,
PowerPoint, or Google documents first with the `doc-to-markdown` skill if it
is available (otherwise the `pdf` or `docx` skills, or `pandoc`). Note goals,
deliverables, components, requirements and their IDs, constraints, dates,
people and roles, external parties and approvals, quality and sign-off gates,
open decisions, and risks. A one-line brief has no document; you will rely on
what such projects normally involve.

### 2. Settle what you cannot infer

If the request could just as well be answered with a plan or checklist in the
chat ("help me plan a trip to Japan"), ask first whether they want a board
they can run and update, because this creates files and starts a server.

Then ask, in a single message, only about things that would change the board
materially and that the input does not answer:

- who is on the team (names or roles), if tasks are to be assigned;
- fixed dates (event date, go-live, deadline);
- anything already done or under way, for a project in flight;
- where to create the board, if the current directory is unsuitable. Do not
  create it inside a git repository that is not about this project (a client
  codebase, a skills folder), because attached screenshots would end up in
  that repository's history.

Do not interrogate a simple brief. If the user said to get on with it, or the
answers are guessable, use sensible defaults and record each one in the
plan's `assumptions`, which the board shows under Board settings.

### 3. Size the board and decompose the work

Read `references/planning-guide.md`: sections 1, 3, 4, 5, and 6 always, and
from section 2 only the part for your kind of input (architecture and arc42,
product briefs and PRDs, simple briefs, or large delivery briefs). It covers
choosing between a simple, standard, and delivery board, decomposing the
input, writing tickets, and what to leave out. Tell the user in one sentence
which tier you chose and why.

Then read `references/ticket-writing.md`, which sets how every ticket is
worded. Each one is product-focused: a story first (**As a** <type of user>,
**I want** <some goal> **so that** <some reason>; **Given** <pre-condition>,
**When** <action>, **Then** <result> for behaviour; or **When** <situation>,
**I want to** <motivation>, **so I can** <expected outcome> for a job to be
done), then any technical detail, then acceptance criteria or a definition
of done clear enough for a tester to pass or fail it. Plans that do not
follow it are rejected.

If the input describes any screens (app screens, portal pages, dashboards),
also read `references/screen-design.md`. Every screen gets a ticket labelled
`screen`, with a `### Screen data` table saying, for each element that shows
data (a name, an account number, a balance, a score, the last interaction),
what it shows and where it comes from (an API call and field, local secure
storage, a cache, the device, user input). Write `Unknown: <question>` rather
than guessing a source, and list those questions in the plan's
`assumptions`.

### 4. Write and check the plan

If the work happens in code repositories the user named, list them in the
plan's `repos`, so the `kanban-board-audit` skill can later gather evidence
from them.

Write the plan as JSON following `references/plan-format.md`, in a temporary
location (your scratchpad directory if you have one), not in the target
folder. Check it:

```bash
python3 <skill-dir>/scripts/validate_board.py --plan <plan.json>
```

Fix every problem, and act on every warning or be able to say why not.
(`create_board.py` runs the same checks and writes nothing if any fail; this
step only gives faster feedback.) Then reread the plan against the input: is
every major deliverable and requirement represented, does every ticket trace
to the input or to unavoidable work, and is the hierarchy no deeper than the
project needs?

### 5. Build and verify

```bash
python3 <skill-dir>/scripts/create_board.py --plan <plan.json> --out <board-dir>
python3 <skill-dir>/scripts/smoke_test.py <board-dir> --screenshot <scratch>/board.png
```

Add `--vendor-mermaid` to `create_board.py` if the user will work offline;
otherwise diagrams load a pinned, integrity-checked Mermaid from a CDN and,
when offline, show their source text instead.

`create_board.py` refuses to write into a non-empty folder; choose another
name rather than deleting anything. The smoke test runs against a temporary
copy and takes about a minute. It checks the server, its security controls,
uploads, backups, and export; with Chrome it checks the board renders; and
with Node 22 or newer as well it drives the interface on a throwaway fixture
board (comments and timestamps, pasted images, Mermaid, drag and drop and the
reason prompts, swimlanes, the Overview, and edits made while the page is
open). Look at the screenshot; more of the fixture board are in `ui-check/`
beside it.

Each check it could not run is printed as SKIP with the reason. If a check
FAILs, decide whether the cause is the environment (a port in use, no network,
a read-only folder) or a defect:

- For an environment cause, fix the environment if you can and rerun; if you
  cannot, hand over the board and say exactly which check failed and why.
- For a defect in your plan or the generated board, fix it and rerun.
- Never edit the skill's own files (`assets/`, `scripts/`) to make a check
  pass, because that changes every future board. Report the failure with the
  check's output instead, and do not describe the board as verified.

### 5a. Designs for screens

For each `screen` ticket, provide a design (`references/screen-design.md`,
sections 3 and 4):

- If Chrome or Chromium is available, write a simple HTML wireframe per
  screen, with each data element labelled by its source, render it with
  `scripts/render_design.py`, look at it, and attach it to the ticket with
  `edit_board.py`'s `attach` operation.
- For anything you cannot provide (no browser, a final visual design from a
  designer, a screenshot of a running app), add an item to the design
  checklist with `scripts/design_checklist.py <board-dir> add <KEY> <kind>
  "<what it must show>" --how "<how to get it>"`. That creates or updates a
  checklist file in the current working folder, naming the ticket for each
  image.

### 6. Start it and hand over

Start the server in the background (for example with the Bash tool's
background option), from the board folder:

```bash
cd <board-dir> && python3 server.py --port 8080
```

If the port is in use, the server refuses to start and exits (it also detects
a program on the same port over IPv6, including another board); read its
output, and use another port. If it says this board is already being served,
use that server's port rather than starting another. Then run `curl -s
http://localhost:<port>/api/health`: the JSON must contain `"app":
"kanban-board"` and a `"data"` path equal to this board's `data/` folder with
symbolic links resolved (compare it with the output of `cd <board-dir>/data &&
pwd -P`).
Anything else means you reached a different program or a different board.
Leave the server running. A server you started may stop when your session
ends, which is why the hand-over says how to run it.

If the user prefers Docker, run `docker compose up --build -d` in the board
folder instead (on Linux, prefix it with `KANBAN_UID=$(id -u)
KANBAN_GID=$(id -g)`), then run the same health check and
`docker compose ps` (in Docker the health check has no `"data"` path, because
the server requires a token there) to confirm the container is running rather than
restarting. In Docker the server requires an access token, so give the user
the link from `docker compose logs board`, not the bare URL, and tell them to
stop it with `docker compose stop` in the board folder.

Then tell the user, briefly:

- the URL (or token link) and the folder;
- the tier and the shape of the board (for example "8 epics, 46 tasks, 31
  sub-tasks; swimlanes by epic");
- the assumptions you made, and anything in the input you left off the board;
- that it is running now; that to run it later they open a terminal in the
  board folder and run `python3 server.py` (Ctrl+C stops it); and that to stop
  the copy you started they can ask you or run `python3 server.py --stop` in
  the board folder, which stops only this board's server;
- that everything is saved in `data/` with backups in `data/backups/`, and it
  has no login and listens on this machine only;
- any smoke-test checks that were skipped, and so what was not verified;
- if the design checklist was created or changed: its path, how many items
  it holds and how many are new, and a request to tick each item in the file
  (`- [ ]` to `- [x]`) once they have added that image to the board. Say
  nothing about it if no item was needed.

## Working with an existing board

Run `scripts/board_report.py <board-dir>` or read `data/board.json` first, so
you work from its current state.

- **Add work** (new scope, a revised document): write a plan with only the
  new items, check it with `validate_board.py --plan <new.json> --board
  <board-dir>`, and run `create_board.py --plan <new.json> --out <board-dir>
  --append`, attaching to existing epics and tasks by key (see "Appending" in
  `references/plan-format.md`). It refuses tickets that duplicate an existing
  type, parent, and title, which usually means the plan was already applied.
- **Change the board** (move, reassign, rename, comment, delete; people,
  labels, columns, and repositories; links and image attachments): use
  `scripts/edit_board.py`; its `--help` lists every
  operation. It rejects unknown keys and fields, applies all operations or
  none, validates, backs up (with a pinned backup for anything deleted), and
  takes the same lock as the server's saves. An open browser tab picks up the
  change within seconds; if the tab had an unsaved change, it asks the manager
  which version to keep. The lock does not reach a server running in Docker
  on macOS or Windows, so stop the container while editing. Avoid
  hand-editing `board.json`; if you must, stop the server first, follow
  `references/board-format.md`, and run `validate_board.py` afterwards.
- **Designs supplied by the user**: run `design_checklist.py <board-dir> sync`
  to see which ticked items have their image on the board, and tell the user
  about any item ticked without an image.
- **Report** ("what's blocked?", a status update): run `board_report.py`,
  with `--since <YYYY-MM-DD>` for what was completed and what moved in a
  period, and write the answer from its output.
- **Remove sensitive content** (a pasted credential, personal data):
  1. Ask the user to close or reload every open board tab first, discarding
     unsaved changes; a stale tab's "Keep my version" would put the text back.
  2. Delete the text from the board (in the browser, or with `edit_board.py`:
     `set`, `edit-comment`, `delete-comment`, `rename-person`,
     `rename-label`, `update-column`, or `set-board`).
  3. Purge, passing the exact text in a quoted heredoc. Never put it in
     double quotes on the command line: the shell changes `$`, backticks, and
     backslashes, and the purge would then look for the wrong text.

     ```bash
     python3 <skill-dir>/scripts/edit_board.py <board-dir> --purge-text-stdin --clean-uploads --include-recent <<'END'
     <the whole text, exactly>
     END
     ```

     It removes whole status-history notes containing the text, deletes the
     backups and plan copies holding it (otherwise kept for up to a year), and
     deletes every image nothing uses. A warning that nothing held the text
     means the text given probably differs from what was stored.
  4. Confirm with the same heredoc and `--find-text-stdin`, which searches
     every file under the board folder in raw and JSON-escaped form.

  Then report exactly what was removed, and say plainly what this cannot
  reach: copies the user downloaded or exported, git history if the folder is
  committed, the original input documents, your plan file and smoke-test
  screenshots in your scratch area (delete those yourself), the browser's
  image cache, and this conversation. For a credential, tell the user to
  revoke or rotate it, because removing it from the board does not make a
  leaked secret safe.
- **Upgrade the app** after this skill changes: `create_board.py --out
  <board-dir> --update-app`. It leaves `data/` alone, copies the replaced code
  to `.previous-app-<time>/`, and keeps a changed `Dockerfile`,
  `docker-compose.yml`, or `README.md`, writing the new one beside it as
  `.new`. Restart the server and rerun the smoke test afterwards. A server
  started before the upgrade may predate `--stop`. If `--stop` finds nothing
  but the health check shows this board's `data` path, ask the user to stop
  it from its terminal; or, only if `lsof -ti tcp:<port> -sTCP:LISTEN` lists
  exactly one pid and `ps -p <pid> -o command=` shows this board's
  `server.py`, end that pid with `kill`.

## Things to get right

- **Proportion.** A holiday does not need sub-tasks and a sign-off column; a
  multi-team platform build does.
- **Product-focused tickets.** Every ticket has a story and testable
  acceptance criteria, as `references/ticket-writing.md` describes.
- **Every screen designed, every data element sourced.** No screen ticket
  without a design (attached, or listed in the design checklist) and a
  screen data table.
- **Trust.** Do not invent names, dates, or progress. Unknowns become
  assumptions, placeholders, or unassigned tickets.
- **Reasons.** Every blocked or waiting ticket says why, or who it waits on.
- **Verification.** Report what the smoke test actually showed, including
  anything it skipped.
- **Data safety.** Never delete or overwrite an existing board folder or its
  `data/` to get a clean run.
