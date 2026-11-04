# Plan format

A plan is a nested JSON file that `scripts/create_board.py` expands into the
board's `data/board.json`. You write the plan; the script assigns ticket keys,
timestamps, ordering, colours, and ids, then validates the result. Nesting
expresses the hierarchy directly, so a plan cannot put a sub-task under the
wrong parent by accident.

Check a plan before building with:

```bash
python3 <skill-dir>/scripts/validate_board.py --plan plan.json
python3 <skill-dir>/scripts/validate_board.py --plan more.json --board <board-dir>   # an append plan
```

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Board title, shown in the header and browser tab. |
| `description` | no | One or two sentences on the project. Shown in Board settings. |
| `keyPrefix` | no | Ticket key prefix, 1 to 10 upper-case letters or digits starting with a letter (`WEB` gives `WEB-1`, `WEB-2`). Defaults to the initials of the title. |
| `columnPreset` | no | `simple`, `standard` (default), or `delivery`. See below. |
| `columns` | no | Custom columns instead of a preset: a list of `{ "name", "kind", "id"?, "wipLimit"? }`. |
| `people` | no | Names (strings) or `{ "name", "role"?, "colour"? }`. |
| `labels` | no | Names (strings) or `{ "name", "colour"? }`. Order matters: colour by label uses the first of a ticket's labels in this list. |
| `assumptions` | no | Strings recording what you assumed. Shown under Board settings, so the board manager can see and challenge them. |
| `settings` | no | Initial view: `swimlanes` (`none`, `epic`, `assignee`), `colourBy` (`epic`, `label`, `none`), `showEpicCards` (`true` or `false`), `showSubtasks` (`true` or `false`). |
| `repos` | no | Code repositories the board tracks: `{ "name", "path" (absolute), "remote"?, "appUrl"?, "commands"? }`, where `commands` may give `setup` (install dependencies), `test`, `lint`, `build`, and `start` shell commands. Used by the `kanban-board-audit` skill to gather evidence; the board itself only lists them. |
| `epics` | no | Epics, each with nested `tasks`, each with nested `subtasks`. |
| `tasks` | no | Tasks outside any epic, or attached to an epic by `epic` (a ref, or an existing epic's key when appending). |
| `subtasks` | no | Only needed when appending: sub-tasks attached to an existing task by `parent` (a ref or key). |

### Column presets

| Preset | Columns (kind) |
| --- | --- |
| `simple` | To do (todo), In progress (in_progress), Blocked (blocked), Waiting on others (waiting), Done (done) |
| `standard` | Backlog (backlog), To do (todo), In progress (in_progress), Blocked (blocked), Awaiting action (waiting), Awaiting sign-off (signoff), Done (done) |
| `delivery` | Backlog, Ready (todo), In progress, Blocked, Awaiting action (waiting), Awaiting testing (testing), Awaiting sign-off (signoff), Done |

Column `kind` gives a column its meaning, whatever it is called: `backlog`,
`todo`, `in_progress`, `blocked`, `waiting`, `testing`, `signoff`, or `done`.
Moving a card into a `blocked` or `waiting` column asks for the reason; `done`
columns count towards progress. A board needs at least two columns and at least
one `done` column. Use custom `columns` when the project has a genuinely
different flow (for example "Awaiting client review" and "Awaiting legal
review" as two separate `waiting` columns), not just to rename things.

## Tickets (epics, tasks, and sub-tasks)

Every ticket accepts these fields:

| Field | Meaning |
| --- | --- |
| `title` | Required. A short, product-focused summary of the story's goal, under about 70 characters: "Reschedule a parcel collection", not "Add PATCH /bookings". See `references/ticket-writing.md`. |
| `description` | Required in practice: the plan is rejected without it. Markdown in three parts, following `references/ticket-writing.md`: the story (As a ... I want ... so that ...; Given ... When ... Then ...; or When ... I want to ... so I can ...), optional `### Technical notes` (including the source, such as "arc42 section 5.2"), and `### Acceptance criteria` or `### Definition of done` with at least one checklist item. |
| `status` | A column id, name, or kind (`"done"`, `"In progress"`, `"waiting"`). Defaults to the first column. |
| `assignee` | A name from `people`. A sub-task without an `assignee` key takes its parent task's assignee; give `"assignee": null` to leave it unassigned, or a name to give it to someone else. |
| `priority` | `low`, `medium` (default), `high`, or `critical`. |
| `labels` | Names from `labels`. A ticket labelled `screen` must also have a `### Screen data` table in its description (`references/screen-design.md`). |
| `due` | `YYYY-MM-DD`. Only when the input gives or clearly implies the date. |
| `blockedReason` | Why it is blocked. Required with a `blocked` status. |
| `waitingOn` | Who or what it is waiting on. Required with a `waiting` status. |
| `waitingFor` | The kind of party it waits on: `stakeholder`, `third_party`, `team` (another team member), or `other`. Shown on the card and used to group waiting work in the Overview. |
| `blockedBy` | Refs (or existing keys) of tickets that must finish first. Shows as "Depends on" on the card. |
| `ref` | A short plan-local name so other items can point at this one (`blockedBy`, `epic`, `parent`). Refs share one namespace across epics, tasks, and sub-tasks, so each must be unique in the plan. Not stored on the board. |
| `comments` | Strings, each added as a comment (for example a note quoting the source document). |
| `colour` | Epics only: `#rrggbb`. Leave it out to get a distinct colour from the built-in palette. |

Unknown keys are rejected with a suggestion (`asignee` gives "Did you mean
'assignee'?"), so a typo cannot silently drop data. `validate_board.py --plan`
also prints warnings for things that are allowed but probably wrong, such as a
To do ticket that depends on unfinished work.

Nesting: `epics[].tasks[].subtasks[]`. Epics cannot have parents, tasks can only
sit under epics (or nothing), and sub-tasks must sit under tasks.

## Example: a small event, flat layer

```json
{
  "title": "Team away day",
  "keyPrefix": "AWAY",
  "columnPreset": "simple",
  "people": ["Priya Shah"],
  "labels": ["booking", "comms"],
  "assumptions": ["Around 25 people, one day, within an hour of the office."],
  "settings": { "colourBy": "label" },
  "tasks": [
    { "title": "Agreed date and budget for the away day", "ref": "date",
      "status": "waiting", "waitingFor": "stakeholder", "waitingOn": "Department head to confirm budget",
      "description": "**As the** organiser, **I want** an agreed date and budget **so that** I can book with confidence.\n\n### Acceptance criteria\n- [ ] The department head has confirmed the date and budget in writing." },
    { "title": "Choose from three venues near the office", "ref": "venues",
      "assignee": "Priya Shah", "labels": ["booking"], "blockedBy": ["date"], "priority": "low",
      "description": "**As the** organiser, **I want** three venues to compare **so that** we pick one that suits the team and the budget.\n\n### Acceptance criteria\n- [ ] Three venues within an hour of the office, each with price, capacity for 25, and step-free access noted." },
    { "title": "Team knows the away-day date early", "labels": ["comms"], "blockedBy": ["date"], "priority": "low",
      "description": "**When** the date is agreed, **I want to** tell the team at once, **so I can** get as many people there as possible.\n\n### Acceptance criteria\n- [ ] Save-the-date sent to the whole team within a day of the date being agreed." }
  ]
}
```

## Example: a product build, epics with selective sub-tasks

```json
{
  "title": "Loyalty app MVP",
  "keyPrefix": "LOY",
  "columnPreset": "delivery",
  "people": [{ "name": "Mobile lead", "role": "Placeholder: rename in Board settings" }],
  "labels": ["ios", "android", "backend", "nfr"],
  "settings": { "swimlanes": "epic" },
  "epics": [
    { "title": "Accounts and sign-in", "ref": "accounts",
      "description": "**As a** loyalty member, **I want** a secure account I can sign in to **so that** my points are mine alone.\n\n### Definition of done\n- [ ] Members can sign in, stay signed in, and are protected from password guessing.",
      "tasks": [
      { "title": "Agreed sign-in options", "ref": "signin-decision",
        "status": "waiting", "waitingFor": "stakeholder",
        "waitingOn": "Product owner decision on social sign-in (brief section 4)",
        "description": "**As a** product owner, **I want** the sign-in options decided **so that** the team builds only what members will use.\n\n### Acceptance criteria\n- [ ] A recorded decision on which sign-in methods the MVP offers (brief section 4)." },
      { "title": "Members sign in to their loyalty account", "labels": ["backend"], "blockedBy": ["signin-decision"],
        "description": "**As a** loyalty member, **I want** to sign in on my phone **so that** I can see and spend my points.\n\n### Technical notes\n- Sign-in API issues short-lived access tokens with refresh tokens.\n\n### Acceptance criteria\n- [ ] A member with valid details is signed in and sees their points balance.\n- [ ] Given wrong details, When the member signs in, Then they see an error and stay signed out.\n- [ ] Sessions survive an app restart for 30 days.",
        "subtasks": [
          { "title": "Stay signed in between app launches",
            "description": "**Given** a member signed in within the last 30 days, **When** they reopen the app, **Then** they are still signed in.\n\n### Acceptance criteria\n- [ ] Token refresh works after the access token expires.\n- [ ] A revoked refresh token signs the member out." },
          { "title": "Protect accounts from password guessing", "labels": ["nfr"],
            "description": "**Given** five failed sign-ins for one account within 15 minutes, **When** a sixth is attempted, **Then** it is refused for 15 minutes.\n\n### Acceptance criteria\n- [ ] The sixth attempt is refused with a clear message.\n- [ ] Sign-in works again after 15 minutes." }
        ] }
    ] }
  ]
}
```

## Appending to an existing board

Run `create_board.py --plan more.json --out <board-dir> --append`. The plan
needs no `title`; its `people` and `labels` are added unless a person or label
with the same name (ignoring case) already exists. New tickets continue the
board's numbering. `title`, `description`, `keyPrefix`, `columnPreset`,
`columns`, and `settings` are ignored when appending (the script says so if they are
present). To attach new work to existing tickets, use their keys:

```json
{
  "tasks": [ { "title": "Sign in with Face ID or a fingerprint", "epic": "LOY-1",
               "description": "**As a** loyalty member, **I want** to sign in with Face ID or a fingerprint **so that** I do not have to type my password.\n\n### Acceptance criteria\n- [ ] A member who enables biometrics is signed in by it on the next launch." } ],
  "subtasks": [ { "title": "Fall back to a password when biometrics fail", "parent": "LOY-3",
                  "description": "**Given** biometrics fail three times, **When** the member tries again, **Then** they are asked for their password.\n\n### Acceptance criteria\n- [ ] The password prompt appears after the third failure." } ]
}
```
