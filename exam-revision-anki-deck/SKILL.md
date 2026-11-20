---
name: exam-revision-anki-deck
description: Convert a BBKA revision recap or a named exam section into an Anki deck in TSV format, using single-point questions only, including "name one ..." cards but no list, enumeration or essay-assembly cards, with single-point cards from lettered past-paper diagrams where relevant. Use when the user asks for an Anki deck, flashcards or a revision deck for a BBKA module or topic, wants a recap turned into cards, asks for a TSV to import into Anki, or wants a deck built from a saved recap file such as Mod3_B_Invasive_Species_recap.md. Also use when the user wants a deck for a section named directly, for example "make me cards on chalkbrood" or "Anki cards for honey constituents".
---

## When to use

Use this skill whenever the user wants revision material in a form they can drill, rather than read. That covers:

- "make me an Anki deck", "build me flashcards", "turn this into cards"
- "Anki cards for X", "make a deck on X"
- "I have a recap file, make a deck from it"
- "I need a TSV to import"

This skill is deliberately separate from `exam-revision-review`. The recap is read once; the deck is reviewed daily for weeks. The user will often want to regenerate the cards without regenerating the recap, or to build a deck for a topic they have not yet had a recap for. Either skill can be used on its own.

Read `Revision-Output-Standard.md` in the study-plan repository before a batch.

## Inputs

Establish which of these you are working from, asking only if it is not already clear from the conversation:

- **An existing recap file.** The normal case. Read the file, and treat its content as the source of truth. Do not re-research the topic, though do correct anything you know to be wrong, and say so if you do.
- **A named topic with no recap file.** In that case research it directly before writing cards: find the current module syllabus PDF in the module's folder (its filename changes with each sitting, so search rather than assume a fixed name, for example `find "Module Prep/Module 3" -iname "*yllabus*.pdf"`) and extract the relevant items, and check past papers for the module in `Past Exams/MODULE n/` for realistic phrasing and coverage, so the cards are accurate and examinable. Offering to run `exam-revision-review` first and build the deck from its recap instead is also reasonable and lets the user choose, but is not required.
- **A past paper the user wants carded.** Possible, but warn them that cards built from a single paper under-cover the syllabus.

## Card design: single-point questions only

Every card must be answerable with **one point of knowledge**. There are no list cards, no enumeration cards, no "state the four signs" cards and no essay assembly cards.

Allowed shapes:

- **A single fact.** One name, one number, one date, one causal link, one identification feature, one legal reference. This is the default.
- **"Name one ..." cards.** Where an exam answer accepts any one item from a set, ask for one item and give one item as the answer. "Name one uncapping tool" with "A heated uncapping knife" is good. "Name one potential source of poisoning in an apiary" with "Sprayed forage" is good. If two alternative answers are genuinely interchangeable, write one on the back and keep the other as a separate card only if its front can be made distinct.

Not allowed:

- A front containing "list", "state the names of", "give four", "what are the steps", "describe the process" or anything requiring more than one item.
- A back containing a numbered list, semicolon-separated enumeration, or a paragraph of component facts. One back equals one answer.
- An assembly card that tries to reconstruct a 15 or 30 mark answer. Break that material into many single-point cards instead and leave the shape of the whole answer to the recap and the marp deck.

### Other rules

1. **Never write a card the user can only answer by recognising a pattern.** Use the module's own vocabulary and, where the papers supply it, the exam's phrasing. A weak front such as "What are the measures to minimise the effects of Asian hornets?" invites recognition; "Name one measure a beekeeper can take to minimise the effects of Asian hornets" asks for one recallable item.
2. **Make hard values unmissable.** Dates, percentages, durations, temperatures, sizes, counts, instrument citations and legal section numbers go in the answer in a form the user cannot fudge. Write "21 April 2021", and write "about 5 to 8" rather than "5-8".
3. **One fact per card.** If a source paragraph holds five facts, write five cards. The only exception is a "Name one" prompt, whose answer is still one item.
4. **Do not hint inside the answer.** No "the answer is X because...", no bracketed asides, no "think of the 2021 amendment". The back is what the user must produce. Explain elsewhere if the user asks.
5. **Fronts should be phrased the way the subject phrases things.** Prefer "list", "state", "name", "describe", "summarise", "explain" only where one fact can satisfy them. "State the diagnostic sign", "Name one approved varroacide", "Give the temperature" all work. "List the signs" does not.
6. **No card text may reference a past paper.** No paper dates or sittings, no question numbers, no mark allocations, and no "asked in", "most examinable" or "worth knowing" framing, in either the front or the back. A fact taken from a paper is still a fact: write the fact and leave the paper out. Exam-derived material is carried by the `PastPaper` tag.
7. **The BBKA wins.** Where a BBKA source and another source disagree on an examinable fact, the card teaches the BBKA answer. Never write a card asking the user to choose between versions, and never include a competing answer on the back.
8. **Date what moves.** Facts such as outbreak figures, import suspensions, product authorisations and resistance status are current at the date you write the deck. Do not tag or describe them as `Volatile` or "to re-check before the exam". Give them a `Current_YYYY_MM_DD` tag with the full date, for example `Current_2026_11_17`, and say in your reply that those facts are current at that date.

## Diagram cards from past papers

Images are available in free Anki. Anki Desktop for Windows, macOS and Linux, AnkiWeb and AnkiDroid all support images in cards; the only paid official client is AnkiMobile for iPhone and iPad, and it supports images too. The constraint is the text import format, not the price.

Use diagrams only from official BBKA past papers, and only where the parts are marked with letters such as A, B, C and so on. Do not use labelled diagrams, photographs, generic web images or AI-generated figures. Read `Revision-Image-Standard.md` in the study-plan repository first, keep the source file in the module's shared `images/` folder with a `_lettered` suffix, and add its provenance row.

Each diagram card is still a single-point question:

- Front: the image plus one question about one letter, for example `What is the part labelled B?`, with `<img src="Mod1_Apple_Blossom_lettered.png">` in the same field.
- Back: one name, for example `Filament`. Never a list of A to K.
- Use a separate card per letter where the whole figure is worth drilling. A diagram with parts A to K can yield up to eleven cards, each asking about one part.
- Do not put the legend on the front. Put the names only on the backs, one per card, so the card tests recall rather than recognition of a key.
- Keep the usual no-paper-reference rule: no paper dates, question numbers or mark allocations in the front or back. The `PastPaper` tag carries the provenance.

## TSV format

Four tab separated fields per line, one card per line, under four import header lines:

```
#separator:Tab
#html:false
#tags column:3
#deck column:4
Front<TAB>Back<TAB>Tags<TAB>BBKA Module 3
```

The header lines are mandatory, because without them Anki ignores the file's structure and the user has to fix the mapping by hand every time:

- `#tags column:3` makes Anki read column 3 as tags. Without it the tags land in a field or are dropped.
- `#deck column:4` makes Anki read column 4 as the deck for that note, and **creates the deck if it does not exist**. This is the only header that creates a deck: a plain `#deck:BBKA Module 3` line merely presets the deck if it happens to exist already, and otherwise the cards fall into whatever the import dialog says, which is `Default`.
- `#html:false` keeps plain text as plain text for a deck with no images. A deck that carries any diagram card must change this line to `#html:true`, or Anki will print the `<img>` tag as text instead of showing the picture. Keep every other field free of angle brackets and ampersands when using `#html:true`.
- `#separator:Tab` is the default, but stating it removes any doubt about what is separating the fields.

Column 4 repeats the deck name on every row, which is what makes the deck get created. The deck name is `BBKA Module <n>`, one deck per module, so the user selects a module to study and filters within it by tag.

Hard requirements, because breaking any of them corrupts the import:

- **Exactly four tab separated fields per line, after the four header lines.** Verify this before finishing.
- **No tab characters inside any field.** Use commas or "or" for internal separation.
- **No newlines inside any field.** Every card is a single line.
- **No empty fields.**
- **No CSV wrapping or surrounding quotes.** Quotes are allowed only inside the `<img src="...">` tag on diagram cards. Anki's TSV importer treats other quotes literally.
- **UTF-8, no byte order mark.**
- **Plain text in the fields, apart from the `<img src="...">` tag on diagram cards.** Do not wrap scientific names in asterisks: Anki will not render markdown by default, so they will display as stray asterisks. Write `Varroa destructor` in plain text and tell the user, once, that italics can be restored by adding `em { font-style: italic; }` to their card template CSS.

The reliable way to author this file is to write it with a single distinctive placeholder character in place of the tabs, for example `@`, including the header lines and the deck column. Before converting, confirm the placeholder does not already appear anywhere in the content:

```bash
grep -c '@' deck.tsv
```

Expect `0`. If it is not, choose a different placeholder that genuinely does not appear in the content, then convert:

```bash
tr '@' '\t' < deck.tsv > /tmp/deck.tsv && mv /tmp/deck.tsv deck.tsv
```

Verify the result:

```bash
grep -v '^#' deck.tsv | awk -F'\t' '{print NF}' | sort | uniq -c
grep -v '^#' deck.tsv | cut -f1 | sort | uniq -d
```

Expect a single field count equal to four. Duplicate fronts are acceptable only where the front deliberately asks "Name one ..." and each duplicate has a different single-item answer; every other duplicate must be fixed. Report intentional duplicates in your reply.

### Media for diagram cards

A text import does not carry the image files with it, so the media must be in place before the user imports the TSV.

1. Copy every referenced `_lettered` file from the module's `images/` folder into the Anki profile's media folder, flat and with the exact filename. On macOS this is normally `~/Library/Application Support/Anki2/<profile>/collection.media/`. Do not create subfolders there.
2. Confirm the header says `#html:true`, and that each Front field holds `<img src="filename.png">` with the plain filename only, never a path.
3. If the user has confirmed the profile path, the skill may copy the files there on their behalf. Otherwise give them the path and the exact list of files. Never guess the profile name.
4. After import, ask the user to run Tools, Check Media, and open a sample card. Report any missing files in the handback.

## Tagging

Tags are space separated, giving a hierarchy the user can filter on later. Base every card in a module deck on the module and the topic block:

```
Mod3 Invasive AsianHornet
Mod3 Invasive SHB
Mod3 Invasive Tropilaelaps
Mod3 Invasive Varroa
Mod3 Invasive Legislation
Mod3 Invasive Imports
Mod3 Invasive Reporting
Mod3 PastPaper
```

Conventions worth keeping stable across every deck the user builds:

- Module first (`Mod2`, `Mod3`), so the whole module can be selected.
- Topic block second, as one token (`AsianHornet`, not `Asian Hornet`, so it stays a single tag).
- Add `PastPaper` to any card built from a real past paper question, so exam-derived cards are separable from first-principles ones. Existing decks keep their tags when card text is edited; never remove a `PastPaper` tag as part of a text cleanup.
- Add `Current_YYYY_MM_DD` to any card holding a fact that changes, using the date the deck was written. Say in your reply which cards carry it and that those facts are current at that date, not that they must be re-checked before the exam.

## Card count

A useful rule of thumb, and the one the user is working to: 200 to 300 cards per module by exam day. A single syllabus section justifies roughly 80 to 130 cards. Below about 60 for a full section the deck is probably under-covering; above 150 it is probably making cards out of prose. Because lists have been replaced by single-point cards, a block may need more cards than before: this is expected. If a topic is genuinely enormous, say so and offer to split the deck.

## Saving and reporting

Save to the module prep folder for the module in question, next to the recap it came from:

```
Mod<n>_<SectionLetter>_<Topic>_anki.tsv
```

Where a module has been split into lettered blocks, use the recap's section letter and stem, so the deck takes the recap's stem plus `_anki`. The invasive species pair is `Mod3_B_Invasive_Species_recap.md` and `Mod3_B_Invasive_Species_anki.tsv`. For a topic with no block letter, or a module with no block scheme, omit the letter. Do not overwrite an existing deck without saying so.

In your reply, give the user:

- The file path and the card count.
- The deck name the cards will land in, and the fact that Anki creates it on import.
- The tag breakdown, so they can see the coverage.
- A note that Anki's "Allow HTML in fields" does not matter for a plain-text deck, since `#html:false` says so in the file, and that a deck with diagram cards uses `#html:true` instead.
- If the deck contains diagram cards, the exact media files to place in `collection.media`, the profile path used or supplied, and the reminder to run Tools, Check Media after import.
- The one-off italics tip, if the deck contains scientific names.
- Any time-sensitive cards, called out by `Current_YYYY_MM_DD` tag, with the date those facts are current at.
- Any intentional duplicate "Name one" fronts.

## Language and style

British English, Oxford commas, no en dashes or em dashes, even inside card text, since the cards are read aloud from a phone. Write dates, numbers and lists the way a marker would expect to read them, but never put a list on a card back.

## Quality checklist before finishing

- Every card is a single-point question: one fact, or a "Name one ..." question with one answer on the back.
- No list cards, no enumeration cards, no essay assembly cards, no numbered backs.
- No card's front can be answered without producing the specific content.
- No card's back is a paragraph of unrelated facts.
- Exactly four tab separated fields on every line after the header lines, verified with `awk`.
- The four import header lines are present, in order, with `#tags column:3` and `#deck column:4`.
- Column 4 holds `BBKA Module <n>` on every row, so Anki creates the deck rather than dropping the cards into `Default`.
- Duplicate fronts are either absent or intentional "Name one" prompts with different single answers, verified with `cut` and `uniq -d`.
- No tabs or newlines inside fields, no markdown asterisks, no BOM, and no quotes outside the `<img src="...">` tag on diagram cards.
- Every card tagged with module and topic block, exam-derived cards tagged `PastPaper`, time-sensitive cards tagged `Current_YYYY_MM_DD`.
- No card text cites a paper, a sitting, a question number or a mark allocation.
- Any diagram cards use official BBKA lettered past-paper figures, one letter per card, with one name on the back and no legend on the front.
- A deck with diagram cards uses `#html:true`, and every referenced media file is copied flat into `collection.media` with the exact filename.
- Where sources disagree, the BBKA answer is the one on the card.
- Time-sensitive facts are described as current at a date, never as volatile or to re-check before the exam.
- Card count is proportionate to the size of the syllabus section.
- No en dashes or em dashes.
