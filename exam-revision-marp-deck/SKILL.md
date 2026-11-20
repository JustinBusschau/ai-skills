---
name: exam-revision-marp-deck
description: Build a personal-branded Marp deck from a BBKA revision recap, for a study group where each participant owns a different section and presents it, with generous use of relevant images, diagrams and embeddable video. Use when asked for slides, a presentation, a talk, a study-group deck or a walkthrough of a BBKA module block such as Mod3_B_Invasive_Species_recap.md, or when asked to cover the most important areas of a recap in slide form. Uses the hmsd-marp-deck skill with its logo-free personal brand.
---

## When to use

Use this skill when revision material needs to be presented rather than read. The intended setting is a study group: each participant takes a different syllabus block, prepares a deck from its recap, and walks the others through it. The deck is a prompt for discussion and recall, not a replacement for the notes or the recap.

This is the fifth of five revision outputs. The others are `exam-revision-notebook-notes` (narrative notes), `exam-revision-revision-notes` (condensed facts and traps), `exam-revision-review` (the recap this skill reads) and `exam-revision-anki-deck` (single-point cards). Read `Revision-Output-Standard.md` in the study-plan repository before a batch.

## Inputs and fixed choices

- **A recap file is the normal input.** Read it in full. It is the source of truth: do not re-research the topic or add facts that are not in the recap. Notes may be read for wording but not used to expand the deck.
- **A named topic with no recap.** Run `exam-revision-review` first to produce one, then build the deck from it.
- **Brand and layout are already decided for this skill:** the `personal` brand from `hmsd-marp-deck`, title slide yes, closing slide yes (used for discussion prompts), section separator slides no, location beside the recap, PDF and PNG check required. Do not ask the user to choose these again unless they explicitly ask for a different brand or layout.

Read `~/.claude/skills/hmsd-marp-deck/SKILL.md` and `~/.claude/skills/hmsd-marp-deck/references/layouts.md` before writing slides, and follow their deck mechanics exactly. The personal brand is logo-free by design: no wordmark, no client logo, no invented emblem. Its shipped palette is honey amber and charcoal on warm cream with the footer "Study group". If the user asks for different colours or a footer, change the personal brand with `~/.claude/skills/hmsd-marp-deck/scripts/configure_personal_brand.py` before starting the deck, using the branding questions in that skill.

## Audience and depth

The recap is an individual's revision aid; the deck is a teaching aid for a group. Assume that some listeners have not yet worked through the item notes. The deck must therefore carry substantially more exposition than a recap: for each syllabus item it covers, aim for material closer in length and completeness to that item's revision-notes sheet than to a recap paragraph. Use the revision-notes file as the source for item detail, and the recap for coverage, currency, synthesis and discussion prompts.

Do not reproduce the revision-notes headings "Be certain", "Traps" or "Current at", and do not label anything as "what to focus on", "important to remember", "key recall", "know cold" or "Recall:". Turn the facts into teaching prose: a short lead that says what the item is about, then heading bullets that explain the rules, figures, exceptions and common corrections in connected sentences. Keep the figures, dates, legal references, named lists and units exactly as the revision notes give them. Omit anything marked unverified, not certain or still open.

Depth now matters more than a strict 60-minute timing. A block may need more than one session; record that in the handback rather than cutting the item explanations to make the clock fit.

## What to put in the deck

Use this shape, adapting counts to the size of the block:

1. **Title slide.** Block name, module, syllabus item range, and a one-line purpose.
2. **Map slide.** A table mapping the syllabus items in the coverage table to the deck sections, with a short lead explaining the span of the block.
3. **Content slides, one or more per syllabus item.** Work through every item in the block's coverage table, in order. Build the content from the matching `Mod<n>_Item_<x>_revision-notes.md` file: use its "Be certain" bullets, tables and prose as the teaching body, and turn the "Traps" corrections into positive explanatory bullets. Split an item across several slides when it needs them; add "(1/2)", "(2/2)" and so on to the title. Use up to eight heading bullets per slide, each with a one- or two-sentence explanation. Never shrink the type to fit more in.
4. **Discriminator material where the block has look-alikes.** Small hive beetle against wax moth, *Tropilaelaps* against *Varroa*, *Vespa velutina* against *Vespa crabro*, *Nosema ceranae* against *Nosema apis*, and so on. Present it as part of the relevant item slides rather than a separate terse comparison slide.
5. **Figures and dates slide.** Values from the block, grouped by topic, each attached to the step or criterion it belongs to, with units. Do not title it as a list of things to know.
6. **Synthesis slide.** A short slide that connects the items using the recap's closing links, so a newcomer can see how the block hangs together. Do not call it "Take away" or two things to remember.
7. **Currency line.** If the recap carries a currency line, repeat it verbatim on the map slide. Never present time-sensitive facts as permanent, and never write "volatile" or "re-check before the exam".
8. **Discussion slide in place of a corporate closing slide.** Three or four questions the presenter can ask the group, drawn from the recap's cover-and-recall block or self-test questions. Keep mark allocations out of the slides; these are discussion prompts, not an exam.

Depth follows the source material: a dense block may need 20 or more slides, and that is acceptable. Check every slide for overflow with `render.sh --png --pdf` and split any slide that fails.

## Visual material

Read `Revision-Image-Standard.md` in the study-plan repository before adding images. This is the one output where the user wants generous imagery: a relevant picture or diagram on most content slides is welcome, and a short video can be included where it explains something better than text. The user will review the deck and ask for items to be added, removed or swapped, so do not check every image or video with them first. List everything you add in the handback instead.

Sources, in order of preference:

1. Official BBKA or NBU diagrams from the repository's past papers, syllabus, guidance and leaflets, or from bbka.org.uk and nationalbeeunit.com. Reuse the same files in the module's shared `images/` folder as the notes and recap.
2. Official BBKA or NBU videos.
3. Credible third-party equipment photographs, bee and plant images and videos where they genuinely help the audience and no official image exists. Give the source in the caption or a `.sources` block.

Never use AI-generated or unsourced examinable diagrams, and never let an image carry a fact that contradicts the revision-notes sheets or the recap. If a source cannot be verified, leave it out and say so in the handback. Keep paper dates, sittings and question numbers out of captions and alt text; record the source in `images/PROVENANCE.md`.

**Images.** Use the existing `.fig` and `.cols` layouts. The deck sits beside the recap in the module folder, so the path into the shared image folder is the same as in the Markdown outputs:

```markdown
<div class="cols left-narrow">
<div class="fig">

<img src="images/Mod3_Bee_Anatomy_labelled.png" alt="Labelled external anatomy of a worker honey bee">

<div class="caption">External anatomy of a worker bee.</div>

</div>
<div>

- **Heading**<br>One or two teaching sentences.

</div>
</div>
```

Use `.fig short` for a wide image that must sit above bullets. Images count towards slide height, so split the slide rather than shrinking type. Check the rendered previews for legibility, for a missing image and for overlap with the footer.

**Video.** A linked thumbnail is the reliable pattern because it works in both the HTML and PDF exports. `render.sh` passes `--html` and `--allow-local-files`, so raw HTML links to local files and to YouTube both work:

```markdown
<div class="fig">

<a href="https://www.youtube.com/watch?v=VIDEO_ID"><img src="images/Mod3_Video_Thumb.jpg" alt="Short description of what the video shows"></a>

<div class="caption">Watch: [video title], [publisher]. https://www.youtube.com/watch?v=VIDEO_ID</div>

</div>
```

A YouTube `<iframe>` can be used when the deck will be presented live in HTML, but PDF and PNG exports of an iframe are often blank. If you use one, keep the linked thumbnail on the slide immediately before it so the PDF still carries the material:

```markdown
<div class="fig">

<iframe width="640" height="360" src="https://www.youtube-nocookie.com/embed/VIDEO_ID" title="Video title" frameborder="0" allowfullscreen></iframe>

<div class="caption">Watch: [video title], [publisher]. https://www.youtube.com/watch?v=VIDEO_ID</div>

</div>
```

Prefer official BBKA or NBU videos. Keep each clip short and state in the speaker notes what the audience should notice while watching.

### Callout boxes

A `.note` callout summarises the slide it sits on, not the block as a whole. Take the wording from that item's own revision-notes material or from the recap section for the shared slides, and write it as a plain sentence with no `**Recall:**` or similar label. Never copy the recap's single "Take away" item onto several slides, and never repeat a callout across consecutive slides. Each callout must be one complete sentence, under about 180 characters, with no ellipsis. If a draft has to be cut, choose a shorter sentence from the same source rather than truncating a long one. The figures slide can have its own short callout about units, and the discussion slide uses a presenter tip.

## Exclusions

- No past-paper references, paper dates, question numbers, mark allocations or "most examinable" framing. The evidence table at the bottom of the recap is not deck material.
- No facts absent from the item's revision-notes file or the recap.
- No "to confirm" notes in speaker notes or on slides. If a source marks something unverified, not certain or still open, leave it out of the deck.
- No source-path chatter in speaker notes. Speaker notes are for the presenter's spoken cues only.
- No corporate footer or logo because of an organisation named in the material. This skill always uses personal branding.

## Saving

Save beside the recap as:

```
Mod<n>_<SectionLetter>_<Topic>_marp.md
```

For example, `Mod3_B_Invasive_Species_recap.md` produces `Mod3_B_Invasive_Species_marp.md`. Leave the generated HTML and PDF beside it. Delete the `.preview/` folder after the visual check, but keep `.render-manifest` for later re-renders. Do not overwrite an existing deck without saying so.

## Hand back

- Deck, HTML and PDF paths.
- Slide count and the syllabus items covered.
- Brand confirmation: personal, logo-free, honey and charcoal, footer "Study group".
- A list of every image and video added, with its source and the slide it appears on, so the user can ask for swaps or removals.
- The standard hmsd warning about sharing only the PDF, in the words used by that skill.
- Anything omitted from the recap because of space, and any slide that could not be checked.

## Quality checklist

- Item detail comes from the matching revision-notes sheet; coverage, currency, synthesis and discussion come from the recap.
- Personal brand applied through `new_deck.sh personal`; no logo assets beside the deck.
- Title, map, one or more content slides per covered item, figures and dates, synthesis and discussion slides present where relevant.
- Item explanations are closer to revision-notes length than to recap length, with heading bullets that carry connected teaching sentences.
- No "what to focus on", "important to remember", "key recall", "know cold" or "Recall:" labels anywhere on slides.
- Every callout is an unlabelled complete sentence drawn from the slide's own source material, with no repeated callout and no ellipsis.
- Currency line reproduced where the recap has one, with no volatile framing.
- Every image and video is either official BBKA or NBU material or a credited, credible source, with no unsourced examinable diagram.
- Local image paths resolve from the module folder, video links carry a thumbnail fallback, and every image and video is listed in the handback.
- No past-paper references or mark allocations.
- Overflow check passed; previews inspected and then deleted.
- British English, Oxford comma, no en dashes or em dashes.
