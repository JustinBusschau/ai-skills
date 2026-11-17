---
name: exam-revision-anki-deck
description: Convert a BBKA revision recap or a named exam section into an Anki deck in TSV format, with cards that can be answered as a single fact or as a list of items, steps or component facts that string together into an exam answer. Use when the user asks for an Anki deck, flashcards or a revision deck for a BBKA module or topic, wants a recap turned into cards, asks for a TSV to import into Anki, or wants a deck built from a saved recap file such as Mod3_B_Invasive_Species_recap.md. Also use when the user wants a deck for a section named directly, for example "make me cards on chalkbrood" or "Anki cards for honey constituents".
---

## When to use

Use this skill whenever the user wants revision material in a form they can drill, rather than read. That covers:

- "make me an Anki deck", "build me flashcards", "turn this into cards"
- "Anki cards for X", "make a deck on X"
- "I have a recap file, make a deck from it"
- "I need a TSV to import"

This skill is deliberately separate from `exam-revision-review`. The recap is read once; the deck is reviewed daily for weeks. The user will often want to regenerate the cards without regenerating the recap, or to build a deck for a topic they have not yet had a recap for. Either skill can be used on its own.

## Inputs

Establish which of these you are working from, asking only if it is not already clear from the conversation:

- **An existing recap file.** The normal case. Read the file, and treat its content as the source of truth. Do not re-research the topic, though do correct anything you know to be wrong, and say so if you do.
- **A named topic with no recap file.** In that case research it directly before writing cards: find the current module syllabus PDF in the module's folder (its filename changes with each sitting, so search rather than assume a fixed name, for example `find "Module Prep/Module 3" -iname "*yllabus*.pdf"`) and extract the relevant items, and check past papers for the module in `Past Exams/MODULE n/` for realistic phrasing and coverage, so the cards are accurate and examinable. Do not build cards from un-researched material. Offering to run `exam-revision-review` first and build the deck from its recap instead is also reasonable and lets the user choose, but is not required, since that skill's own scoping questions and its own offer to build a deck would duplicate what this step just did.
- **A past paper the user wants carded.** Possible, but warn them that cards built from a single paper under-cover the syllabus.

## Card design rules

These rules are the whole point of the skill. A deck of vague prompts is useless in the exam, because the exam rewards precision, not recognition.

### 1. Every card must be answerable as one of three shapes

- **A single fact.** One name, one number, one date, one causal link, one identification feature. This is the default, and the majority of the deck.
- **A list, as a list.** Where the exam asks the candidate to "list" or "name several", the card front should use that verb and the back should be a numbered list. Never split a natural list of five signs into five separate cards if the exam will ask for it as a list of five: the user needs to recall the set and the count, not five isolated items. Equally, never combine two unrelated lists on one card.
- **A set of component facts that string together into a narrative.** This is the pattern for essay and Section C questions. See rule 3.

### 2. Never write a card the user can only answer by recognising a pattern

A front that begins "List five measures a beekeeper can take to minimise the effects of Asian hornets" is good, because it is a real exam question. A front that begins "What are the measures to minimise the effects of Asian hornets?" is weak, because any phrasing of the question is a valid cue. Use the actual exam wording wherever the papers supply it.

### 3. For essay-type answers, decompose rather than truncate

When the source material contains an answer to a 15 or 30 mark question, do not try to compress it into one card. Instead:

- Write **one card per component fact**, each answerable on its own, because these are what the user must actually be able to recall under pressure.
- Then write **one assembly card** whose front is the essay question and whose back is the ordered narrative, so the user can check the shape of the whole answer and see what they would have left out.

The assembly card's back should read as prose or a lightly structured narrative, not as a second list. That is deliberate: the user needs practice rendering the component facts into an answer, and a list on the back would hide the skill they are trying to build.

### 4. Make hard values unmissable

Dates, percentages, durations, temperatures, sizes, counts, instrument citations and legal section numbers go in the answer in a form the user cannot fudge. Write "21 April 2021" and "21/4/21" only if genuinely unsure of the format, but prefer one unambiguous form. Write "about 5 to 8", not "5-8", because the former is what the source says and the latter reads as a range of dates.

### 5. One fact per card, unless the fact is a list

Do not write a card whose back contains five unrelated facts just because they appeared in the same paragraph of the source. Split them. The only permitted multi-fact backs are genuine lists (signs, stages, measures, steps) and the essay assembly cards in rule 3.

### 6. Do not hint inside the answer

No "the answer is X because...", no bracketed asides, no "think of the 2021 amendment". The back is what the user must produce. Explain elsewhere if the user asks.

### 7. Fronts should be phrased the way the subject phrases things

Prefer the module's own vocabulary: "list", "state", "name", "describe", "summarise", "explain". Reusing the wording of a past paper question is a good way to find a natural phrasing, and past papers are the best source of realistic self-test prompts, but the card itself must never cite one.

**No card text may reference a past paper.** That means no paper dates or sittings, no question numbers, no mark allocations, and no "asked in", "most examinable" or "worth knowing" framing, in either the front or the back. A fact that was taken from a paper is still a fact, so write the fact and leave the paper out. Exam-derived material is carried by the `PastPaper` tag instead, which is where the user filters on it.

### 8. Keep the tags doing the weighting

Because the cards carry no exam framing, the tags are the only place the weighting can live, so they must be accurate:

- Tag `PastPaper` any card built from a real past paper question, so exam-derived cards are separable from first-principles ones. This is the most useful tag for the final fortnight, when the priority is what has actually been examined. Existing decks keep their tags when card text is edited; never remove a `PastPaper` tag as part of a text cleanup.

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
- `#deck column:4` makes Anki read column 4 as the deck for that note, and **creates the deck if it does not exist**. This is the only header that creates a deck: a plain `#deck:BBKA Module 3` line merely presets the deck if it happens to exist already, and otherwise the cards fall into whatever the import dialog says, which is `Default`. That is the bug this arrangement exists to prevent.
- `#html:false` keeps the plain text as plain text. Drop it if the deck ever carries real HTML such as `<br>`.
- `#separator:Tab` is the default, but stating it removes any doubt about what is separating the fields.

Column 4 repeats the deck name on every row, which is what makes the deck get created. The deck name is `BBKA Module <n>`, one deck per module, so the user selects a module to study and filters within it by tag.

Hard requirements, because breaking any of them corrupts the import:

- **Exactly four tab separated fields per line, after the four header lines.** Verify this before finishing.
- **No tab characters inside any field.** Use semicolons or commas for internal separation.
- **No newlines inside any field.** Every card is a single line. If an answer needs stages, put them on one line as a numbered list.
- **No empty fields.**
- **No literal tab escapes, quotes or CSV wrapping.** Plain text, no surrounding quotes. Anki's TSV importer treats quotes literally.
- **UTF-8, no byte order mark.**
- **Plain text in the fields.** Do not wrap scientific names in asterisks: Anki will not render markdown by default, so they will display as stray asterisks. Write `Varroa destructor` in plain text and tell the user, once, that italics can be restored by adding `em { font-style: italic; }` to their card template CSS.

The reliable way to author this file is to write it with a single distinctive placeholder character in place of the tabs, for example `@`, including the header lines and the deck column. Before converting, confirm the placeholder does not already appear anywhere in the content:

```bash
grep -c '@' deck.tsv
```

Expect `0`. If it is not, choose a different placeholder character that genuinely does not appear in the content, then convert:

```bash
tr '@' '\t' < deck.tsv > /tmp/deck.tsv && mv /tmp/deck.tsv deck.tsv
```

Verify the result:

```bash
grep -v '^#' deck.tsv | awk -F'\t' '{print NF}' | sort | uniq -c
grep -v '^#' deck.tsv | cut -f1 | sort | uniq -d
```

Expect a single field count equal to four, and no duplicate fronts. Fix anything that fails rather than handing over a broken file.

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

Conventions worth keeping stable across every deck the user builds, because they will be reviewing several hundred cards by November:

- Module first (`Mod2`, `Mod3`), so the whole module can be selected.
- Topic block second, as one token (`AsianHornet`, not `Asian Hornet`, so it stays a single tag).
- Add `PastPaper` to any card built from a real past paper question, so exam-derived cards are separable from first-principles ones. This is the most useful tag for the final fortnight, when the priority is what has actually been examined. The card text must not name the paper; see rule 7.
- Add a `Volatile` tag to any card holding a fact that changes without notice, such as a current import suspension or a sighting total, and say in your reply which cards carry it, since those need re-checking before the exam rather than re-learning.

## Card count

A useful rule of thumb, and the one the user is working to: 200 to 300 cards per module by exam day. A single syllabus section justifies roughly 80 to 130 cards. Below about 60 for a full section the deck is probably under-covering; above 140 it is probably making cards out of prose. If a topic is genuinely enormous, say so and offer to split the deck.

## Saving and reporting

Save to the module prep folder for the module in question, next to the recap it came from:

```
Mod<n>_<SectionLetter>_<Topic>_anki.tsv
```

Where a module has been split into lettered blocks, use the recap's section letter and stem, so the deck takes the recap's stem plus `_anki`. The invasive species pair is `Mod3_B_Invasive_Species_recap.md` and `Mod3_B_Invasive_Species_anki.tsv`. For a topic with no block letter, or a module with no block scheme, omit the letter, for example `Mod2_Honey_Granulation_anki.tsv`. Do not overwrite an existing deck without saying so.

In your reply, give the user:

- The file path and the card count.
- The deck name the cards will land in, and the fact that Anki creates it on import.
- The tag breakdown, so they can see the coverage.
- A note that Anki's "Allow HTML in fields" does not matter here, since the fields are plain text and `#html:false` says so in the file.
- The one-off italics tip, if the deck contains scientific names.
- Any volatile cards, called out by tag, with a reminder to re-check those facts rather than trust the card.

## Language and style

British English, Oxford commas, no en dashes or em dashes, even inside card text, since the cards are read aloud from a phone. Write dates, numbers and lists the way a marker would expect to read them.

## Quality checklist before finishing

- Every card answers as a single fact, a list, or an essay assembly.
- No card's front can be answered without producing the specific content.
- No card's back is a paragraph of unrelated facts.
- Essay material has been decomposed into component facts plus an assembly card.
- Exactly four tab separated fields on every line after the header lines, verified with `awk`.
- The four import header lines are present, in order, with `#tags column:3` and `#deck column:4`.
- Column 4 holds `BBKA Module <n>` on every row, so Anki creates the deck rather than dropping the cards into `Default`.
- No duplicate fronts, verified with `cut` and `uniq -d`.
- No tabs or newlines inside fields, no quotes, no markdown asterisks, no BOM.
- Every card tagged with module and topic block, exam-derived cards tagged `PastPaper`.
- No card text cites a paper, a sitting, a question number or a mark allocation.
- Live facts tagged `Volatile` and listed in the reply.
- Card count is proportionate to the size of the syllabus section.
- No en dashes or em dashes.
