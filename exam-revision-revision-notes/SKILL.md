---
name: exam-revision-revision-notes
description: Turn the narrative notes for one BBKA syllabus item into a short revision sheet of facts to know cold and the traps that lose marks, with compact labelled official diagrams where relevant. Use when the user wants a condensed recall sheet, a "be 100% sure" list, a list of traps or wrong answers, or revision material to use after the narrative notes are understood, for example "revision sheet for 3.10", "traps for item 2.14", or "turn this notes file into a final recall sheet". Use alongside exam-revision-notebook-notes, exam-revision-review, exam-revision-anki-deck and exam-revision-marp-deck.
---

## When to use

Use this skill when the user wants the condensed, drillable half of one syllabus item: the facts to hold in the head and the mistakes to avoid. It is deliberately separate from `exam-revision-notebook-notes`, whose file explains the material and should be understood first. The two files together replace the old notes file that carried narrative, a "Be 100% sure" section, traps and a volatile-facts section all at once.

Inputs, in order of preference:

- An existing `Mod<n>_Item_<x.y>_notes.md` file. Treat it as the source of truth and extract from it, adding no new facts.
- An old-standard notes file that still contains "Be 100% sure", "Traps" and "Volatile facts" sections. Extract those sections, convert them to this standard, and leave the original notes file to be updated by `exam-revision-notebook-notes`.
- A named topic with no notes file. In that case run `exam-revision-notebook-notes` first, then work from its output.

Read `Revision-Output-Standard.md` in the study-plan repository before starting a batch.

## What to do

### 1. Read the notes file in full

Read the narrative section as well as the blocks you are extracting, so the condensed bullets stay in the same order and use the same vocabulary. If the notes file contains a `Be 100% sure` or `Traps` section, those are the raw material. If it does not, derive the sheet from the narrative, using only facts that appear there.

### 2. Resolve source disagreements and date current facts

The BBKA wins where sources disagree on an examinable fact: it is the exam board and sets the questions. State the BBKA answer plainly in the sheet. Do not copy an old bullet that asked the reader to check which source to quote, and do not present two competing answers as equally acceptable.

Time-sensitive facts are current at the date you write the sheet, not "volatile" and not "to re-check before the exam". Put one line under the title: `**Currency:** Time-sensitive facts in this sheet are current at <full date>.` Replace any old re-check instruction with that line, keeping the underlying fact. If nothing is time-sensitive, omit the line.

### 3. Write the two blocks

**Be certain.** The old "Be 100% sure" list, kept as a list of short, self-contained bullets. Every fact must already appear in the notes. Values in **bold**, no new explanations, at most about 25 words per bullet. Follow the order of the narrative so the sheet reads as depth and summary of the same material. Do not turn it into prose.

**Traps.** The old traps section, or the wrong turns implied by the notes. Each trap carries three things: the wrong answer, the right answer, and the reason the wrong one is tempting. Use the pattern below. A trap without a reason is not learnable.

Never include cover-and-recall questions, a narrative, a volatile-facts section, past-paper references, mark allocations, "most examinable" framing, or any scaffolding that talks about the scaffolding.

### 4. Add a labelled diagram where the item has one

Read `Revision-Image-Standard.md` in the study-plan repository before creating or editing any file that carries visual material. Use official BBKA or NBU sources only, from the module's shared `images/` folder, creating that folder and `PROVENANCE.md` from the standard's template if they are missing. Never substitute a web image or generate one. A condensed sheet should carry at most one or two images, placed immediately after the bullet or block they support, so the sheet stays drillable.

Prefer a `_labelled` image. Where the only official figure has parts marked A, B, C and so on, use the `_lettered` image and put the legend directly beneath it:

```markdown
![Honey bee mouthparts with parts marked](images/Mod1_Bee_Mouthparts_lettered.png)
*A: labrum, B: mandible, C: maxilla.*
```

Verify every legend name against the notes file and an official source. Keep captions free of paper dates, sittings and question numbers; record provenance in `images/PROVENANCE.md`, creating it from the standard's template if missing. If the notes file has no diagram and no suitable official one exists, omit the image rather than sourcing or generating one elsewhere.

## Document template

```markdown
# Module <n> · Item <x.y> · <the full syllabus wording of the item>

**Currency:** Time-sensitive facts in this sheet are current at <full date>.

## Be certain

- <condensed fact, values in bold>
- <condensed fact>

## Traps

- **Trap:** <the wrong answer> → **Correct:** <the right answer>, because <reason>.

![<Diagram supporting this item>](images/Mod<n>_<Topic>_labelled.png)
*<Short caption, or A: label, B: label when the source is lettered>*
```

Use the same full syllabus title as the notes file, verified against the module syllabus PDF. Omit the currency line where there are no time-sensitive facts. Adapt the number of bullets to the item; a narrow item may need only three or four, a broad one twenty or more.

## Saving

Save beside the notes file as:

```
Mod<n>_Item_<item number>_revision-notes.md
```

Do not overwrite an existing file without saying so. For a batch conversion, one sheet per syllabus item is the expected shape.

## Language and style

British English, Oxford comma, scientific binomials italicised in markdown, values in bold, ranges written "5 to 8" rather than "5-8". No en dashes or em dashes anywhere. The trap arrow is `→` and is the only special character needed.

## Quality checklist before finishing

- Exactly one syllabus item is covered, with the full syllabus wording in the title.
- Every bullet is already supported by the notes file; nothing new has been introduced.
- The Be certain block is short bullets, not prose, with values in bold.
- Every trap gives the wrong answer, the right answer and the reason.
- Any diagram is a labelled official image, or a lettered image with a verified legend directly beneath it, and its source is recorded in `images/PROVENANCE.md`, creating that file from the standard's template if it was missing.
- Every image path resolves from the module folder and the sheet stays short enough to drill.
- Where sources disagree, the BBKA answer is taught as the answer.
- Time-sensitive facts carry one `current at <date>` line, with no "volatile" or "re-check before the exam" wording.
- No narrative, no cover-and-recall questions, no volatile-facts section.
- No paper dates, question numbers, mark allocations or exam-weighting language.
- British English, no en dashes or em dashes.
