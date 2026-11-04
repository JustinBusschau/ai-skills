# Writing tickets

Every ticket on a board is written from the product's point of view: who
benefits and why, not only what to build. This applies to epics, tasks, and
sub-tasks, on technical and non-technical boards alike. The
`kanban-board-audit` skill follows the same rules for tickets it raises.

## Contents

1. The shape of a ticket (screens: section 4a)
2. Choosing the form of the story
3. Acceptance criteria or definition of done
4. Technical notes
5. Titles
6. Epics and sub-tasks
7. Examples

## 1. The shape of a ticket

A ticket's description has three parts, always in this order:

1. **The story**, in one of three forms (section 2), as the first line.
2. **Technical notes** (optional): anything technical a person doing the
   work needs, after the story (section 4).
3. **Acceptance criteria** (or **Definition of done**): required on every
   ticket, so testing knows exactly what passing means (section 3).

```markdown
**As a** <type of user>, **I want** <some goal> **so that** <some reason>.

### Technical notes
- <detail, constraint, or link to the source document>

### Acceptance criteria
- [ ] <a single, observable, pass-or-fail condition>
- [ ] <another>
```

The board's validator rejects a plan whose tickets lack the story or the
acceptance criteria, and warns about such tickets on an existing board.

## 2. Choosing the form of the story

| Use this form | When the ticket is about | Form |
| --- | --- | --- |
| User story (the default) | A capability someone needs | **As a** <type of user>, **I want** <some goal> **so that** <some reason>. |
| Behaviour | How the product must behave in a situation: a rule, an edge case, an error | **Given** <pre-condition>, **When** <action>, **Then** <result or outcome>. |
| Job story | A job to be done, where the situation matters more than who is doing it | **When** <situation>, **I want to** <motivation>, **so I can** <expected outcome>. |

Guidance:

- Name a real type of user, not "user": "returning customer", "courier",
  "station manager", "parent travelling with two children". For internal or
  operational work, the user is the person who benefits: "As the on-call
  engineer, I want alerts when a locker stops reporting so that I can fix it
  before customers notice."
- The reason ("so that", "so I can") says why it matters to that person. If
  you cannot write one, question whether the ticket is needed.
- A behaviour ticket may hold several Given/When/Then scenarios, one per
  line or block; each scenario is also an acceptance criterion.
- Keep the story to one or two sentences. Detail belongs in technical notes
  and criteria.

## 3. Acceptance criteria or definition of done

Every ticket ends with a section headed `### Acceptance criteria`, or
`### Definition of done` when the outcome is a finished deliverable rather
than behaviour (a booked venue, a signed-off report). Write each criterion
so a tester, or the audit skill, can decide pass or fail without asking:

- one condition per line, as a Markdown checklist item (`- [ ] ...`);
- observable and specific: "The confirmation screen shows the new slot's date
  and time", not "rescheduling works";
- measurable where it is about quality: "p95 response under 2 s at 500
  requests per minute", not "fast";
- covering the unhappy paths that matter (invalid input, no availability,
  lost connection), often as Given/When/Then scenarios;
- citing requirement IDs from the source document where they exist
  ("FR-12", "QS-1"), so the board can be traced back to it.

Three to seven criteria is typical. More than about ten usually means the
ticket should be split.

## 4. Technical notes

Put technical detail after the story, under `### Technical notes`: APIs and
data involved, constraints, architecture decisions, edge cases for the
implementer, and links or section references to the source documents. The
notes support the story; they never replace it.

## 4a. Screens

A ticket for a screen is labelled `screen` and adds a `### Screen data`
table between the technical notes and the acceptance criteria, saying for
each element that shows data where that data comes from. It also needs a
design: a generated wireframe attached to it, or an item in the design
checklist. `references/screen-design.md` explains both.

## 5. Titles

The title is what shows on the card: a short, product-focused summary of the
story's goal, under about 70 characters. Write it as the outcome from the
user's side ("Reschedule a parcel collection", "Alert on-call when a locker
goes silent"), not as the story itself and not as an implementation step
("Add PATCH /bookings endpoint").

## 6. Epics and sub-tasks

- **Epics** carry a broad user story (or job story) for the whole capability
  and a **Definition of done** listing the outcomes that make it complete.
- **Tasks** are the main stories, each independently valuable and testable.
- **Sub-tasks** are narrower slices of their parent's story: often a single
  behaviour (Given/When/Then) or a smaller user story, with their own few
  criteria. When a sub-task is genuinely a step with no user of its own
  (configuring a pipeline, say), write it from the point of view of the team
  member it serves, and keep its criteria testable.

## 7. Examples

A user story with technical notes:

```markdown
**As a** returning customer, **I want** to reschedule my parcel collection **so that** I can collect it when I am actually at the station.

### Technical notes
- Uses the Locker Gateway's reservation API; slots are held for 72 hours (arc42 section 6).
- Source: FR-12.

### Acceptance criteria
- [ ] From an uncollected parcel, the customer can choose any free slot in the next 72 hours.
- [ ] The confirmation screen shows the new slot's date, time, and station.
- [ ] A new code is sent by SMS within 30 seconds of confirming.
- [ ] Given no free slots, When the customer opens Reschedule, Then they see "No slots available" and the current booking is unchanged.
```

A behaviour:

```markdown
**Given** a parcel whose collection code has expired, **When** the customer enters that code at the locker, **Then** the locker stays shut and the screen says how to request a new code.

### Acceptance criteria
- [ ] The scenario above passes on the test locker.
- [ ] The attempt is logged with the parcel ID and time.
- [ ] Given a valid code, When it is entered, Then the locker opens (no regression).
```

A job story on a personal project:

```markdown
**When** we arrive at Edinburgh Waverley with two tired children, **I want to** have the route to the flat already planned, **so I can** get everyone there without standing around in the cold.

### Definition of done
- [ ] Walking or taxi route from Waverley to the flat saved offline on both phones.
- [ ] Taxi firm number noted, in case of rain.
- [ ] Flat check-in instructions and key-box code saved offline.
```
