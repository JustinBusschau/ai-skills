# __TITLE__

A single-user kanban board for this project. It runs locally in your browser
and keeps everything in plain files in `data/`.

## Run it

You need Python 3.9 or newer and nothing else (macOS or Linux; on Windows,
use WSL):

```bash
python3 server.py            # then open http://localhost:8080/
python3 server.py --port 8090
```

Or with Docker, if you would rather not use the host's Python:

```bash
docker compose up --build -d
docker compose logs board    # shows the link to open, which includes an access token
```

Inside a container the server has to listen on all interfaces, so in Docker
it always requires an access token. The link in the logs sets it as a cookie.
The token is kept in `data/.kanban-token`, so the link stays the same across
restarts; delete that file to issue a new one, or set `KANBAN_TOKEN`.
Use `docker compose`, which publishes the port on 127.0.0.1 only. A plain
`docker run -p 8080:8080` would publish it to your whole network.

On Linux, run the container as your own user so it can write to `data/`:
`KANBAN_UID=$(id -u) KANBAN_GID=$(id -g) docker compose up --build -d`.

Stop the server with Ctrl+C in its terminal, or run `python3 server.py
--stop` in this folder, which stops only this board's server (with Docker,
`docker compose stop`).
Your board is saved as you go. If another program is already using the port,
the server refuses to start; pick another with `--port`.

## Using the board

- **Move a card** by dragging it to another column, or focus it and press
  Alt+Left or Alt+Right. Moving into a Blocked or Awaiting action column asks for the
  reason, which then shows on the card.
- **On a phone or tablet**, drag and drop is impractical: open the card and
  change its Status instead. "Filters and view" shows the board controls.
- **Open a card** by clicking it (or Enter when focused) to edit any field, add
  sub-tasks, record dependencies, and add comments.
- **Comments and descriptions** accept Markdown. Paste or drop a screenshot into
  the text box to attach it, or use "Add image". "Add diagram" inserts a Mermaid
  diagram block; use Preview to check it. Each comment shows when it was added
  and when it was last edited.
- **Swimlanes** group the board by epic or by assignee (with an Unassigned
  lane). Dragging a card into another assignee's lane reassigns it; dragging a
  task into another epic's lane moves it to that epic.
- **Colour by** epic or first label. The strip under the toolbar lists every
  epic with its status and progress.
- **Overview** lists what is blocked, waiting, awaiting testing or sign-off,
  overdue, or due in the next 14 days, with progress per epic and open work
  per person. Click any key to open that ticket.
- **Filters**: search (press `/`; it covers titles, descriptions, reasons,
  labels, and comments), assignee, epic, and label. Tick "Epic cards" to show
  epics as cards in the columns, and untick "Sub-tasks" for a higher-level view.
- **Board settings** manage people, labels, and columns (names, kinds, order,
  and work-in-progress limits), and download a backup.

## Where your data lives

| Path | Contents |
| --- | --- |
| `data/board.json` | The whole board: columns, people, labels, tickets, and comments. |
| `data/uploads/` | Images attached to descriptions and comments. |
| `data/backups/` | Earlier versions of `board.json`, thinned with age (see Security below). |

To back up or move the board, copy the `data/` folder, or use "Download board
and images (.zip)" in Board settings. The download includes only images that
a description or comment still uses. Deleting a comment does not delete its
image from `data/uploads/`, and `data/backups/` keeps deleted text for up to
a year. If something sensitive was pasted, reload or close other board tabs,
delete it from the board, then ask Claude to run the skill's
`edit_board.py --purge-text-stdin --clean-uploads --include-recent` (with the
text passed exactly, on standard input),
which removes it from status history, backups, and plan copies, and removes
any image nothing uses. It cannot reach copies you downloaded, git history,
or your browser's cache. If it was a password or key, change it: removing it
from the board does not make a leaked secret safe.

Each ticket keeps a status history (open a ticket and expand "Status
history"). Moving a ticket out of Blocked or Awaiting action clears the old reason
from the card; the history keeps it.

Claude can change the board while the server runs, using the skill's
`edit_board.py`, which takes the same lock as the server's saves. The open
browser tab notices within a few seconds and reloads. If the tab had unsaved
changes at that moment, it tells you and lets you choose which version to
keep rather than overwriting either silently.

## Security

There is no login, so the server relies on not being reachable:

- It listens on 127.0.0.1 only by default, which is what keeps other machines
  out.
- It refuses requests whose `Host` header is not `localhost` or another allowed
  name. This stops a malicious web page from reaching it through DNS
  rebinding; it does not stop other machines, because a client chooses its own
  `Host` header.
- Every change needs a custom request header that other websites cannot send,
  so a page you visit cannot edit your board.
- With `--allow-remote` (and always in Docker) it also requires an access
  token, printed in a link when it starts. Only use `--allow-remote` on a
  network you trust, and add the host name others will use with
  `--allowed-hosts`.
- Uploads must be PNG, JPEG, GIF, or WebP images of 10 MB or less. Markdown is
  rendered with HTML escaped and only attached images displayed, and the page's
  Content Security Policy blocks inline scripts.
- Mermaid diagrams use the copy in `static/vendor/` if present, otherwise one
  pinned, integrity-checked file from cdn.jsdelivr.net. Offline, the diagram
  source is shown instead.

Backups: every save keeps the previous board in `data/backups/`. All copies
from the last two hours are kept, then one per hour for two weeks and one per
day for a year. A copy taken just before any delete (of a ticket, comment,
person, label, or column, in the board or by Claude's edit script) is kept
separately; the newest 100 of those are kept.
