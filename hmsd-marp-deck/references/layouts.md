# Slide layouts

Every slide below assumes the deck was started with `scripts/new_deck.sh`,
which writes the front matter and the brand's stylesheet. The layouts are
identical for every brand: only colours and logos change. Slides are
separated by a line containing only `---`, with a blank line either side.

The header ends with a comment marking where the first slide begins. Do not
put `---` between `</style>` and the first slide, or Marp creates an empty
slide. Every later slide is preceded by `---`.

Classes are applied with a scoped directive such as `<!-- _class: separator -->`
on the first line of the slide. Content slides need no class.

Most layouts use raw HTML blocks (`<div class="cols">`, `.note`, `.fig`).
`scripts/render.sh` always passes `--html`; other viewers may need HTML
enabled too (in the VS Code Marp extension, the `markdown.marp.html` setting).
Inside an HTML block, leave a blank line after every opening tag and before
every closing tag, or the Markdown inside it will not be parsed. Inline HTML
on a single line (as in the option cards) needs no blank lines.

## The house look

- **Small, dense type.** Body text is 16px Arial on a 1280 by 720 slide.
  Slides carry real content, like a consulting proposal, not three words and
  a picture.
- **One-line titles** in the brand colour, 27px bold, above a full-width rule.
  Titles never wrap, so keep them to about 75 characters; the real limit is
  the slide's width (roughly 95 characters, depending on the letters). Never
  put `<br>` in a content slide's title: only the title, closing, divider,
  and separator slides may break a title over two lines. The overflow check
  reports a title that is too long as "px past right" and one forced onto a
  second line as "spilling out of its box", with `h1` as the worst element.
- **Heading bullets.** The workhorse pattern is a bolded heading line, a
  `<br>`, then one or two plain sentences explaining it.
- **A `.lead` line** in grey under the title frames the slide in one sentence.
- **A `.note` callout** in the brand tint closes most slides with the
  takeaway, starting with a bolded label ("**No lock in:**").
- **Diagrams sit in a column** beside the text as inline images, not as Marp
  background images.
- **Footer**: page number and the footer label ("Confidential" unless the
  deck's `--footer-label` says otherwise) bottom left, logo bottom right.
  Both come from the stylesheet; never add a `footer:` directive.

## Capacity guide

Measured with `scripts/render.sh` (marp-cli 4.5.1, macOS) and confirmed by the
overflow check. Treat these as planning limits, not guarantees: the overflow
check on the real deck decides. When content exceeds them, split the slide
(add "(1/2)" and "(2/2)" to the titles) rather than shrinking the type.

| Layout | Holds comfortably |
|---|---|
| Text slide | lead, 8 heading bullets each with a one-line explanation, and a note |
| Diagram beside text (`cols right-narrow`) | lead, 7 heading bullets each with a short one-line explanation, and a note |
| Table, `t-md`, 3 columns | lead, 10 rows of one-line cells, and a note |
| Table, `t-md`, 4 columns | lead, 6 rows of cells up to 20 words, and a note |
| Table, `t-sm`, 4 columns | lead, 7 rows of cells up to 20 words, and a note |
| Full-width diagram (`fig short`) | one row of five boxes, 3 bullets, and a note |

Tables fail on wrapped lines rather than row count: a cell that wraps to a
third line adds height to its whole row. Use `<br>` and "• " inside a cell for
short lists, as in the example below. Reach for `t-xs` only as a last resort.

## Title (hello) slide

Only include this when the user asked for a title slide. Start the meta line
with the brand's meta line, the last column of `new_deck.sh --list` (for
example "Hi Mum Said Dad", or "L.E.K. Consulting and Hi Mum Said Dad").

```markdown
<!-- _class: title -->
<!-- _paginate: false -->

<div class="kicker">Client name · Proposal</div>

# Deck title on one<br>or two lines

One sentence that says what the deck argues.

<div class="meta">Hi Mum Said Dad · October 2026</div>
```

## Closing (goodbye) slide

Only include this when the user asked for a closing slide.

```markdown
<!-- _class: closing -->
<!-- _paginate: false -->

# Thank you

Questions, challenges, and **next steps**

<div class="meta">Hi Mum Said Dad · name@himumsaiddad.com</div>
```

## Section separator

Only include these when the user asked for section separators. The second
line is optional.

```markdown
<!-- _class: separator -->

# Section name

What this section covers, in one line
```

## Chapter divider

For a deck that is one numbered part of a larger document, such as section 4
of a proposal response. Use it as the deck's opening slide instead of a title
slide, and only when the user says the deck is part of something larger.

```markdown
<!-- _class: divider -->

<div class="num">4</div>

# Architecture, integration, and security

<div class="sub">One line on what this part of the document covers</div>
```

## Statement slide

For the single idea the audience must remember: a full brand-colour slide.
The bolded phrase is picked out in the brand's accent colour. One or two per
deck at most.

```markdown
<!-- _class: statement -->

## Personalisation works only when **the client stays in control** of what every user sees

One supporting sentence.
```

## Text slide

```markdown
# Three foundations make every later change safe

<div class="lead">One sentence that frames the slide.</div>

- **One identity per customer**<br>Website, QR codes, email, and app links all resolve to one ID, so no channel starts from zero.
- **One content graph**<br>Every piece has a client-owned ID and labels, defined outside the CMS.
- **One integration layer**<br>CRM, consent, and the data platform connect through stable contracts.

<div class="note">

**No lock in:** every service we build has an API and publishes events.

</div>
```

Variations: a plain paragraph in place of the lead; `### Sub-heading` lines
to group bullets; plain one-line bullets with the key phrase in bold
("- **Each step is a trigger** from the catalogue, so…"). For a long list of
short items, wrap the list in `<div class="flow">` to set it in two columns.

## Two columns of text

```markdown
# Personalisation that works (2/2)

<div class="lead">Eight steps, each <strong>within the client's rules</strong>.</div>

<div class="cols">
<div>

- **Approved content in**<br>Explanation.
- **Signals in**<br>Explanation.

</div>
<div>

- **Learning with use**<br>Explanation.
- **Rules on top**<br>Explanation.

</div>
</div>

<div class="note">

**Takeaway:** one sentence.

</div>
```

Inside a `.lead` div, Markdown is not parsed, so use `<strong>` for bold.

## Table slide

Wrap the table in `t-md` (default choice), `t-sm` (dense cells), or `t-xs`.
Bold the first column's labels.

```markdown
# Built to cloud standards, with deliberate trade-offs

<div class="lead">The framework asks for deliberate choices, not every pillar at its maximum.</div>

<div class="t-md">

| Balancing item | Our recommendation | Why |
|---|---|---|
| **Reliability vs. cost** | Resilient across zones within one region | A second region would double the cost for little gain |
| **Security vs. friction** | Strong protection without a long sign-up | • Verification behind the scenes<br>• Step-up checks where risk demands it |

</div>

<div class="note">

**Takeaway:** one sentence.

</div>
```

A matrix (concepts across the top, aspects down the side) uses an empty first
header cell: `| | Concept A | Concept B | Concept C |`.

## Diagram beside text

The standard diagram layout. Text on the wider left, a `flowchart TB`
diagram on the narrower right. Swap to `left-narrow` with the `.fig` div first
to put the diagram on the left.

```markdown
# Collected once, used often, always within consent

<div class="cols right-narrow">
<div>

One pipeline feeds personalisation in seconds and insight daily.

- **One schema for every source**<br>Item IDs trace back to approved items.
- **Consent checked at the door**<br>Without consent, activity adds only to anonymous counts.

<div class="note">

**The client owns the event history.** Any downstream tool can be retrained from it.

</div>

</div>
<div class="fig">

<img src="diagrams/event-pipeline.svg" alt="Event pipeline from channels through consent to engagement and reporting">

</div>
</div>
```

For an architecture picture that needs a caption and a footnote, put the
diagram on the left:

```markdown
<div class="cols left-narrow">
<div>

<div class="caption">The engagement logic sits in the middle, so core systems can change around it</div>

<img src="diagrams/component-architecture.svg" alt="…">

<div class="footnote">All components run in the client's cloud accounts.</div>

</div>
<div>

Explanatory paragraph, heading bullets, and a note.

</div>
</div>
```

## Full-width diagram

For a wide `flowchart LR` chain. `fig short` caps the diagram's height so
bullets and a note fit underneath.

```markdown
# One customer's journey, across channels

<div class="fig short">

<img src="diagrams/journey.svg" alt="…">

</div>

- **Each step is a trigger** from the catalogue, so the chain is configuration, not code
- **The customer always lands on the item,** wherever they arrive from

<div class="note">

**Within consent at every step:** one reminder a week at most.

</div>
```

## Diagram beside a table

```markdown
<div class="cols left-narrow">
<div class="fig">

<img src="diagrams/feedback-loop.svg" alt="…">

</div>
<div class="t-sm">

| Speed | What updates | Where it shows |
|---|---|---|
| **Seconds** | Session signals | The next screen |

- **For the customer:** one line
- **For the team:** one line

<div class="note">

**A closed loop:** one sentence.

</div>

</div>
</div>
```

## Option cards

Side-by-side summaries of vendors or options. The first card takes the brand
colour, `card alt` takes neutral grey. Use `cards three` for three cards.
Write each card on one line of HTML, as below.

```markdown
<div class="cards"><div class="card"><div class="head">Option A</div><div class="body"><b>Product name</b><ul><li>First point</li><li>Second point</li></ul></div></div><div class="card alt"><div class="head">Option B</div><div class="body"><b>Product name</b><ul><li>First point</li><li>Second point</li></ul></div></div></div>
```

## Code or flow sketch

````markdown
```
Intent → Capability → Evidence → Productisation → Transfer
```
````

## Sources and references

Put a `sources` block at the bottom of any slide that states a figure from an
external study; it sits at the foot of the slide above the footer.

```markdown
<div class="sources">

Source: Publisher, *Title*, https://example.com/page

</div>
```

The references slide is a normal content slide titled "References", with
one source per bullet, wrapped in `<div class="t-sm">` if it is long.

## Speaker notes

Put speaker notes in an HTML comment at the end of any slide. They are hidden
on the slide and shown in presenter view.

```markdown
<!--
Speaker notes:
What to say, the evidence behind it, and where the source is in the repo.

Source: docs/research/findings.md
-->
```

## Diagrams

Mermaid sources go in `diagrams/*.mmd` beside the deck; `render.sh` renders
each to SVG with `assets/mermaid-config.json` (monospace 13px, white boxes,
thin dark lines, straight connectors). The same diagram style is used for
every brand.

Label every node with a bold name and a short detail line:
`api["<b>Experience API</b><br/>Composes screens"]`. Break long labels with
`<br/>` so boxes stay narrow. Number the steps of a sequence in the name
(`<b>1 · Signal</b>`). Use `{"<b>Consent<br/>given?</b>"}` for decisions,
`(["Editors"])` for people, `-.->` for supporting or future links, and
`-- "yes" -->` for labelled edges.

Colour nodes by role with this palette, pasted at the end of the `.mmd`; use
only the classes the diagram needs:

```
    classDef entry fill:#eef8fc,stroke:#5bc0de
    classDef core fill:#f4f2ff,stroke:#9b8ce0
    classDef ext fill:#f0fbf3,stroke:#5cc87a
    classDef decision fill:#fff6ec,stroke:#efc28c
    classDef output fill:#fff0fa,stroke:#e57ac5
    classDef zone fill:#fdf3fd,stroke:#e2a2e2
    classDef zone2 fill:#effcfa,stroke:#86d4c8
    classDef zone3 fill:#fff6ec,stroke:#efc28c
    class web,mail entry
    class api,engine core
```

| Class | Use for |
|---|---|
| `entry` (blue) | Channels, sources, and ways in |
| `core` (purple) | What we build or operate: the platform's own components |
| `ext` (green) | Third-party or client systems the platform calls |
| `decision` (orange) | Decision diamonds and rules |
| `output` (pink) | Reports, dashboards, and what comes out |
| `zone`, `zone2`, `zone3` | Subgraphs: apply with `class <subgraph-id> zone` |

Leave nodes without a class white when colour would add nothing.
