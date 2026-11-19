---
name: exam-revision-notebook-notes
description: Produce narrative, notebook-ready revision notes for one specific BBKA syllabus item, with a cover-and-recall block and tables or lists where exact recall matters. Use when the user names a syllabus item or a narrow exam topic to revise, for example "3.10 the statutory requirements and guidance relating to the Asian Hornet", "syllabus item 3.27", "revise 2.14 honey spoilage", or "notes on Nosema ceranae". Also use when the user asks for notebook notes, copyable bullets, something to write out by hand, mnemonics or memory tricks for a list, or narrative explanation of a single syllabus point. For the separate condensed recall sheet, use exam-revision-revision-notes instead.
---

## When to use

Use this skill when the user has identified **one specific syllabus item** or a narrow topic and wants notes they can read, study from and copy into a notebook. The trigger is a syllabus number, a quoted syllabus sentence, or a named topic.

This is one of five revision outputs:

| The user wants | Use |
|---|---|
| Narrative notes for one syllabus item | **this skill**, `..._notes.md` |
| Condensed recall facts and traps for that item | `exam-revision-revision-notes`, `..._revision-notes.md` |
| A syllabus-mapped recap with a Q&A for a block | `exam-revision-review`, `..._recap.md` |
| Single-point Anki cards for a block | `exam-revision-anki-deck`, `..._anki.tsv` |
| A study-group presentation for a block | `exam-revision-marp-deck`, `..._marp.md` |

The notes are the authority for the other outputs. Read the shared conventions in `Revision-Output-Standard.md` in the study-plan repository before starting a new item.

**Guard against scope mismatch.** If the user names a range covering much of a module, such as "3.13 to 3.17 varroa" or "all of Module 2", this is the wrong tool. Suggest `exam-revision-review` for the block first, then offer this skill for the highest-yield items inside it.

## Do not interrogate

The user will arrive with a specific item. Ask only if the item is genuinely ambiguous, and otherwise proceed directly.

## The learning model this serves

These design decisions follow how the user studies, so do not "improve" on them without reason:

- They are learning the subject, not just the exam. The notes must teach the material as it stands on its own and never be shaped by what has been examined.
- They re-read later and think about why the note was written as it was. Every fact must earn its place on its own merits, and re-reading must be an active recall event rather than comfortable recognition.
- They want certainty, not coverage. A short list they are certain of beats a long one they half know.
- They dislike scaffolding that talks about the scaffolding. Leave out preambles such as "why this is here".

## What to do

### 1. Pin the syllabus item and read the whole of it

Find the current module syllabus PDF in the module's folder first (its filename changes with each sitting, so search rather than assume a fixed name, for example `find "Module Prep/Module 3" -iname "*yllabus*.pdf"`), then read it to get the exact item number and wording:

```bash
pdftotext -layout "<the file you found>" /tmp/mod<n>.txt
```

The wording tells you the breadth required. "Give a detailed account of" and "including" are instructions about how much to cover.

### 2. Read the syllabus verb, and let it set the recall type

| Syllabus verb | What is required | What to do |
|---|---|---|
| List, name, state, give | A specific set or a single fact | **Set out exactly.** A numbered list, and the structure that gives it shape. |
| Describe, give an account of | A narrative with detail | **Narrative, then the numbered component facts** so the shape survives. |
| Summarise, outline | Main points, concise | **Headings and a skeleton**, not detail. |
| Explain, state why, state how | Reasoning and mechanism | **Narrative in section 1**, without turning it into a memorise list. |
| Identify, recognise, distinguish | Discriminators | **Set them out in a table**, side by side. |

### 3. Write section 1 as narrative, then give the recallable material as a table or a list

The single most important formatting rule. Section 1 reads as **well-formed prose that explains the material**, in the order a competent writer would explain it: what the thing is, how it works, why it matters, where the exceptions lie. Do not write section 1 as a bullet list of facts.

Where a group of material has to be recalled exactly, put it in a table or a numbered list immediately after the narrative that introduces it. That applies to fixed sets and counts, sequences and life cycles, procedures and steps in order, hard values, comparisons between two similar things, and anything with a discriminator. Never let the tables and lists replace the explanation.

Length: a syllabus item normally runs to **120 to 250 lines** of markdown. Longer where the item is broad, shorter where it is narrow.

### 4. Handle lists properly: structure first, mnemonic second

For every list of four or more items, and for every set the reader needs to recall as a whole, supply **both**:

- **A structure.** The reason the list is the shape it is: chronological, functional, spatial, or by classification. Name the structure explicitly, for example "these run in time, not in order of importance". A table whose rows are groups of two or three is itself a structure.
- **A mnemonic.** Only if one genuinely works, and in the narrative, never as an aside bolted onto a list.

Prefer the structure. Do not force bad mnemonics: a weak one produces false confidence. Put the count in the list itself where the number matters.

### 5. Leave the condensed recall sheet to the companion skill

Do not write a "Be 100% sure" or "Traps" section here. Those two sections now live in the separate `..._revision-notes.md` file produced by `exam-revision-revision-notes`, to be used after the narrative is understood. Keeping them out of the notes preserves the point of this file: notes explain; revision notes drill.

The cover-and-recall questions stay here, because they test whether the reader can engage with the narrative at all.

### 6. Resolve source disagreements, and date the current facts

Two rules shape what goes into the prose:

- **The BBKA wins.** Where a BBKA source (the syllabus, a mark scheme, BBKA guidance or a BBKA position statement) disagrees with another source on an examinable fact, teach the BBKA version as the answer. It is the exam board and sets the questions. A one-sentence aside about the other version is fine when it prevents confusion, but never leave the answer as "check which source to quote" or present both as equally acceptable.
- **Date what moves.** Regulations, outbreak figures, import suspensions, product names, resistance status, show venues and similar facts change. State them plainly and add one line after the cover-and-recall block: `**Currency:** Time-sensitive facts in this note are current at <the full date you write it>.` If nothing in the item is time-sensitive, omit the line. Do not write "volatile", "re-check before the exam", or "verify this before sitting"; those instructions belong to a previous standard.

Where a claim cannot be settled even with this precedence rule, keep it and mark it plainly in the prose as **unverified**, with the competing versions and the one the BBKA answer uses. Say so in your reply, because the user needs to know what was not settled.

### 7. Never refer to past exam questions in the notes

The notes must contain no paper dates or sittings, question numbers, mark allocations, "asked in" or "most examinable" framing, and no study-plan references. A fact taken from a past paper is still a fact: write it and leave the paper out. Section 1 must cover the whole syllabus item, including anything never examined.

### 8. Save the file

To the module prep folder for the module in question:

```
Mod<n>_Item_<item number>_notes.md
```

Use underscores between words and Title Case for the topic. Do not overwrite without saying so. If the file already exists from the old standard, edit it in place: remove the old sections 2, 3 and 4, keep the narrative, and add the currency line where needed.

## Document template

Use this shape. Adapt the number of section 1 blocks to the item, but keep the cover-and-recall block and section 1.

```markdown
# Module <n> · Item <x.y> · <the full syllabus wording of the item>

## Cover and recall

Answer these <three or four> cold, before you read anything below.

1. <question, phrased the way the material is normally asked>
2. <question>
3. <question>

**Currency:** Time-sensitive facts in this note are current at <full date>.

## 1. <The topic>

<narrative paragraphs explaining the material>

| <Comparison or set, when one is needed> | |
|---|---|
| | |

1. <Numbered list, when the set or sequence has to be recalled exactly>
2. 
```

Nothing goes between the title and the cover-and-recall block: no exam evidence block, certainty target, verification line, provenance table or "my own hooks" section. The currency line follows the questions only where needed.

The title carries the full syllabus wording, verbatim. Never a shortened or paraphrased form. Extract the item from the syllabus PDF, capitalise the first letter, drop the trailing full stop, italicise binomial names and replace any en dash with a colon. The full wording of item 2.13, for example, includes "(including the effect of water content, storage temperature and the presence of yeast)" and must appear in the title.

## Verify facts against a primary source

Do not check a fact against another file in the repository, because material drifts consistently across a notes file, its recap and its deck. Check against:

- the **module syllabus PDF**, for the item's scope;
- the **BBKA mark schemes and guidance**, which win where they disagree with other sources;
- the **NBU advisory leaflets and fact sheets** on nationalbeeunit.com, for disease, hive and legal guidance;
- **legislation.gov.uk**, for statutory instruments, article numbers and amendment histories;
- the **VMD product information database**, for authorised medicines, actives and directions;
- the **National Honey Show's current schedule of competitive classes**, for every show specification;
- the relevant **textbook**, where no primary source exists.

## Quality checklist before finishing

- Exactly one syllabus item is covered.
- The title carries the full syllabus wording, verified word by word.
- Every fact is checked against a primary source, or marked **unverified** in the prose where the BBKA precedence rule does not settle it.
- A cover-and-recall block of three or four questions comes before section 1.
- Section 1 is narrative prose with tables or numbered lists where recall needs them, not a bullet list of facts.
- Section 1 covers the whole syllabus item, including anything never examined.
- No "Be 100% sure", "Traps" or "Volatile facts" section.
- Any time-sensitive facts are covered by one `Currency: ... current at <date>` line, with no "volatile" or "re-check before the exam" wording.
- Where sources disagree, the BBKA answer is taught as the answer.
- Every list of four or more items has a stated structure, and a mnemonic only where one genuinely works.
- Values are bold and unambiguous, with no hyphens standing in for ranges: write "5 to 8", not "5-8".
- No paper dates, question numbers, mark allocations or exam-weighting language anywhere.
- No "why this is here" or similar preamble before any block.
- British English, Oxford comma, scientific binomials italicised in markdown.
- No en dashes or em dashes anywhere.
