# Board file format (`data/board.json`)

This is what `create_board.py` writes and what the browser reads and saves.
Read it when answering questions about a board or when an edit is outside what
`scripts/edit_board.py` supports. Prefer `edit_board.py` for changes: it
validates, backs up, and takes the same lock (`data/.board.lock`) as the
server's saves. A hand edit takes no lock, so make one only while the server
is stopped. The
single source of truth for the rules is `validate_board()` in
`assets/app/boardlib.py`.

```json
{
  "schemaVersion": 1,
  "board": {
    "title": "Loyalty app MVP",
    "description": "",
    "keyPrefix": "LOY",
    "nextNumber": 42,
    "createdAt": "2026-10-31T09:00:00Z",
    "updatedAt": "2026-10-31T09:30:00Z",
    "assumptions": ["..."]
  },
  "columns": [ { "id": "in-progress", "name": "In progress", "kind": "in_progress", "wipLimit": null } ],
  "people":  [ { "id": "p-sam-patel", "name": "Sam Patel", "role": "", "colour": "#1d4ed8" } ],
  "labels":  [ { "id": "l-backend", "name": "backend", "colour": "#0891b2" } ],
  "repos":   [ { "id": "web", "name": "Web", "path": "/Users/sam/code/web", "remote": "https://github.com/acme/web",
                 "appUrl": "http://localhost:3000", "commands": { "test": "npm test", "lint": "npm run lint" } } ],
  "tickets": [
    {
      "id": "LOY-7",
      "type": "task",
      "title": "Build sign-in API",
      "description": "Markdown",
      "parent": "LOY-1",
      "status": "in-progress",
      "assignee": "p-sam-patel",
      "priority": "medium",
      "labels": ["l-backend"],
      "colour": null,
      "due": "2026-12-01",
      "blockedReason": "",
      "waitingOn": "",
      "waitingFor": "",
      "blockedBy": ["LOY-5"],
      "links": [ { "type": "commit", "ref": "3f9c2ab", "repo": "web",
                   "url": "https://github.com/acme/web/commit/3f9c2ab", "title": "Add sign-in endpoint" } ],
      "order": 30,
      "history": [
        { "at": "2026-10-31T09:30:00Z", "from": "todo", "to": "in-progress" },
        { "at": "2026-11-02T10:00:00Z", "from": "blocked", "to": "in-progress", "note": "was blocked: awaiting API keys" }
      ],
      "createdAt": "2026-10-31T09:00:00Z",
      "updatedAt": "2026-10-31T09:30:00Z",
      "comments": [
        { "id": "c-1a2b3c", "body": "Markdown, may include ![x](uploads/<32 hex>.png) and ```mermaid blocks",
          "createdAt": "2026-10-31T09:10:00Z", "updatedAt": "2026-10-31T09:20:00Z" }
      ]
    }
  ],
  "settings": { "swimlanes": "none", "colourBy": "epic", "showEpicCards": false, "showSubtasks": true }
}
```

Rules the validator enforces:

- `type` is `epic`, `task`, or `subtask`. Epics have no parent; a task's parent
  is an epic or null; a sub-task's parent is a task. No cycles.
- `waitingFor` is empty or one of `stakeholder`, `third_party`, `team`,
  `other`.
- `due` is a real calendar date. `blockedBy` links must not form a loop.
- `status` is a column `id`; `assignee` a person `id` or null; `labels` label
  `id`s; `blockedBy` existing ticket ids (not itself).
- Timestamps are UTC ISO 8601 ending in `Z`, without fractions in practice.
  `updatedAt` on a comment is the time it was last edited; the UI shows
  "Edited ..." when it differs from `createdAt`.
- `board.nextNumber` is greater than every `<keyPrefix>-<n>` key, so new
  tickets never reuse a key.
- At least two columns and at least one with kind `done`.
- `order` sorts cards within a column (lower first).
- `history` (optional) lists status changes, newest last, capped at 100. An
  entry made by a script run with `edit_board.py --actor <name>` carries
  `"by": "<name>"`; comments made that way carry `"author"`. Moving
  a ticket out of a blocked or waiting column clears `blockedReason` or
  `waitingOn` and `waitingFor`, and the history entry keeps the old reason as
  `note`. `edit_board.py` and the browser both maintain it; a hand edit that
  changes `status` should add an entry too.
- `settings.showEpicCards` and `settings.showSubtasks` are booleans.
- `repos` (optional) lists the code repositories the board tracks. `path` is
  absolute; `commands` maps `setup`, `test`, `lint`, `build`, and `start` to shell
  commands. Nothing on the board runs them: the `kanban-board-audit` skill
  does, and only after the user has approved each command.
- `links` (optional, per ticket) are evidence links of type `commit`, `pr`,
  `branch`, or `url`, each with an http(s) `url` and/or a `ref`, and an
  optional `repo` id that must be in `repos`.

Images live in `data/uploads/` with random 32-character hex names and are
referenced from Markdown as `uploads/<name>.<ext>`. Only PNG, JPEG, GIF, and
WebP are accepted. The Markdown renderer only displays images from
`uploads/`, so a comment cannot pull in a remote image.

## Maintaining the skill: the Docker base image

`assets/app/Dockerfile` pins Python's minor version (`python:3.13-slim`), so
`docker compose build --pull` picks up its security patches. When that Python
version nears end of life (October 2029 for 3.13), move to a newer minor
version and rerun the smoke test.

## Maintaining the skill: the Mermaid pin

Mermaid is pinned (currently 11.17.2) because the page loads it from a CDN
with Subresource Integrity. Security fixes to Mermaid therefore need a
deliberate update. To move to a newer release, change the version and both
hashes together, in three places:

- `assets/app/static/app.js`: `MERMAID_CDN` and `MERMAID_SRI`;
- `assets/app/server.py`: the `script-src` URL in `CSP`;
- `scripts/create_board.py`: `MERMAID_URL` and `MERMAID_SHA256`.

Compute the hashes from the downloaded file:

```bash
curl -sSfL -o mermaid.min.js https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.min.js
shasum -a 256 mermaid.min.js                                   # MERMAID_SHA256
echo "sha384-$(openssl dgst -sha384 -binary mermaid.min.js | base64)"   # MERMAID_SRI
```

Then run `smoke_test.py` on a board: its Mermaid check fails if the new
version does not load or render under the page's Content Security Policy.
Existing boards pick the change up with `create_board.py --update-app`.
