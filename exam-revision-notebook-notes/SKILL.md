---
name: exam-revision-notebook-notes
description: Produce notebook-ready revision notes for one specific BBKA syllabus item, with a narrative that explains the material, a condensed "be 100% sure" summary, traps and volatile facts, so the user can copy it by hand and still recall it weeks later. Use when the user names a syllabus item or a narrow exam topic to revise, for example "3.10 the statutory requirements and guidance relating to the Asian Hornet", "syllabus item 3.27", "revise 2.14 honey spoilage", or "notes on Nosema ceranae". Also use when the user asks for notebook notes, copyable bullets, something to write out by hand, mnemonics or memory tricks for a list, or a condensed summary of a single syllabus point rather than a full recap.
---

## When to use

Use this skill when the user has identified **one specific syllabus item** or a narrow topic and wants notes they can read, study from and copy into a notebook. The trigger is a syllabus number, a quoted syllabus sentence, or a named topic.

This is the third of three revision skills, and the choice between them matters:

| The user wants | Use |
|---|---|
| Notebook-ready notes for one syllabus item | **this skill** |
| A full syllabus-mapped recap with a Q&A, a whole block of the syllabus | `exam-revision-review` |
| A drillable card deck in TSV | `exam-revision-anki-deck` |

This skill's output feeds the other two: the saved notes file can be handed to `exam-revision-anki-deck` to generate cards, and the recap for a block is built from these notes. Say so at the end, briefly, rather than making them ask.

**Guard against scope mismatch.** If the user names a range covering much of a module, such as "3.13 to 3.17 varroa" or "all of Module 2", this is the wrong tool. Suggest `exam-revision-review` for the block first, then offer to run this skill on the highest-yield items inside it.

## Do not interrogate

The user will arrive with a specific item. Do not open with a questionnaire. Ask only if the item is genuinely ambiguous, and otherwise proceed directly.

## The learning model this serves

Design decisions below all follow from how the user actually studies, so do not "improve" on them without reason:

- **They are learning the subject, not just the exam.** Passing is a happy side effect. The notes must teach the material as it stands on its own, and must never be shaped by what has been examined. Coverage of the past papers is the author's business, not the reader's.
- **They re-read later, and think about why, when and how the note was written.** So every fact has to earn its place on its own merits, and re-reading has to be an active recall event rather than comfortable recognition.
- **They want certainty, not coverage.** A short list they are certain of beats a long one they half know.
- **They dislike scaffolding that talks about the scaffolding.** Preambles such as "why this is here" pull attention away from the material, so leave them out.

## What to do

### 1. Pin the syllabus item and read the whole of it

Find the current module syllabus PDF in the module's folder first (its filename changes with each sitting, so search rather than assume a fixed name, for example `find "Module Prep/Module 3" -iname "*yllabus*.pdf"`), then read it to get the exact item number and its exact wording:

```bash
pdftotext -layout "<the file you found>" /tmp/mod<n>.txt
```

The wording tells you the breadth required. "Give a detailed account of" and "including" are instructions about how much to cover, and the notes must cover all of it, not only the part that has been examined.

### 2. Read the syllabus verb, and let it set the recall type

| Syllabus verb | What is required | What to do |
|---|---|---|
| List, name, state, give | A specific set or a single fact | **Set out exactly.** A numbered list, and the structure that gives it shape. |
| Describe, give an account of | A narrative with detail | **Narrative, then the numbered component facts** so the shape survives. |
| Summarise, outline | Main points, concise | **Headings and a skeleton**, not detail. |
| Explain, state why, state how | Reasoning and mechanism | **Narrative in section 1**, and keep it out of the memorise list. |
| Identify, recognise, distinguish | Discriminators | **Set them out in a table**, side by side. |

### 3. Write section 1 as narrative, then give the recallable material as a table or a list

The single most important formatting rule. Section 1 reads as **well-formed prose that explains the material**, in the order a competent writer would explain it: what the thing is, how it works, why it matters, where the exceptions lie. Do not write section 1 as a bullet list of facts; that is what section 2 is for.

Where a group of material has to be recalled exactly, put it in a table or a numbered list immediately after the narrative that introduces it. That applies to: fixed sets and counts, sequences and life cycles, procedures and steps in order, hard values (dates, percentages, temperatures, sizes, durations, thresholds, counts), comparisons between two similar things, and anything with a discriminator.

Never let the tables and lists replace the explanation. The narrative is what makes the tables make sense, and it is what the reader will understand the material from if the tables fade.

Length: a syllabus item normally runs to **120 to 250 lines** of markdown. Longer where the item is broad (a life cycle, a piece of legislation, a disease), shorter where it is narrow.

### 4. Handle lists properly: structure first, mnemonic second

For every list of four or more items, and for every set the reader will need to recall as a whole, the notes must supply **both**:

- **A structure.** The reason a list is the shape it is. Chronological (a life cycle runs in time), functional (groups by what it does), spatial (position in the hive, or on the bee), or by classification (what kind of thing it is). Name the structure explicitly, for example "these run in time, not in order of importance". A table whose rows are groups of two or three is itself a structure and often the best one.
- **A mnemonic.** Only if one genuinely works, and in the narrative, never as an aside bolted onto a list.

**Prefer the structure.** A mnemonic is a scaffold for a list you have already organised, not a substitute for organising it. A list recalled as three named groups is more durable than eight items strung on an acronym, and it survives when the acronym does not.

**Do not force bad mnemonics.** A weak mnemonic is worse than none, because it produces false confidence and the collapse is discovered later. If a natural mnemonic does not exist, write the structure instead and say plainly that you have not found a good hook for it.

**Put the count in the list itself** where the number of items matters, because knowing you need five and recalling three is a common way to lose the point.

### 5. Section 2 summarises section 1 and adds nothing

Section 2 is the condensed, copyable answer to "what must I know cold?". Every fact in it appears in section 1; if something is in section 2 and not in section 1, either put it in section 1 or cut it from section 2. Write it as bullets, numbered lists and small tables, with at most a one-line lead-in per block. No prose paragraphs.

Order section 2 to follow section 1, so the two read as depth and summary of the same material.

### 6. Keep traps and volatile facts as their own sections

- **Traps.** The classic wrong answers, and the intuitive answer that is wrong. Each trap gets the wrong answer, the right answer, and the reason, because a trap without a reason is not learnable. Keep this section; it is where marks are actually lost.
- **Volatile facts.** Regulations, outbreak figures, import suspensions, approved medicines, product names and resistance status all change without notice. Collect the ones in this item with a re-check date. If there are none, say so in one line rather than leaving an empty section.

### 7. Never refer to past exam questions in the notes

The notes are about the material. They must contain:

- no paper dates or sittings ("November 2025", "set twice")
- no question numbers ("Q12(c)")
- no mark allocations ("5 marks", "Section B")
- no "asked in", "most examinable", "highest value" or "worth knowing" framing
- no study-plan references ("week 2 of the plan asks you to...")

Where a fact was taken from a past paper, it is still a fact, and it is still written. The paper is simply not mentioned.

The corollary: **section 1 must cover the whole syllabus item**, including the parts that have never been examined. Those parts often deserve the most attention precisely because they have not been drilled.

### 8. Save the file

To the module prep folder for the module in question, `Module Prep/Module 3/` or `Module Prep/Module 2/`:

```
Mod<n>_Item_<item number>_notes.md
```

So `Mod3_Item_3_10_notes.md` for item 3.10. Use underscores between words and Title Case for the topic. Do not overwrite without saying so.

## Document template

Use this shape. Adapt the number of section 1 blocks to the item, but keep all five headings present, because each one does a job in the reader's revision process.

```markdown
# Module <n> · Item <x.y> · <the full syllabus wording of the item>

## Cover and recall

Answer these <three or four> cold, before you read anything below.

1. <question, phrased the way the material is normally asked>
2. <question>
3. <question>

## 1. <The topic>

<narrative paragraphs explaining the material>

| <Comparison or set, when one is needed> | |
|---|---|
| | |

1. <Numbered list, when the set or sequence has to be recalled exactly>
2. 

## 2. Be 100% sure

- <condensed fact, values in bold>
- <condensed fact>

## 3. Traps

- **Trap:** <the wrong answer> → **Correct:** <the right answer, and why>

## 4. Volatile facts, re-check before <exam date>

- <fact> (<source>)
```

Nothing goes between the title and the cover-and-recall block. In particular there is no exam evidence block, no certainty target, no verification line, no provenance table and no "my own hooks" section: the cover-and-recall block does the first job, the structure of section 1 does the second, and the other three have been dropped by request.

**The title carries the full syllabus wording, verbatim.** Never a shortened or paraphrased form. Extract the item from the syllabus PDF, capitalise the first letter, drop the trailing full stop, italicise the binomial names and replace any en dash with a colon. "The spoilage of honey, particularly by fermentation" is wrong for item 2.13; the full wording includes "(including the effect of water content, storage temperature and the presence of yeast)", which tells the reader the scope of the item.

## Verify facts against a primary source

Do not check a fact against another file in the repository, because material drifts consistently across a notes file, its recap and its deck. All three can be wrong together, and in this project they were. Check against:

- the **module syllabus PDF**, for the item's scope;
- the **NBU advisory leaflets and fact sheets** on nationalbeeunit.com, for disease, hive and legal guidance;
- **legislation.gov.uk**, for statutory instruments, article numbers and amendment histories;
- the **VMD product information database**, for authorised medicines, actives and directions;
- the **National Honey Show's current schedule of competitive classes**, for every show specification;
- the relevant **textbook**, where no primary source exists.

Where a claim cannot be settled, **keep it and mark it** rather than deleting it, because it is widely taught and may well be credited. Mark it in the prose, add a bullet to section 4, and say so in your report. The word "unverified" in a note is doing useful work, not admitting defeat.

## Quality checklist before finishing

- Exactly one syllabus item is covered.
- The title carries the **full** syllabus wording, verified word by word against the syllabus PDF, not a condensed form.
- Every fact checked against a primary source, or marked uncertain with a section 4 bullet.
- A cover-and-recall block of three or four questions comes before section 1.
- Section 1 is narrative: prose paragraphs that explain the material, with tables or numbered lists where recall needs them. Not a bullet list of facts.
- Section 1 covers the whole syllabus item, including anything never examined.
- Section 2 summarises section 1 and introduces nothing new.
- Every list of four or more items has a stated structure, and a mnemonic only where one genuinely works.
- Section 2 bullets are self-contained and about 25 words or fewer, one line each.
- Values are bold and unambiguous, with no hyphens standing in for ranges: write "5 to 8", not "5-8".
- Traps each carry the wrong answer, the right answer, and the reason.
- Volatile facts are collected with a re-check date, or the section says there are none.
- No paper dates, question numbers, mark allocations or exam-weighting language anywhere in the file.
- No "why this is here" or similar preamble before any block.
- British English, Oxford comma, scientific binomials italicised in markdown.
- No en dashes or em dashes anywhere.

## Language and style

British English, Oxford commas, no en dashes or em dashes. Scientific binomials italicised in markdown. Favour well-formed prose over fragments in section 1, because it is written to be read and understood rather than parsed. Prefer the term the subject uses to the term that is merely correct.
