# Planning guide

How to turn whatever the user provides into a board that one person can run.
The aim is a board the manager trusts on first sight: every ticket is
recognisably part of their project, the hierarchy matches how they think about
the work, and nothing is padding.

## Contents

1. Choose the size of board
2. Decompose by input type
3. Writing good tickets
4. Statuses, dependencies, and dates at the start
5. People and assignment
6. Colour, labels, and default view
7. When this tool is the wrong tool

## 1. Choose the size of board

Pick the smallest structure that fits. Extra levels cost the manager clicks on
every update, so add them only where they help.

| Tier | Typical input | Structure | Columns | Rough size |
| --- | --- | --- | --- | --- |
| Simple | A short personal or small-team brief: an event, a trip, a house move, a small report. | One flat layer of tasks. Add two to five epics only if the work falls into obvious groups (for a trip: travel, accommodation, documents). No sub-tasks unless a task truly has separate steps done at different times. | `simple` | 5 to 30 tickets |
| Standard | A product brief, a discovery project, a single app or service, a small architecture document. | Epics for capabilities or workstreams, tasks under them. Sub-tasks only on tasks that one person would otherwise hold open for more than about a week or that need several hand-offs. | `standard`; `delivery` if software is built | 20 to 90 tickets |
| Delivery | A multi-component system: arc42 or similar architecture with several services, mobile and web clients, data and BI, infrastructure, security, and formal testing and sign-off. | Epics per deliverable component or workstream, tasks, and sub-tasks for build steps that are tracked separately. | `delivery` | 60 to 250 tickets |

Any board on which software is built (even a single app or service) needs a
place for "awaiting testing", so use the `delivery` preset, or `standard` with
an added `testing` column, whatever the tier. A board with no build work (a
discovery, an event, a trip) does not.

Keep epics to about 15 or fewer. The colour palette has 12 clearly distinct
colours and 12 deeper shades of them; past 24, colours repeat. If a large
brief suggests more epics than that, group related deliverables (one "Core
services" epic with a task per service, one "Portals" epic) rather than
giving every component its own epic.

Tell the user which tier you chose and why in one sentence, so they can push
back. If the input is large enough to need more than about 250 tickets, plan
the first phase or release in detail and add the later phases as one epic
each with a handful of placeholder tasks, and say you have done so.

## 2. Decompose by input type

Read everything first. Then decompose in the user's own vocabulary: if the
document calls something the "Partner Portal", the epic is "Partner Portal",
not "B2B web front end".

### Architecture documents and arc42

arc42 sections map well onto board structure:

- **Introduction and goals (section 1)**: functional requirements and use
  cases become tasks under the epic of the building block that implements
  them; put the requirement ID in the title or first line of the description
  ("FR-12: Customer can reschedule collection") so the board can be checked
  against the document. Quality goals feed the quality tasks below.
  Stakeholders who must approve become sign-off tasks (see section 4 of this
  guide), not people.
- **Building block view (section 5)**: one epic per top-level building block
  that is built or changed (a service, an app, a data platform). Tasks for
  its significant sub-blocks or interfaces.
- **Runtime view (section 6)**: each important scenario becomes an
  end-to-end or integration test task across the blocks it involves, named
  after the scenario ("Deposit-to-notification flow works end to end").
- **Deployment view (section 7)**: an "Infrastructure and environments" epic:
  environments, networking, CI/CD, secrets, observability.
- **Cross-cutting concepts (section 8)**: security, logging, error handling,
  internationalisation, accessibility. Make each either an epic (if it is
  substantial work) or a label applied to the tasks it touches.
- **Quality requirements (section 10)**: tasks that prove each measurable
  quality scenario (load test to 500 requests per second at p95 under 300 ms,
  penetration test, recovery drill), with the scenario quoted as acceptance
  criteria. Label them `nfr`.
- **Architecture decisions (section 9)** still open: a task in `waiting` or
  `todo` per undecided decision, with who decides.
- **Risks and technical debt (section 11)**: a spike or mitigation task for
  each risk that needs action, labelled `risk`.
- **Constraints (section 2)** and **context (section 3)**: usually become
  assumptions or descriptions, not tickets. External systems in the context
  view often produce integration tasks and `waiting` items on third parties
  (API access, credentials, contracts).

Other architecture documents (C4 models, ADR sets, solution designs) map the
same way: containers or components become epics, relationships become
integration tasks, decisions and risks become tasks.

### Product briefs, canvases, and PRDs

- **Epics**: each capability, feature area, or user journey becomes an epic.
  Keep MVP and later scope apart: MVP work at the front, later work in Backlog
  with `low` priority or in a "Later" epic.
- **Numbered requirements** (a PRD with "FR-12 The system shall ..."): group
  related requirements into buildable tasks, typically two to six per task,
  rather than one ticket per "shall", which buries the manager in thin
  tickets. List the requirement IDs a task covers in its title or the first
  line of its description ("Covers FR-12, FR-13, FR-15"), so every
  requirement can be traced to a ticket. Check before building that every ID
  in the document appears somewhere on the board.
- **Non-functional requirements** (performance, availability, security,
  accessibility, privacy) become tasks with the measurable target quoted as
  acceptance criteria, labelled `nfr`, as for arc42 quality requirements.
- **Non-goals and out-of-scope items** do not become tickets. Record them in
  `assumptions` ("Out of scope per the PRD: offline mode") so the manager can
  point to them when someone asks.
- **Success metrics** become instrumentation and analytics tasks.
- **Assumptions and riskiest bets** on a canvas become validation tasks
  (interviews, prototypes, tests) that come before the build they de-risk;
  link them with `blockedBy`.
- **Channels, pricing, and go-to-market** on a canvas become a "Launch" epic
  (store listings, marketing site, pricing set-up, support readiness) only if
  the user is managing the launch too; otherwise record them as assumptions.
- **Stakeholders and approvals** become sign-off tasks that start in the first
  column, as described in section 4, not people on the board (unless they will
  do tasks) and not tickets sitting in `waiting` from day one.
- Do not invent technical architecture the brief does not have. Add a
  "Technical discovery and architecture" epic instead.

### Simple briefs ("plan an event", "plan a trip", "plan a discovery")

There is no document, so draw on what such projects normally need, and keep it
proportionate. Typical shapes:

- **Event**: date and budget, guest list and invitations, venue, catering,
  suppliers (AV, entertainment), run sheet for the day, follow-up and payments.
- **Trip or holiday**: dates and budget, travel, accommodation, documents
  (passports, visas, insurance), itinerary and bookings, money, packing.
- **Technical discovery**: kick-off and goals, stakeholder interviews,
  current-state analysis (systems, data, constraints), options and trade-offs,
  recommendation and roadmap, playback and sign-off.
- **App or product project**: discovery, design, build per platform or
  component, testing, release and store submission, launch and support.

Fill in specifics the user gave (destination, guest count, budget) and record
anything you assumed in `assumptions`. If one missing fact would reshape the
plan (for example whether a trip is domestic or needs visas), ask it before
building rather than guessing.

### Screens in any input

Whatever the input type, when it describes screens (a wireframe, a user
journey with named screens, a portal's pages, a dashboard), give each screen
its own ticket labelled `screen`, as `references/screen-design.md`
describes, under the epic of its journey. Take data sources from the API
contract or architecture document where there is one (cite the operation and
field); where the input does not say, write `Unknown` and raise the question
in `assumptions` rather than guessing.

### Large, complex delivery briefs

For a brief like "micro-service, event-driven system with iOS and Android
apps, web portals, and BI dashboards":

- One epic per deliverable: each service or bounded context, the event
  backbone, each client application (iOS, Android, each portal), BI and
  reporting, data platform, and identity.
- Cross-cutting epics: infrastructure and environments, security and
  compliance, observability, testing and quality (performance, security,
  accessibility, end-to-end), release and operations.
- A "Team and ways of working" epic for the management work the board manager
  owns: onboarding, environments access, ceremonies, stakeholder reporting.
- Labels for platform or layer (`ios`, `android`, `web`, `backend`, `data`,
  `infra`) so the manager can colour by label to see the mix.
- Default the view to swimlanes by epic.
- If several teams are involved, add a label per team (`team-payments`,
  `team-mobile`) and list the team labels first in `labels`: colour by label
  uses whichever of a ticket's labels comes first in that list, so cards are
  coloured by team even when they also carry platform labels. The Label filter
  then shows one team's work. The board has no separate team entity.

## 3. Writing good tickets

- **Wording**: every ticket is product-focused and follows
  `references/ticket-writing.md`: a story first (As a <type of user>, I want
  <some goal> so that <some reason>; Given <pre-condition>, When <action>,
  Then <result> for behaviour; When <situation>, I want to <motivation>, so I
  can <expected outcome> for a job to be done), then any technical notes,
  then acceptance criteria or a definition of done that testing can pass or
  fail. Read it before writing the plan; the plan is rejected without them.
- **Title**: a short, product-focused summary of the story's goal (under
  about 70 characters): "Customers see when their parcel is ready", not
  "Publish order-created events".
- **Traceability**: cite the source in technical notes or criteria ("From:
  product brief, Rewards section", "FR-12"), so the manager can check the
  board against the documents.
- **Granularity**: a task is something one person can finish and someone can
  check, typically half a day to a week of effort for technical work, or one
  sitting for personal projects. Split anything larger into sub-tasks or
  separate tasks; merge anything trivially small into its neighbour.
- **No duplicate gate tickets**: on a board with `testing` and `signoff`
  columns, testing and sign-off are states that each ticket passes through.
  Do not create a "Test X" ticket for every "Build X". Create separate tickets
  only for distinct activities with their own owner (user acceptance testing,
  a penetration test, a go-live approval meeting).
- **No padding**: every ticket should trace to the input or be a step the
  project genuinely cannot finish without. If you add a ticket the input did
  not ask for, its description should say why.

## 4. Statuses, dependencies, and dates at the start

- New work starts in the first column (`backlog` or `todo`). Put work that is
  ready to start first in `todo` and the rest in `backlog` when using the
  standard or delivery presets.
- Put a ticket in `todo` (or Ready) only if nothing it depends on is still
  open; otherwise it belongs in `backlog`, so the To do column is a true list
  of what can start now. On the `simple` preset, which has no Backlog, keep
  To do short by giving later items `low` priority.
- A future approval or sign-off (go-live approval, a client's acceptance of a
  deliverable) is an ordinary task, "Obtain Head of Operations go-live
  sign-off", starting in the first column with `blockedBy` links to the work
  it approves. When that work is ready, the manager moves the task to the
  sign-off column (or to `waiting`, with `waitingFor: "stakeholder"`).
- Epics are moved between columns by hand; their progress bar fills from
  their tickets automatically. Start every epic in the first column unless the
  input says its work is under way, and the board will suggest moving an epic
  to Done when its last ticket is done.
- Use `in_progress`, `done`, `blocked`, or `waiting` only where the input says
  so ("the venue is booked", "awaiting the client's brand guidelines"). Always
  fill `blockedReason` or `waitingOn` (the plan is rejected without them), and
  set `waitingFor` to say whether the wait is on a stakeholder, a third party,
  or another team member, so the manager can see at a glance whom to chase.
- Add `blockedBy` links for real sequencing (the venue must be booked before
  invitations go out) and for external dependencies. Do not link every task to
  its predecessor; a dense web is unreadable.
- Only set `due` dates the input gives or clearly implies (a go-live date, an
  event date and the lead times it forces). Never invent precise dates to make
  the board look complete.

## 5. People and assignment

- If the user names the team, add them and assign tasks where the input makes
  ownership clear.
- If the input names roles but not people, add the roles as placeholder people
  (name "Mobile lead", role "Placeholder: rename in Board settings") and assign
  by role. The manager can rename them later and every assignment follows.
- For a personal brief ("me and my wife", "our family"), add the people the
  user mentions using their own words ("Me", "Partner", or the names they
  gave), and assign only where the brief makes ownership clear.
- Add the board manager as a person (by name if known, otherwise "Delivery
  lead" or "Me") when they will own tickets themselves: approvals, chasing
  third parties, stakeholder reporting.
- If there is no information, leave people empty and tickets unassigned. The
  Unassigned swimlane makes the gap obvious, which is more useful than guessed
  names.
- Check the balance before building. If one person would hold far more open
  tickets than the others (more than about twice the team average), keep the
  assignments the input implies, but add a high-priority task for the board
  manager to review capacity and say so in your hand-over. The board's
  Overview and `board_report.py` both show open work per person.

## 6. Colour, labels, and default view

- Epics get distinct colours automatically. Colour by epic is the default and
  suits most boards.
- For a flat board with no epics, colour by label if you used labels for the
  natural groupings (booking, comms, travel), otherwise colour by none.
- Keep labels few (under about ten) and meaningful across epics: platform,
  layer, `nfr`, `risk`, `external`. A label used on one ticket is noise.
- Default view: swimlanes `none` for simple boards, `none` or `epic` for
  standard ones, `epic` for delivery boards. Leave `showSubtasks` on unless
  sub-tasks outnumber tasks by more than about three to one.

## 7. When this tool is the wrong tool

This board is for one person arranging and tracking the work. If the user
needs several people editing at once, permissions, notifications, time
tracking, sprints and velocity, or integration with source control, say so
and suggest Jira, Linear, Trello, or Notion. You can still build the board as
a planning draft; its `data/board.json` is plain JSON that can be converted
for import elsewhere.
