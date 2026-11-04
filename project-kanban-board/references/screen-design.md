# Screens, designs, and screen data

Every screen the input describes (an app screen, a portal page, a dashboard,
a dialog that is a screen in its own right) gets a design, and every element
on it that shows data says where that data comes from. This makes the board
the place where a developer, a tester, and the audit skill can see what a
screen must look like and what it must load.

## Contents

1. Screen tickets
2. The screen data table
3. Designs: generating wireframes
4. Designs you cannot provide: the checklist file
5. Telling the user

## 1. Screen tickets

Create one ticket per screen, labelled `screen`, under the epic of the
journey it belongs to. Like every ticket it follows `ticket-writing.md`: a
story first (usually a user story or a job story for the screen's purpose),
then technical notes, then acceptance criteria. Between the technical notes
and the criteria it has a `### Screen data` table (section 2). Its criteria
cover what the screen shows, its loading, empty, and error states, and any
behaviour on it.

Behaviour that happens on a screen (a button, a validation rule) can be its
own ticket, linked to the screen ticket with `blockedBy` or as a sub-task;
the screen ticket stays the home of the design and the data table.

Name the screen in the title the way users would: "Account overview",
"Reschedule collection", "Score history".

## 2. The screen data table

List every element that shows data, in reading order. Static copy (headings,
button labels) does not need a row unless its wording is decided by data.

```markdown
### Screen data

| Element | Shows | Source | Loaded / refreshed | States and notes |
| --- | --- | --- | --- | --- |
| Greeting | Customer's first name | Local secure storage (Keychain / Android Keystore), saved at sign-in | On open | Falls back to "Welcome back" if missing |
| Account number | Masked account number (last 4 digits) | API: `GET /v1/accounts/{id}` → `accountNumber` | On open; pull to refresh | Mask all but last 4; never logged |
| Current balance | Balance in GBP, 2 decimal places | API: `GET /v1/accounts/{id}/balance` → `available` | On open; every 60 s while visible | Loading skeleton; "Balance unavailable" on error, with retry |
| Last interaction | Date and type of the last transaction | API: `GET /v1/accounts/{id}/transactions?limit=1` | On open | "No transactions yet" when empty |
| Location banner | Nearest branch | Device location (with permission) + API: `GET /v1/branches?near=` | On open, if permission granted | Hidden without permission |
```

Source vocabulary (use the most specific that applies, and name the field):

- **API**: the call (method and path, or the operation name in the contract)
  and the field used. Cite the API contract section if there is one.
- **Local secure storage**: Keychain, Android Keystore, or the platform's
  equivalent, for secrets and identity (tokens, names saved at sign-in).
- **Local storage or cache**: non-sensitive data kept on the device, and
  how stale it may be.
- **Computed**: derived on the device or server from other data; say from
  what.
- **User input**: typed or chosen on this screen.
- **Device**: location, camera, contacts, sensors, with the permission
  needed.
- **Push or event**: a notification payload or a live event stream.
- **Unknown**: when the input does not say. Do not guess: write
  `Unknown: <question>` and record it in the plan's `assumptions`, so the
  manager can resolve it.

The validator checks that a `screen` ticket has a `### Screen data` section
whose table has at least one row with a source.

## 3. Designs: generating wireframes

When Chrome or Chromium is available, give each screen ticket a low-fidelity
wireframe you generate yourself:

1. Write a small HTML file per screen: grey boxes and plain text at the right
   device size, real-looking sample data, and beside or under each data
   element a small label naming its source from the table ("API: balance").
   No external resources; keep it simple and legible.
2. Render it:

```bash
python3 <skill-dir>/scripts/render_design.py <screen>.html <screen>.png --device mobile   # or tablet, desktop
```

3. Look at the PNG, then attach it to the ticket with a narrative:

```bash
python3 <skill-dir>/scripts/edit_board.py <board-dir> --op '{"op": "attach", "id": "LOY-12", "file": "<screen>.png", "body": "Wireframe (low fidelity, generated): account overview with data sources labelled. Replace with the final design when it exists."}'
```

A generated wireframe is a starting point, not a final design. When the
input says designs come from a designer or a design system, or the screen's
look matters (brand, marketing pages), also add a checklist item for the
final design (section 4).

## 4. Designs you cannot provide: the checklist file

When a design or screenshot is needed and you cannot provide it (no browser
to render with, a final visual design from a designer, a screenshot of a
running app that needs signing in, a photo of a physical device), add it to
the design checklist, a Markdown file in the current working folder:

```bash
python3 <skill-dir>/scripts/design_checklist.py <board-dir> add LOY-12 design "Final design of the account overview, all five data elements visible" --how "From the Figma file 'Loyalty app', frame Account / Overview; export as PNG."
python3 <skill-dir>/scripts/design_checklist.py <board-dir> list
python3 <skill-dir>/scripts/design_checklist.py <board-dir> sync
```

`add` creates the file the first time (`<project-slug>-designs-needed.md`
in the current working folder, or `--file` to choose) and remembers where it
is for this board. Each item names the ticket to add the image to, what it
must show, and how to get it, and items are never duplicated. The user ticks
an item (`- [x]`) once they have added the image to the board. `sync`
compares the ticked items with the board and reports any ticked item whose
ticket has no image newer than the request, and any unticked item whose
image has in fact arrived.

## 5. Telling the user

When the checklist file was created or changed in this piece of work, say so
in your reply: its path, how many items it holds (and how many are new), and
ask the user to tick each item in the file once they have added that image
to the board. If nothing needed adding, say nothing about it.
