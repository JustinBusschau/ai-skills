---
name: review-a-skill
description: Adversarially reviews a Claude Code skill (a SKILL.md plus any references/ or scripts/ it ships) for weak defaults, security issues in whatever it produces, poor developer experience, and places where it assumes an action or recommendation succeeded without verifying it. Produces concrete, severity-ranked findings, each anchored to a file and a specific failure scenario, not vague unease. Use when asked to review, audit, sanity-check, or "bulletproof" a skill or subagent definition before trusting it, or to check whether a skill's instructions are internally consistent and actually hold up.
---

# Review a skill

## When to use

Use this whenever the request is to review, audit, critique, or stress-test a
Claude Code skill: a `SKILL.md` and whatever `references/`, `scripts/`, or
other supporting files ship alongside it. Triggers include "review this
skill," "is this skill ready/bulletproof," "adversarial review of my skill,"
"audit this skill before I use it," and "check this skill/subagent for gaps."

Do not use it to review ordinary application code (use `code-review` or
`full-repo-review` for that) or to write a new skill from scratch (use
`skill-creator` for that); this skill only critiques an existing one.

## Stance

The default failure mode of reviewing a skill is being reflexively agreeable:
skills read like well organised, authoritative prose, and prose that reads
well is easy to mistake for prose that is correct. Treat every instruction,
default, and claim in the skill under review as something to be broken, not
summarised. Say what's good only when it's specifically good (calibration, not
politeness), and spend the review budget on finding the things that would
embarrass the skill's author in front of a real user.

A finding only counts if you can state the concrete input, environment, or
sequence of events that triggers it, and what actually goes wrong as a result.
"This could be clearer" is not a finding. "If the registry is unreachable,
step 3 has no fallback and will either hang or silently guess a version" is a
finding.

## Step 1: Read everything, completely

Read the skill's `SKILL.md` and every file under `references/`, `scripts/`,
and any other supporting directory, in full. Do not sample or skim on the
assumption that reference files are repetitive detail; the most useful
findings in a review like this are often contradictions between files that
only show up when you hold the whole thing in your head at once, and a
file-by-file read will miss them.

If the artifact under review is a subagent definition rather than a skill
package (e.g. a file under `.claude/agents/`, with frontmatter like
`name`/`description`/`tools` followed by a system-prompt body, and typically
no `references/`/`scripts/` of its own), read that single file in full
instead - the same yardstick applies: hold the rest of its own text against
any rule or constraint it states for itself.

If the skill under review ships enough material that reading everything in
full genuinely isn't practical (a rough guide: more than about 15
reference/script files, or any single file long enough to be a large
fraction of your available context), don't silently skim to cope. Stop and
tell the user the scope (roughly how many files, how large), and ask whether
to read everything anyway (accepting the time/token cost) or prioritize
`SKILL.md` plus whichever reference files its own body explicitly tells the
executor to read before specific steps - those are the files the skill
itself flagged as load-bearing. Either way, state plainly in the final
report what was and wasn't read, the same way any other incomplete check
should disclose its own coverage rather than imply it was exhaustive.

Note, as you read:

- The skill's own stated scope: its frontmatter `description`, its "when to
  use" or trigger list, and any named use cases.
- Its own stated principles or rules, if it has them (an "operating
  principles" section, a "hard rules" list, anything phrased as a constraint
  on the executing agent). These become the yardstick you hold the rest of
  the skill against, including its own reference files. A skill that tells
  its executor "never trust memorised configuration" and then ships reference
  files full of unmarked, memorised specifics is contradicting itself, and
  that is one of the highest value findings this review turns up.

## Step 2: Work the checklist by category, not by file

`references/checklist.md` has the nine categories to probe: internal
consistency, scope versus claims, assumed success, security defaults,
failure-path coverage, developer experience, silent judgment calls, recovery
and reversibility, and audit/compliance honesty.

Go category by category across the whole skill, rather than finishing one
file before starting the next. Consistency and staleness problems live
between files, and a linear per-file read tends to rationalise each file on
its own terms instead of noticing that file two contradicts file one.

## Step 3: Build each finding before you record it

For every candidate problem, write down, before it counts as a finding:

- The exact file and location.
- The concrete scenario that triggers it: specific input, missing dependency,
  environment state, or sequence of actions, not an abstract "what if."
- What actually happens as a result: a wrong default shipped, a check that
  never ran, a claim that overstates what was verified, a cost or credential
  nobody was told about, a decision quietly made on the user's behalf.

If you can't fill in the scenario and the consequence concretely, it isn't a
finding yet. Keep pushing on it or drop it.

## Step 4: Verify before reporting

A finding that only survives a single pass through the material is a guess
wearing a severity label, not a verified defect - and this skill exists
specifically to catch skills that "assume an action or recommendation
succeeded without verifying it," so the same standard applies to its own
output. Before a candidate finding counts as ready to report, re-check it
independently of the read that produced it: re-read the exact lines cited,
re-trace the condition or code path, and actively try to argue it *doesn't*
actually happen.

- If you can trace the actual logic and reproduce the failure mode (not just
  argue it's plausible), mark it `CONFIRMED`.
- If it's a well-reasoned concern you can't fully trace to certainty (e.g. it
  depends on another tool's runtime behavior you can't execute here), mark it
  `PLAUSIBLE` and say so - don't present it with the same confidence as a
  confirmed one.
- If this check shows the described failure doesn't actually happen, drop
  the finding. A review that only ever confirms what it first drafted is as
  suspect as one that finds nothing wrong at all.

## Step 5: Rank and report

Order findings most severe first. A default that produces a compromised
production credential, a silently unenforced security control, or a false
compliance claim outranks an awkward default; an awkward default outranks a
wording nit.

Report them with `ReportFindings`, one entry per finding, with `category` set
to the closest of the checklist's nine areas, `failure_scenario` holding the
concrete trigger-and-consequence from Step 3, `short_summary` the one-line
label, and `verdict` set to whatever Step 4's check produced (`CONFIRMED` or
`PLAUSIBLE`) so the reader can tell a verified defect from a flagged concern.
Do not also restate the findings as prose; the structured list is the
output. If `ReportFindings` is unavailable in the current context, use the
same structure (file, one-sentence summary, concrete failure scenario,
category, verdict) as a plain ranked list instead.

Before the findings list, in one or two sentences, name what's genuinely well
built, if anything is. This is calibration for the reader, not a courtesy; a
review that finds nothing good in a mostly sound skill is as untrustworthy as
one that finds nothing wrong.

## Step 6: Stop there

This skill reviews; it does not fix. If asked to also apply fixes, that is a
separate pass: treat genuine judgment calls (tradeoffs a reasonable team could
decide either way, defaults with material or hard-to-reverse consequences,
scope decisions that change how much work the fix is) as questions for the
user rather than silent choices, and say plainly when a pragmatic middle
ground is being taken instead of asking. Do not start that pass unless it is
actually requested.
