# Evidence standard

What counts as evidence, how much is needed before a ticket may move
forward, and how to record it. The aim is that anyone opening a ticket can see
why it is where it is, without asking.

## Contents

1. What counts as evidence
2. Thresholds for moving forward
3. Verdicts
4. The evidence comment
5. Asking a person for a screenshot or other evidence
6. New tickets
7. Small fixes

## 1. What counts as evidence

| Kind | Counts when | Does not count |
| --- | --- | --- |
| Commit | Its message names the ticket key (the scan's `keyedCommits`), or it is on a branch whose name does (`keyedBranches[].commitsNotOnDefault`). Link it with `add-link` (type `commit`, with its web URL when the scan gives one). | A commit that only mentions the key in passing ("unlike LOY-4, ..."): read the message. Stashes and other private refs are never scanned. |
| Pull request | Its title or branch names the key, as listed in the scan's `pullRequests`. A merged one whose `mergeCommitOnDefault` is true counts as the ticket's work being on the default branch, even when no commit message names the key (squash merges). Only available when the scan could read pull requests (GitHub with `gh` signed in); otherwise say "pull requests not checked". | An open, unmerged pull request counts for "in progress", not for "done". |
| Test output | An approved command ran in this audit on the default branch (the scan records the commit), and its output is quoted (a short excerpt: the summary line and any failures, never the whole log). Cite the commit it ran against. | Output from an earlier audit, from memory, from a command that was skipped or timed out, or from anyone's local work in progress (the scan runs commands only in its own worktree of the default branch for this reason). |
| Test relevance | A test file or test name the ticket's commits touched, or a test named after the behaviour the ticket describes, ran and passed. | "The whole suite passed" on its own: say what the suite covers, or call it supporting evidence only. |
| Screenshot | Shows the behaviour the ticket describes, with a sentence of narrative saying what to look at. Captured this audit, or attached by a person. | A sign-in page, an error screen, a blank page, or an image older than the latest commit for that ticket. |
| Sign-off | A comment or status-history entry recording who signed off and when. | Your own judgement. Sign-off is a human act. |
| Acceptance criteria | Each criterion in the ticket's `### Acceptance criteria` (or `### Definition of done`) section is matched to the evidence that shows it passing: a named test, a screenshot showing it, or a person's confirmation in a comment. Criteria are what "done" means for the ticket (the project-kanban-board skill's `references/ticket-writing.md`). | Evidence that does not speak to any criterion, however much of it there is. |

Evidence must come from this audit or from what is already on the ticket.
Never infer that something works because it was planned, or because a
related ticket is done.

## 2. Thresholds for moving forward

The **flow** is the board's columns in order, leaving out `blocked` and
`waiting` columns (a ticket enters those for a reason, not as progress).
"Forward" means to a later column in the flow, and "the next column" means
the next one in the flow. You may move a ticket forward on your own only when
it meets the threshold for the column it is moving into. Read thresholds by
the target column's kind:

| Target kind | Minimum evidence |
| --- | --- |
| `todo` | Never by the audit: deciding what is ready is planning. |
| `in_progress` | At least one commit naming the ticket, or a branch naming it that holds at least one commit of its own (`commitsNotOnDefault` not empty). A branch with no commits is not evidence of work. A ticket in `backlog` or `todo` with such evidence goes straight to the first `in_progress` column. |
| `testing` | The ticket's work is on the default branch (commits with `onDefaultBranch`, or a merged pull request with `mergeCommitOnDefault`), because that is the only code the audit's checks run on; an open pull request is evidence of progress, not of passing checks. And the repository's checks passed in this audit: build or lint, whichever are approved, or the test command if neither exists. With no approved command at all, the threshold cannot be met: say so, do not move it. |
| `signoff` | Everything for `testing`, plus relevant tests passed in this audit (section 1), plus a screenshot with narrative if the ticket changes something a person sees, plus every acceptance criterion matched to evidence (section 1). A criterion nothing yet shows holds the ticket. A `screen` ticket also needs a screenshot of the running screen that matches its design and shows every element in its `### Screen data` table. |
| `done` | On a board with a `signoff` column: never; sign-off is for a person. On a board without one: everything for `signoff`. |

Further rules:

- Never move a ticket into or out of `blocked` or `waiting` on your own;
  propose it.
- A ticket without acceptance criteria (or without a story) cannot move past
  `in_progress`: nothing defines what passing means. Propose adding them
  (kind `other`, key `other:criteria-<KEY>`), with a draft written to
  `references/ticket-writing.md` in the project-kanban-board skill, based on
  the ticket's title, its story if it has one, and its commits. Never rewrite
  a ticket's description without the manager's approval; once approved, apply
  the draft with `set` (field `description`), keeping anything the ticket
  already said.
- Never move a parent task further than its least advanced sub-task, and
  never move an epic; suggest it in the stand-up instead.
- Apart from the backlog rule above, move one column of the flow at a time
  per audit, even if the evidence would justify more, so every column's
  evidence is recorded on the way.
- Evidence is only as fresh as the scan: if the scan notes that `git fetch`
  failed or pull requests were not checked, say so in the evidence comment,
  and do not move a ticket on evidence the scan could not see.
- If a repository's build, lint, or tests fail, move no ticket from that
  repository into `testing`, `signoff`, or `done` unless the failures are
  confined to files the ticket's commits did not touch (lint and test output
  name the files; a failed build or setup affects everything), and say so in
  the evidence comment.

Moving backward (including out of `done`) is always a proposal: ask the board
manager, or in an overnight run, queue it in `proposals.json`. A reopened
ticket goes back to the board's first `in_progress` column unless the manager
says otherwise; name that column in the proposal.

A ticket in `in_progress` with no commit or branch naming it: add the
`needs-evidence` label and a comment asking its assignee where the work is
(an unpushed branch, a different repository, or not started). Do not move it.
If it still has no evidence three working days after that comment, propose
moving it back; until then, do not repeat the request.

## 3. Verdicts

Give every ticket you examined one verdict in the evidence comment:

- **Sufficient**: meets the threshold for its current column (and, if moved,
  for its new one).
- **Insufficient**: some evidence, not enough; name what is missing.
- **Contradicted**: evidence shows the ticket is not where it claims to be
  (for example in `done` with its tests failing). Propose a move back; do
  not raise a second ticket for the same work (section 6).
- **None found**: no commit, branch, or test names it. That is normal for
  work not started; comment only if the ticket claims progress.
- **Could not test**: the commands did not run, or failed for reasons that
  are not the code's: a failed setup or install, "Cannot find module",
  "command not found", a refused connection to a database or service, a
  missing environment variable or credential, a timeout. Read the output
  before deciding. This verdict never leads to a move back or a new ticket
  for the code; report it in the stand-up as an environment problem for the
  manager (one proposal per repository, not one per ticket).

Do not comment on tickets whose state the audit cannot speak to (a backlog
item with no commits, an event booking on a mixed board). Silence is better
than noise.

## 4. The evidence comment

Comment only when something material has changed since the ticket's last
audit comment (the latest comment whose `author` is `audit` or `manager via
audit`): its verdict, its column, or a new kind of evidence (a new commit or
pull request naming it, a screenshot, a test that now covers it). A newer
tested commit or different test counts alone are not material; a nightly
audit that repeats itself buries the evidence. When something has changed,
add one comment per ticket per audit, using `edit_board.py`'s
`comment` operation (or `attach` when it includes a screenshot), always run
with `--actor audit` so the board and the stand-up can tell the audit's work
from people's. Keep it short and factual:

```markdown
**Audit 2026-11-05: evidence sufficient for Awaiting testing** (moved from In progress)

- Commits: [3f9c2ab](https://github.com/acme/web/commit/3f9c2ab) "LOY-7 Add sign-in endpoint", on main
- Build: `npm run build` passed (14 s)
- Tests: `npm test` passed on main at 3f9c2ab, 212 tests; `auth/signin.test.ts` (touched by 3f9c2ab) ran and passed

> Tests  212 passed, 212 total

Acceptance criteria:
- [x] A member with valid details is signed in and sees their points balance: `signin.test.ts` "signs in a valid member"
- [x] Given wrong details, When the member signs in, Then they see an error: `signin.test.ts` "rejects a wrong password"
- [ ] Sessions survive an app restart for 30 days: no test covers this yet

Not shown by this evidence: behaviour against the real identity provider (tests use a stub).
```

Always include the "Not shown by this evidence" line when something material
is unproven. A verdict that overstates what was checked is worse than none.

Before quoting output or attaching a screenshot, and before a stand-up is
shared, check it for secrets and personal data (`standup.py` masks common
patterns such as credentials in URLs and API tokens, but not everything): tokens, keys, passwords, connection strings, internal
hostnames, customers' names or email addresses. Redact them (`[redacted]`)
or leave the excerpt out and point to the log file instead. The board is
shared and exported; the audit logs are not. Prefer screenshots of test data.

Take screenshots only when they will be used: for a ticket that changes
something a person sees, whose next move needs a screenshot, and whose other
evidence for that move is already sufficient. Earlier screenshots go stale
as the work continues.

## 5. Asking a person for a screenshot or other evidence

When evidence needs a person (an app that needs signing in, a mobile app, a
physical device, a stakeholder's confirmation):

1. Add the label `needs-screenshot` (or `needs-evidence` for anything else)
   with `set`, keeping the ticket's other labels. Create the label first with
   `add-label` if the board does not have it.
2. Add it to the design checklist, the file in the current working folder
   that lists every image the user must provide (project-kanban-board's
   `references/screen-design.md`, section 4):

```bash
python3 <kanban>/scripts/design_checklist.py <board-dir> add <KEY> screenshot "<what it must show>" --how "<how to get it on screen>"
```

   It never duplicates an item, so it is safe to run on every audit.
3. Add a comment that tells the person exactly what to do, and that the item
   is also in the checklist file (give its path):

```markdown
**Audit 2026-11-05: screenshot needed before this can move to Awaiting sign-off**

Please show the reschedule screen after choosing a new collection slot.

1. In ~/code/lockerlink-app, switch to the up-to-date main branch (`git switch main && git pull`), so the screenshot shows the shared code, then start the app: `npm run dev`, and open http://localhost:5173
2. Sign in as a test customer (any account with a booked parcel)
3. Open a parcel, choose "Reschedule", pick tomorrow 10:00, and confirm
4. Capture the confirmation screen, paste it into a comment on this ticket, and add a line saying what it shows

When that is done, remove the needs-screenshot label (or leave it: the next audit removes it once it finds an image newer than this request).
```

A `screen` ticket with no design attached and no checklist item gets a
checklist item of kind `design` for its design (never a duplicate ticket).

At the start of each audit, `design_checklist.py <board-dir> sync` shows
which ticked items have their image on the board. A ticked item with no image
is reported to the user (attended) or in the stand-up (overnight). On a later
audit, if a person has added an image comment after the request
(a comment with no `author`; the audit's own comments have `author: audit`),
check it meets section 1, then remove the label and record the evidence.
Comments without an author are treated as people's, so other scripts that
write comments should pass their own `--actor`.

## 6. New tickets

Create a ticket only for work that needs a person, an external team, or
another agent to act: a failing test whose fix needs a decision, behaviour a
ticket claims that is missing, a blocker on a third party, a broken build
nobody owns. Do not create tickets for the small fixes in section 7, and do
not create one if an open ticket already covers it (search titles and the
`audit` label first).

Each new ticket follows the project-kanban-board skill's
`references/ticket-writing.md`, like every other ticket on the board (plans
that do not are rejected):

- a short, product-focused title and the label `audit`;
- a description that starts with the story in the form that fits (a user
  story for a missing capability, Given/When/Then for wrong behaviour, a job
  story for a job someone cannot get done), then `### Technical notes`
  quoting the evidence that prompted it (the failing test's name and the key
  lines of output, the commit, or the missing behaviour), then `### Acceptance
  criteria` that state what passing looks like;
- it sits under the epic of the ticket or code it relates to;
- it starts in the first column, or `waiting` with `waitingFor` if it is a
  third party's move.

Use `create_board.py --append` with a small plan, after checking it with
`validate_board.py --plan <plan> --board <board-dir>`. Attach a task to an
existing epic by its key:

```json
{
  "labels": ["audit"],
  "tasks": [
    { "title": "Main builds again after the parser upgrade", "epic": "RCP-1",
      "labels": ["audit", "backend"], "priority": "high",
      "description": "**As a** developer on the recipe team, **I want** the main branch to build again after the markdown parser upgrade **so that** finished work can be tested and released.\n\n### Technical notes\n- `npm run build` fails on main at 8c1d2e4 since the upgrade in that commit:\n\n> TS2305: Module 'md-parse' has no exported member 'parseInline'\n\n- Found by the audit on 2026-11-05; no ticket covers it.\n\n### Acceptance criteria\n- [ ] `npm run build` passes on main.\n- [ ] Recipe pages render Markdown as before (headings, lists, links)." }
  ]
}
```

A contradicted ticket (for example in Done with its test failing) is never
given a second ticket for the same fix: propose moving it back. Once the
manager approves, that ticket is the open work again; until then, the
proposal (listed on every stand-up) is how the problem is tracked. Raise new
tickets only for problems no existing ticket covers.

## 7. Small fixes

Some problems are quicker to fix than to ticket. Offer these, never do them
unasked:

- lint and formatting errors the linter can fix automatically;
- typos in text, comments, or documentation;
- a test assertion that is plainly wrong (a misspelt expected string, a
  renamed constant), not one where the behaviour is in question;
- a broken import or path after a rename.

Anything that changes behaviour, needs a decision, or touches more than a
few lines is a ticket instead. When the manager accepts a fix, use
`scripts/fix_worktree.py`: ask before creating its branch (it never touches
the user's checkout), make the change in its worktree, run the relevant
approved command there and quote its output, and ask before committing.
Never push; give the manager the branch name.

If the manager declines a fix that keeps other tickets from moving (a lint
failure on their files, say), note on those tickets what is holding them and
record the proposal as `declined`. Offer a declined fix again only after a
week, or sooner if it starts holding back a ticket it did not before. If the
manager says not to ask again, record it as `dismissed`, and never offer it
again. `scripts/proposals.py check <key>` applies these rules from the
recorded decisions.
