---
name: prd-generator
description: Generates standardized, engineering-grade Product Requirements Documents (PRDs) from a source document, notes, or a plain-language prompt describing a product or feature. Applies IEEE 29148-style requirements discipline (mandatory "shall" language, atomic statements, explicit subjects, measurable/verifiable criteria, unique requirement IDs, traceability) rather than producing loose narrative prose. Use this skill whenever the user mentions a "PRD," "product requirements document," "product requirements," "spec," or "requirements doc," or asks to turn a feature idea, meeting notes, brief, or ticket into formal product requirements - even if they don't mention IEEE 29148 by name. Also use it when asked to review, tighten, or "make more rigorous" an existing PRD or requirements list.
---

# PRD Generator

## Why this skill exists

Large language models can produce a PRD-shaped document from almost any prompt, but fluency isn't rigor. Left unconstrained, AI-generated PRDs tend to be ambiguous ("the system should be fast"), non-atomic ("the system shall authenticate users and log access attempts"), non-verifiable, or full of quietly embedded design decisions and assumptions nobody validated. Those defects are cheap to introduce and expensive to discover - usually during implementation, QA, or a contract dispute.

This skill exists to make the default output an engineering-grade specification: something a QA engineer could write a test against, and something a reviewer could hold up and say "yes, this is correct and complete," rather than "this looks thorough." The discipline applied here is drawn from ISO/IEC/IEEE 29148:2018, the requirements-engineering standard that formalizes decades of hard-won lessons about how requirements written by fallible humans (or LLMs trained on their writing) go wrong.

## Workflow

### 1. Gather the input

The input is usually one of:
- An uploaded document (transcript, ticket, brief, notes, existing rough PRD) - read it fully first.
- A plain-language prompt describing a product or feature.
- An existing PRD the user wants tightened up or brought into compliance - in this case, skip straight to drafting against the source PRD's content, preserving intent while fixing structural/language defects.
- A bare list of requirements (not a full PRD) that the user wants tightened to this discipline - this doesn't automatically need the full 15-section structure; see step 3.

Before drafting, make sure you actually know: who the product/feature is for, what problem it solves, and roughly what capabilities are in scope. If the source material already answers this, proceed - don't interrogate the user for information that's inferable. If it's genuinely missing (e.g., a one-line prompt like "write a PRD for a notifications feature"), ask a few targeted questions rather than inventing stakeholder needs from nothing - fabricated requirements fail the "Necessary" and "Correct" characteristics below before you've even written them down. Anything you do infer or assume, surface explicitly in the Assumptions & Constraints section rather than silently baking it into a requirement.

If the source material contains something that reads like a live credential, secret, or a clearly private/internal-only remark not meant for a wider audience, don't reproduce it verbatim into the PRD - paraphrase the fact it establishes (e.g. "requires authenticated access to the staging environment") without quoting the sensitive value itself. The PRD is explicitly meant for wider circulation than the source material it's drawn from.

### 2. Confirm the output format

Ask whether the user wants the PRD as a Markdown file or a Word document, unless they've already said. If Word, use whatever dedicated docx-generation capability the current environment provides (e.g. invoke a `docx` skill if one is listed) rather than hand-rolling docx generation yourself. Check it's actually available before relying on it - environments differ (a hosted sandbox may expose `/mnt/skills/public/docx/SKILL.md` directly; a local Claude Code install instead lists a `docx` skill to invoke). If neither is available, say so and ask whether Markdown is acceptable instead.

### 3. Draft using the standard structure

Use this section order for every PRD unless the user asks for something different. If the input was a bare requirements list rather than a PRD (step 1's fourth case), don't default to the full structure silently - ask whether the user wants the full PRD scaffold built around it, or just the requirements themselves tightened in place, without manufacturing Stakeholders/Decision Log/Risk Matrix sections the source never supported.

1. **Title & Metadata** - document title, version, date, author/owner, status (Draft/Review/Approved). Always present this as a table, never as consecutive plain lines - a stack of "Version: X / Date: Y / Owner: Z" lines is hard to scan and easy to misread. Use:

   | Field | Value |
   |---|---|
   | Version | ... |
   | Date | ... |
   | Owner | ... |
   | Status | ... |

2. **Revision History** - a table immediately below the metadata table, even for a first draft:

   | Version | Date | Author | Summary of Changes |
   |---|---|---|---|
   | 0.1 | ... | ... | Initial draft |

   When revising an existing PRD, append a new row rather than overwriting the old one or just bumping the version number silently - the point of this table is that someone can look at it later and see what changed and when, without having to diff two files.
3. **Overview** - one paragraph: what this is and why it exists. Narrative is fine here, but still avoid unverifiable marketing language ("revolutionary," "seamless").
4. **Goals & Success Metrics** - see rules below. Every goal should be atomic and every metric measurable.
5. **Background / Problem Statement** - the context and evidence motivating the work. State assumptions as assumptions, not as facts.
6. **Decision Log** - decisions that were actually made and stated in the source material, not proposals or possibilities. See the strict sourcing rule below.
7. **Scope** - explicit "In Scope" and "Out of Scope" lists, each item atomic.
8. **Stakeholders** - table of roles and their interest/responsibility.
9. **Functional Requirements** - IEEE 29148-style shall-statements, grouped by area, each with a unique ID.
10. **Non-Functional Requirements** - same discipline, covering performance, security, reliability, usability constraints (stated as measurable thresholds, not adjectives), compliance, etc.
11. **Assumptions & Constraints** - everything the requirements depend on that isn't itself a requirement.
12. **Risk Matrix** - risks raised or clearly implied by the source material, each with mitigation and/or owner where stated, and cross-referenced to an Open Question where one applies. See the strict sourcing rule below.
13. **Glossary** - every acronym and domain term used more than once, defined once, used consistently thereafter.
14. **Open Questions** - anything unresolved. Don't paper over a gap by quietly picking an answer and moving on; flag it instead so a human can close it.
15. **Appendix: Traceability** - a table mapping each requirement ID to its source (which stakeholder input, ticket, or conversation it came from) and its intended verification method (inspection, analysis, demonstration, or test).

#### Decision Log and Risk Matrix: strict sourcing rule

Both sections are easy to turn into filler by inventing plausible-sounding entries. Don't. Every row in both tables must trace back to something actually present in the source material, not something you inferred could plausibly be true of a project like this.

**Decision Log** - include only decisions that the source material states were actually made ("we decided," "Legal confirmed," "leadership approved X"), not options under discussion, proposals, or things phrased with uncertainty ("might," "probably," "leaning toward"). Columns: Decision, Rationale (as stated; write "Not stated" if the source gives a decision without a reason), Source (which part of the input it came from), Date (as stated; write "Not stated" if unknown). If the source material contains no explicit decisions, keep the table itself and put a single row reading `TBD | | |` (or just "TBD" across the row) rather than deleting the table or writing a paragraph explaining why it's empty - a human filling this template by hand would leave it blank or write "TBD," not justify the absence in prose.

**Risk Matrix** - include only risks that are either explicitly raised in the source material or a direct, obvious logical consequence of something explicitly stated there (for example, an explicit compliance concern in the notes implies a compliance risk; that's a reasonable restatement, not an invention). Do not brainstorm generic project risks that weren't grounded in anything the source said. Columns: Risk, Mitigation (as stated in the source; if none was given, write "TBD"), Owner (as stated; write "Unassigned" if none was given), Related Open Question (just the number, e.g. `4`; leave the cell blank if no Open Question applies - don't write out "Open Question 4" or a sentence explaining the connection). Do not invent Likelihood or Impact ratings (High/Medium/Low) unless the source material gives you a real basis for the rating. If no risks were raised at all, use the same `TBD` row convention as the Decision Log rather than a prose explanation.

Keep every cell in both tables to a short phrase, not a sentence with a subordinate clause justifying itself. If a cell needs more than about a dozen words to say what happened, that detail belongs in Assumptions & Constraints or Open Questions, with the table cell just pointing there (e.g., "See Open Question 4").

If a section genuinely doesn't apply (e.g., no non-functional requirements exist yet), keep the heading and say so explicitly rather than deleting it - an empty-but-labeled section is more useful to a reviewer than a silent gap.

### 4. Apply requirements discipline throughout

This is the part that distinguishes this skill from "write me a PRD." Read `references/requirements-style-guide.md` for the full rule set and worked examples before writing the Requirements sections - it covers mandatory language, atomicity, explicit subjects, verifiability, avoiding design bias, the recommended requirement sentence structure, and ID conventions. The short version:

- **Functional and Non-Functional Requirements sections**: every line is a single "shall" statement, one capability per statement, with an explicit subject (the system/the API/the service - never passive voice), a measurable/testable condition, and a unique ID.
- **Goals & Success Metrics**: the user asked for rigor here too, not just in the formal requirements. Each goal should be a single measurable outcome (e.g., "Reduce median checkout time from 45s to 20s within 60 days of launch," not "make checkout faster"). Avoid subjective terms (fast, easy, robust, user-friendly, sufficient) anywhere a number, threshold, or referenced standard could substitute.
- **Everywhere else** (Overview, Background, Scope descriptions): full IEEE atomicity/verifiability isn't the right fit for prose narrative, but still avoid vague, unverifiable, or design-biased claims where a concrete statement is available.

**Requirement IDs**: infer a short category code from context (e.g., `REQ-AUTH-`, `REQ-PERF-`, `REQ-SEC-`, `REQ-DATA-`, `REQ-UI-`, `REQ-API-`, `REQ-REL-`) and number sequentially within each category (`REQ-AUTH-001`, `REQ-AUTH-002`, ...). If a requirement doesn't fit a clear category, use `REQ-GEN-NNN` rather than forcing a bad fit.

### 5. Self-check before finalizing

Before presenting the draft, re-read every requirement and every goal/metric statement against this checklist. This is the same discipline the standard prescribes for human-authored requirements - it applies equally to what you just wrote:

- [ ] Uses "shall" (not will/should/may) for every requirement
- [ ] Has an explicit, unambiguous subject
- [ ] Expresses exactly one capability, constraint, or behavior (no "and" hiding a second requirement)
- [ ] Can be interpreted only one way
- [ ] Is verifiable by inspection, analysis, demonstration, or test - no subjective adjectives without a defined threshold
- [ ] States design choices only where actually mandated, not as an implicit default
- [ ] Has a unique ID
- [ ] Uses terminology consistent with the Glossary
- [ ] Every Decision Log entry traces to an actual stated decision in the source material, not an inferred or proposed one
- [ ] Every Risk Matrix entry traces to an explicit or directly implied concern in the source material, with no invented Likelihood/Impact ratings

Fix violations directly rather than flagging them and moving on. If you had to fix more than a couple, it's worth mentioning briefly to the user what kind of issues you cleaned up (e.g., "tightened three requirements that combined multiple behaviors into one statement") - that's useful signal about the source material, not just busywork to report.

### 6. Read-through pass: does this sound like a person wrote it?

Precision and formal structure are not an excuse for the document to read like it was generated by a template. Rigor lives in the content of each statement (subject, action, threshold, ID) - it doesn't require stilted delivery. Before finalizing, read the whole document straight through as prose (not just requirement-by-requirement) and fix anything that reads as mechanically "AI-generated," specifically:

- **Overly terse fragments.** Formal requirements should still be full, natural sentences. "REQ-AUTH-001: Login attempt logging, all, always" is not a requirement, it's a keyword list. Write it out: "The system shall log all authentication attempts."
- **Stacked or confusing sub-clauses.** If a sentence needs three commas and a semicolon to hold its conditions together, split it into a condition clause plus a clean main clause (see the `[Condition] + [Subject] + shall + [Action] + [Object] + [Constraint]` pattern), or into two requirements. Don't cram everything into one grammatically tortured sentence just to keep it to a single bullet.
- **Repetitive, templated cadence.** If every single requirement in a section starts with an identical rhythm ("The system shall X. The system shall Y. The system shall Z.") for more than a handful of statements, vary sentence length and structure where doing so doesn't compromise precision. The subject and "shall" stay explicit; everything around them doesn't have to sound like a mail-merge.
- **No em dashes or en dashes, anywhere, ever.** Use a standard hyphen (`-`) or restructure the sentence instead. This applies to every section of the document, not just the requirements - narrative sections, the glossary, notes, everything. If you catch yourself reaching for one, either use a comma, a colon, a semicolon, a full stop and new sentence, or a hyphen, whichever actually reads best.
- **Don't over-explain absence.** When a section or table has nothing to put in it, say so in the shortest way that's still honest - "TBD," an empty row, or a one-line note - not a paragraph justifying why it's empty. A human filling out a template leaves a blank or writes "N/A"; they don't write three sentences defending the blankness. This applies anywhere the draft is tempted to explain itself instead of just being sparse: table cells, empty sections, and skipped-but-labeled headings alike.
- **Overall tone.** Narrative sections (Overview, Background) should read like a competent product manager wrote them: clear, direct, specific, no filler adjectives, no corporate throat-clearing ("In today's fast-paced environment..."). If a sentence could be cut without losing information, cut it.

This is a distinct pass from the compliance checklist above - that one checks *correctness*, this one checks *voice*. Both matter: a document that's technically compliant but reads like a checklist dump will get dismissed before anyone evaluates whether the requirements are actually right.

### 7. Produce the file

Create the actual file (`.md` or `.docx` per step 2) rather than only showing the content inline - a PRD is a standalone deliverable. For Markdown, write directly. For Word, follow the docx skill's guidance for headings, tables (stakeholders, traceability), and styling.

Before saving, check whether a file of the same name already exists at the target location. If it does, don't silently overwrite it - ask whether to overwrite, or save under a distinguishing name (e.g. a version suffix or today's date) so the previous export is preserved.

Save the file to wherever the environment's convention is for deliverables - a hosted sandbox's `/mnt/user-data/outputs/` if that path exists, otherwise the current working directory (or wherever the user asks). Verify the file actually wrote successfully and, for `.docx`, that it opens without error before presenting it - a file that's written but silently malformed is worse than no file, because it looks done. Present it with whatever mechanism the environment provides for that (e.g. `present_files` in a hosted sandbox); if no such tool exists, just tell the user the full path directly.

## A note on tone

Don't over-apply this to the point of absurdity - "The system shall have a name" is not a useful atomic requirement. The goal is engineering precision where precision is actually load-bearing (what the system must do, how success is measured, what's verifiable), not mechanically shall-ifying every sentence in the document. Use judgment, and explain briefly to the user if you had to make a judgment call about scope or interpretation.
