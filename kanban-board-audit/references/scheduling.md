# Scheduling an overnight audit

The board and the repositories live on the user's machine, so the audit must
run there, in an open Claude Code session. Claude's cloud routines (the
`schedule` skill) cannot reach local folders, so they are not used.

The user wants to be asked before every scheduled run, and the run to happen
overnight so the stand-up is ready in the morning. Two jobs do that:

1. **Evening check-in** (recurring, weekdays): asks whether to run tonight.
2. **Overnight run** (one-off): created by the check-in only when the user
   says yes.

## Setting it up

Explain the limits first, then create the check-in with `CronCreate`:

- The Claude Code session must stay open, and the computer awake, overnight.
  On macOS, `caffeinate -i` in another terminal keeps it awake.
- Jobs exist only in this session, and recurring jobs expire after 7 days
  (as CronCreate's description says at the time of writing; check its current
  description). So the check-in must be set up again each week; each
  check-in warns when `schedule.json` shows fewer than two days left.
- Any command the audit runs must already be approved (`commands.py`); an
  unapproved or changed command is skipped overnight, never run. Approvals
  lapse when definition files such as package.json change on the default
  branch, so the evening check-in lists any that need approving again.
- Claude Code may ask permission before running a script or command. A
  permission prompt at 02:10 waits until morning, so before the first
  overnight run, do an attended audit in the same session and suggest the
  user allows these commands for the session when asked (or adds allow rules
  with the `update-config` skill): `python3` for this skill's and
  `project-kanban-board`'s scripts, `git`, and each approved command.
- If the board's live server runs in Docker (its `data/.server.json` says
  `"container": true`), the board's lock does not reach it on macOS or
  Windows. Overnight, the audit then applies nothing to the board; it writes
  `ops.json` and the proposals for the morning instead.

Check-in job (pick a minute that is not :00 or :30). It runs Sunday to
Thursday evenings, so the overnight runs land on Monday to Friday mornings:

```
cron: "57 17 * * 0-4"        (Sunday to Thursday at about 17:57, local time)
recurring: true
prompt: "kanban-board-audit evening check-in for <absolute board-dir>"
```

Record the set-up in `<board-dir>/.audit/schedule.json` as
`{"checkInJob": "<job id>", "createdAt": "<ISO time>", "expiresAround": "<created + 7 days>"}`,
so each check-in can tell when the schedule is about to lapse. To renew it,
delete the old job (`CronDelete` with `checkInJob`) before creating the new
one and updating the file, so two check-ins never run side by side.

## When the check-in fires

1. Send a `PushNotification` if that tool is available: "Board audit for
   <title>: run tonight? Answer in Claude Code." Without it, just ask.
2. Ask with `AskUserQuestion`: run tonight, skip tonight, or stop the
   schedule. Mention any command that is no longer approved (run
   `commands.py <board-dir> list --fetch`, which sees what tonight's scan
   will), because overnight it would be skipped; offer to approve it again.
   If `schedule.json` says the check-in expires within two days, say so and
   offer to set it up again.
3. If they say yes, create the one-off overnight job for about 02:10, pinned
   to the right date: tomorrow's date if it is before midnight now, today's
   if they answered after midnight but before 02:00. If it is already past
   02:00, schedule it for about 15 minutes from now instead. Confirm the time
   CronCreate reports.

```
cron: "<minute> 2 <day-of-month> <month> *"
recurring: false
prompt: "kanban-board-audit overnight run for <absolute board-dir>, approved by the user at <time>"
```

4. If they choose to stop, delete the check-in with `CronDelete` and remove
   `schedule.json`.

If nobody answers, the question waits and no overnight job is created, so
nothing runs and there is no stand-up the next morning. That is the intended
behaviour: no run without a yes.

## The overnight run

Run the scan with `--overnight`, which marks its run folder (an `OVERNIGHT`
file, written as the run starts). First check that no run folder created
since the user approved tonight's run holds that marker; if one does, another
overnight run has already started or finished, so stop. (The scan's own lock
also refuses to start while any audit of the board is running.) Then run the
normal workflow in **overnight mode**: ask nothing,
because nobody is there, and keep to what the user has already allowed:

- apply evidence comments, links, attachments, labels, and forward moves that
  meet the thresholds;
- create new tickets (labelled `audit`, so they are easy to review), but
  never for a "could not test" result, and never for a contradicted ticket
  (its move back is a proposal instead);
- queue every move back, every small fix, and anything needing a decision in
  the run folder's `proposals.json`;
- write the stand-up; send no notification (it would arrive in the night).

In the morning the user reads the stand-up in the newest run folder holding an
`OVERNIGHT` file (under `audits/`), whose "Decisions for
you" section lists the queued proposals.
