---
name: exam-revision-review
description: Build a syllabus-mapped revision recap with a self-testing Q&A for a BBKA written examination module or a named section of one, saved as a markdown file the user can return to. Use when the user asks to revise, recap, review or prepare for a BBKA Module 1, 2, 3 or other exam sitting, asks for a revision session, revision notes, a study recap, a topic summary, a Q&A to test comprehension, or asks to cover a particular section such as foulbrood, varroa, invasive species, honey constituents, forage, pollination, honey granulation, beeswax, poisoning or legislation. Also use when the user names a study block, a week of the study plan, or a past paper question they want covered.
---

## When to use

Use this skill whenever the user wants revision material prepared for an examination, rather than answering a specific question about beekeeping. That covers:

- "help me revise for Module 3", "prepare a revision session on X", "recap X for me"
- "make me revision notes on Y", "summarise the syllabus section on Z"
- "test my understanding of X", "quiz me on Y", "give me a Q&A on X"
- "I have my exam in November, where should I start?"

Do not use this skill for a single factual question ("what is the causative organism of EFB?"). Answer that directly.

If the user already has a recap file and wants changes to it, edit that file in place rather than rebuilding it, unless they ask for a fresh pass.

## When to use the companion skill

This skill produces the review document. An Anki deck is a separate deliverable with a separate skill, because the user reviews cards daily over weeks and may want to regenerate them without regenerating the recap.

**Always ask at the start of the session whether an Anki deck should be prepared.** If the user says yes, invoke the `exam-revision-anki-deck` skill once the recap file is written, and pass it the recap file path. If they say no, or "later", finish the recap and mention that the deck skill can be run against the saved file at any time.

## What to do

### 1. Establish scope by asking, not by assuming

Ask for, in one message using the question tool where possible:

- **Which exam and module.** Module 1, 2, 3, or another examination such as a Basic or Intermediate assessment. Confirm the sitting date, since that determines which facts go stale and how soon the recap will.
- **Which section or topic.** Offer a menu drawn from the actual syllabus in the repository, not a generic list.
- **How deep.** A full syllabus-mapped recap, a rapid refresher, or a Q&A only.
- **Whether an Anki deck should be prepared.**

If the user has already named a topic and asked for a full treatment, do not interrogate them further. Confirm the deck question and proceed.

### 2. Read the source material

Work from the repository. Do not rely on memory for the recap.

- **Syllabus.** Find the current module syllabus PDF in the module's folder (its filename changes with each sitting, so search rather than assume a fixed name, for example `find "Module Prep/Module 3" -iname "*yllabus*.pdf"`), then read it and extract the numbered items so the recap can be mapped to them. `pdftotext -layout "<the file you found>" /tmp/mod<n>.txt` works well.
- **The item notes in the module folder.** These are the substance. The recap is built from them, so that the notes carry the explanation and the recap carries the recall.
- **Past papers.** Extract every paper for the module in `Past Exams/MODULE n/` and work out what has been examined. **This is for your own preparation, not for the document.** It tells you which facts are safe, which phrasings the examiner prefers, and which self-test questions will be realistic. It does not appear in the recap, except in the evidence table at the end (see below).
- **Reading list.** Check the current module reading list PDF (search the module's folder for a filename containing "Reading List") so the recap can point at the right textbook chapters.

### 3. Verify anything that can go stale

Some syllabus areas are frozen (the biology of a life cycle) and some are live (regulations, import suspensions, outbreak figures, resistance status). Live areas are where confidence is misplaced, because the answer may have changed since the model last saw it.

Identify these before writing, then confirm each against the primary source:

- Legislation, statutory instruments, amendment dates, notification duties
- Current import restrictions and safeguard measures
- Outbreak and sighting figures, and any change in diagnostic policy
- Approved veterinary medicines, and the resistance status of varroacides
- Any syllabus or paper format change announced for the target sitting

Prefer primary sources: `gov.uk`, `legislation.gov.uk`, `nationalbeeunit.com`, the FAO or WOAH site for international status, and the `dev.defra.gov.uk` or `planthealth.blog` pages. Collect them into a closing "Volatile facts to re-verify before [date]" section listing exactly which facts to re-check in the final week, with the source to check each against.

If a primary source cannot be reached (no network access, the site is down, the page has moved), do not fall back on memorised knowledge and present it as checked. Include the fact only if it is still worth including, mark it plainly in the volatile section as "not verified this session" rather than giving it a source citation, and say so in your reply so the user knows which facts still need a human check before relying on them.

### 4. Structure the recap

The recap is a **recall tool**, not a second set of notes. The notes carry the explanation; the recap carries the tables, lists and skeletons that can be reconstructed from memory. Follow this shape:

- **Title, then straight into the syllabus coverage table.** No introductory paragraph, no "revision recap for the November sitting" line, no list of primary sources. The table is the first thing in the document.
- **Syllabus coverage, always as a table, never as prose.** A table with the columns Item, Requirement and Section below (or Where covered). Quote or closely paraphrase each syllabus item and point at the numbered part of the recap that answers it. A topic that maps to a single item still gets a table, even with one row. Note any nearby items deliberately left out, so a gap reads as a decision rather than an oversight. **This table holds no information that is not in the body of the recap**, so it can be checked off item by item.
- **A cover-and-recall block** after the coverage table: the three to five questions that, answered cold, mean the block is known. One line of instruction, then the questions.
- **The recap itself: tables and lists, not prose.** This is the defining rule. Set the material out as tables, numbered lists and short bulleted skeletons. Where a set of facts only makes sense as a running account, and compressing it would lose something the reader needs, give **brief narrative** as well, but narrative is the exception, not the default. A good test: if a reader can reconstruct the answer from the table alone, the narrative is padding.
- **Organise by syllabus item, not by textbook chapter.** Number the blocks so the reader can tick them off against the syllabus.
- **Show the look-alikes and discriminators explicitly.** A table of discriminators is worth more than a paragraph of description: small hive beetle against wax moth, *Tropilaelaps* against *Varroa*, *Vespa velutina* against *Vespa crabro*, *Nosema ceranae* against *Nosema apis*, and so on.
- **Give the numbers.** Sizes, dates, percentages, temperatures, durations, counts and thresholds, in **bold**.
- **State the UK context**, not just the general biology. The reader is examined on UK law, UK import conditions and the UK apiculture programme.
- **Self-test questions and model answers.** Three tiers by mark band, labelled by the band rather than by the paper's sections: one-mark questions, short-answer questions of 2 to 15 marks, and long-answer questions of about 30 marks. Keep the mark allocation next to each question, because it tells the reader how much to write. Put the answers in HTML `<details>` blocks so the reader can attempt each question before reading the answer.
- **Close with a short "take away"** of three or four points, being the things most likely to be lost under pressure.
- **The past paper evidence table goes at the bottom**, as an appendix, after the take away. Columns Paper, Question, Marks, Topic and Item. No commentary around it, and no paragraphs about command words or about which items overlapped in which paper.

Length: a substantial section of the syllabus justifies a substantial document, typically 300 to 600 lines. Do not pad a narrow topic out artificially, and do not truncate a broad one to the point that it is not examinable.

### 4a. Write the recap from the item notes, and check it back against them

The item notes carry the researched material; the recap carries the recall skeleton. So:

- **Every fact in the recap must be in the notes.** A fact that appears only in the recap has
  not been taught, cannot be checked, and will be half-remembered.
- **Everything the notes teach that matters must be in the recap**, especially a figure, a
  threshold, a named list, a legal reference, a sequence step or a discriminator.
- **Where a note marks something uncertain**, with "not certain" or "unverified", the recap
  must carry the same marking or not state the claim. Never assert a doubtful fact as settled.
- **The notes are the authority for the recap, but check the notes too.** Do not verify a
  figure against the recap, because material drifts consistently across a notes file, its
  recap and its deck, and all three can be wrong together. Compare numbers literally rather
  than by eye: dates, temperatures, percentages, dosages, durations, distances, counts,
  thresholds, legal citations and product names are the highest-risk items.
- Primary sources for checking a note as well as a recap: the NBU advisory leaflets and fact
  sheets on nationalbeeunit.com, legislation.gov.uk for statutory instruments, the VMD product
  information database for authorised medicines, and the National Honey Show's current
  schedule for show specifications.

### 5. Never refer to past exam questions in the body of the recap

The body of the recap must contain:

- no paper dates or sittings ("March 2024", "across five papers")
- no question numbers, in headings or anywhere else ("Q17(a)", "the November 2025 Q12")
- no "asked twice", "most repeated", "highest-value" or "worth knowing" framing
- no commentary about which questions were paired, which command words were used, or how the marks were distributed

The evidence table at the bottom is the one deliberate exception, and it is an appendix rather than part of the material.

**Where this bites hardest:** section headings. A heading such as "The five uncapping methods (March 2024 Q11(a), March 2026 Q11(a))" becomes "The five uncapping methods". And self-test questions keep their mark allocations but lose the citation, so they read "Describe the signs of pesticide poisoning in an apiary. (6 marks)".

Choosing the self-test questions **is** where knowledge of past papers earns its keep: pick questions the examiner has actually asked, because they are reliable proxies for the real thing. Keep that judgement out of the document itself, since it must not read as exam-weighted, but say in your reply, briefly, that self-test coverage is weighted toward what has actually been examined rather than spread evenly across the syllabus, so the user knows not to treat it as a representative sample of the whole item.

### 6. Save the file

Write to the module prep folder for the module in question, `Module Prep/Module 1/`, `2/`, `3/`, `5/`, `6/` or `7/`. Naming convention, which the user relies on to find these later:

```
Mod<n>_<SectionLetter>_<Topic>_recap.md
```

Where a module has been split into lettered blocks, use the block letter: `Mod3_A_Foulbrood_recap.md`. For a topic not yet assigned a block letter, omit the letter. Use underscores between words and Title Case for the topic. Do not overwrite an existing recap without saying so.

### 7. Language and style

British English throughout, including scientific and common names of organisms. Use the Oxford comma in lists. Never use en dashes or em dashes; use commas, colons, semicolons, parentheses or full stops. Italicise scientific binomials in markdown. Use "syllabus item" or "syllabus point" for the numbered entries, and give the numbers.

## Quality checklist before finishing

- Every subsection maps to a named syllabus item number.
- The document opens with the title and then the syllabus coverage table; nothing else precedes it.
- The coverage table has the items, the requirements and where each is covered, and holds no information absent from the body.
- A cover-and-recall block follows the coverage table.
- The body is tables, lists and skeletons; any narrative is short and earns its place.
- The past paper evidence table is at the bottom, with no commentary attached to it.
- Every live fact is either verified this session against a primary source, or explicitly marked in the volatile section as not verified this session, with that distinction stated in the reply. None are silently presented as checked when they were only recalled.
- Lists are numbered where the count matters.
- Numbers appear in bold.
- Discriminators between similar species or diseases are in tables.
- Self-test questions and model answers are present, in `<details>` blocks, with mark allocations.
- A "Take away" section is present.
- No paper dates, question numbers or exam-weighting language anywhere in the body.
- No en dashes or em dashes anywhere in the file.
