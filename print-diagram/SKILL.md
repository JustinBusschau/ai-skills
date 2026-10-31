---
name: print-diagram
description: Produces clean, print-ready architecture, system context, and component diagrams for documents such as tender responses, reports, and specifications, as an SVG and a high-resolution PNG plus the Python script that generated them. Works in points so labels print at exactly the document's minimum font size, lays boxes out by hand in columns and bands rather than with Mermaid's automatic layout, renders with headless Chrome, and checks the result visually and against the source before handing over. Use whenever the user asks to create, draw, redraw, tidy, or make print-ready an architecture diagram, system context diagram, component diagram, or deployment diagram, or gives a Mermaid flowchart or architecture diagram, a plain-English description, a list of components and connections, or an existing diagram image and wants a figure for a document, even if they do not say "SVG" or "print".
---

# Print diagram

Turn a Mermaid diagram, a description, a list of components and connections,
or an existing image into a calm, professional figure that prints at the size
it was designed for. The deliverables are an SVG, a 4x PNG with the right dpi,
and the small Python script that wrote the SVG, so the diagram can be edited
and rebuilt later.

`assets/example/` holds the reference implementation: `make_svg.py` and the
SVG and PNG it produced (the architecture diagram for section 5.2 of a tender
response). Read `make_svg.py` before drawing anything. It is the style guide
as much as the code: its palette, stroke weights, line height, corner radii,
column constants, bus lines, and bracket fan-out are what a finished diagram
should look like. Some things in it are not to be copied; see "Lessons from
the example" below.

Commands below write `<skill-dir>` for this skill's base directory (the folder
holding this file). Substitute the real absolute path; do not assume it is
under `~/.claude/skills`, and do not use paths relative to the skill, because
the working directory is normally the user's document folder.

## Step 1: gather the constraints

Ask for these, or infer them from the document, before drawing. Ask in one
message, offering the defaults, so the user can answer in a line.

- **Printed width**: the width the image will be inserted at, normally the
  text width of the page. Get it in points (1 cm = 28.35 pt; 1 in = 72 pt).
  If a PDF of the target document is available, measure it rather than
  guessing. The script needs pdfplumber, which the system Python usually
  lacks, so install it in a throwaway virtual environment in a scratch
  directory and run the script with that environment's Python, using full
  paths throughout:

  ```bash
  python3 -m venv <scratch>/.venv
  <scratch>/.venv/bin/pip install pdfplumber==0.11.10
  <scratch>/.venv/bin/python -I <skill-dir>/scripts/measure_text_width.py <document.pdf> --pages 3-12
  ```

  Pages are numbered from 1. Choose body pages in portrait, not the
  cover or landscape pages. The script measures odd and even pages
  separately, reports the narrower width, and says when the margins look
  mirrored. It is an estimate, so tell the user the figure you will use and
  how you got it. If only a Word template is available, the text width is the
  page width minus the left and right margins (for mirrored margins, the
  inside plus the outside margin).
- **Minimum font size**: default 9 pt. Tender instructions often state one
  (for example "diagrams must be no smaller than 9 point"); look for it. Call
  it `<min>` below: it becomes `FS` in the script and `--min-font` for the
  checker, and nothing else carries it through.
- **Maximum height**, if page space is tight.
- **Palette and font**: default Arial with the muted blue and grey palette in
  the template. Use the document's own colours if it has a house style, but
  keep them muted and make sure they still separate in greyscale.
- **Where to save** the three files. Default to a `figures/` folder beside
  the document if there is one; otherwise ask. List the folder before writing
  anything. Never overwrite an existing script, SVG, or PNG without the
  user's agreement; if a redraw should replace an earlier figure, say which
  files will be replaced and ask first. The scripts back this up: the
  generator will only replace an SVG that a print-diagram script wrote, and
  `render_png.py` will only replace a PNG it wrote, unless given `--force`.
  Use `--force` only after the user has agreed. When the source is an
  existing image, choose a `<name>` that differs from its file name.

## Step 2: extract the content

Whatever the input, reduce it to a plain inventory before laying anything out:
actors, the system boundary and its title, components inside the boundary (with
their role: entry point, application, supporting service, or data store),
external systems, and connections. Note the label each one should carry.

Labels on connectors and arrowheads showing direction are out of scope: the
skill draws connectors as plain lines between boxes. If the source carries
edge labels (Mermaid `-->|label|`, C4 `Rel(..., "Uses", "HTTPS")`) or a
direction that matters to the reader, record them in the inventory as
omitted, and list them for the user in Step 7 so they can go in the caption
or the surrounding text.

- **Mermaid** is a content source, not a layout. Take its nodes, edges, and
  subgraphs (edge labels go on the omitted list), and ignore its direction
  and ordering. This applies to flowchart (`graph`/`flowchart`), C4, and `architecture` diagrams only.
  Sequence, class, state, entity-relationship, Gantt, and other Mermaid
  diagram types carry meaning in their layout (message order, cardinality,
  time) that a box-and-band layout would lose: tell the user this skill does
  not cover them rather than forcing them into bands. (Mermaid's automatic
  layout wastes space and crosses lines, which is the problem this skill
  exists to solve.)
- **A description or list**: take components and connections only from what
  it says. If a connection is implied but not stated, list it as a question.
- **An existing image**: read it carefully, transcribe every label exactly,
  and treat its layout as a hint at grouping, not a constraint.

Keep the inventory; Step 6 checks the finished diagram against it.

## Step 3: plan the layout

Work out positions on paper (in your head or in comments) before writing code.
The reference layout is a good default for system diagrams:

- **Three bands left to right**: external actors (users) on the left, the
  system boundary in the middle, and connected or external systems on the
  right. Give each outer band a bold heading above it ("Users", "Connected
  systems").
- **Inside the boundary**, columns by role: edge and entry points (front door,
  sign-in, API gateway), then the application, then supporting services
  (CMS, AI, integration). Data stores go in a row along the bottom.
- **A shared grid**: rows at the same y across columns, so connectors run
  straight across. Align box edges and centres; keep gaps between boxes
  consistent at about 6 to 10 points; inset the boundary contents by about
  8 points.
- **Size boxes from their text**: allow about 0.5 em per character (4.5 pt
  at 9 pt) plus at least 4 points of padding each side, and a line height of
  1.2 em (10.8 pt at 9 pt) plus at least 4 points top and bottom. A
  composite box ("Application services" over a list of modules) can be tall
  and span several rows, which gives the rows beside it something to connect
  to.
- **Smallest height**: once everything fits, tighten vertical gaps and row
  heights until the diagram is as short as it can be while every label still
  reads at the minimum size. Respect the maximum height if one was given; if
  it cannot be met without going below the minimum font size, say so rather
  than shrinking text.

Other diagram types (component diagrams without actors, deployment views)
follow the same principles: bands or columns by role, a shared grid, and the
same drawing rules.

## Step 4: write the generator script

Copy `<skill-dir>/assets/template_make_svg.py` to the output folder as
`make_<name>.py`, where `<name>` describes the diagram (for example
`make_architecture_5_2.py`). The script writes `<name>.svg` beside itself, so
each diagram's files share a name and a second diagram in the same folder
does not overwrite the first. Set `TITLE` and `DESC` at the top: they become
the SVG's `<title>` and `<desc>`, and the checker fails while the template's
placeholders remain. Set `W` to the printed width and `FS` to `<min>` from
Step 1; `LH` follows from `FS`, and the outer band positions follow from `W`.
Build the diagram in the script. The template has the helpers from the reference (`rect`, `text`, `box`,
`line`), two connector helpers (`bus` and `fan_down`), the palette, and the
corrected SVG header. Keep the script small, readable, and free of third-party
dependencies, with named constants for column positions and widths so the
layout is easy to adjust by hand later.

### Units

Set the SVG's `width` and `height` in `pt` and its `viewBox` to `0 0 W H`, the
same numbers, so one unit prints as one point. A 9-unit font then prints at
exactly 9 pt when the image is inserted at W pt wide. Keep content inside a
1-point inset (`M` in the template) so outer strokes are not clipped.

### Drawing rules

- Centre each box label, with multi-line text vertically centred in the box
  (the `box` helper does this). Draw every boxed label with `box`: it groups
  the box and its lines, so the checker measures every line against that
  box, even one that has spilled out of it. A label drawn with `text` beside
  a `rect` is matched by its anchor point only, and spills go unnoticed.
- Wrap labels by hand into short lines that fit the box width. Break at
  natural phrase boundaries ("Employers and" / "providers"), never inside a
  product name if avoidable.
- Make the first line bold only for large composite boxes, such as
  "Application services" above a list of modules, with a blank line between
  the heading and the list.
- Connectors are thin (0.8 pt), straight, orthogonal lines with no arrowheads
  and no labels (see Step 2). The checker does not look at connector labels,
  arrowheads, polygons, or paths, so do not add them.
- When one component connects to many, draw a single vertical bus line with
  short horizontal branches (`bus`), not many separate lines.
- Fan out to a row of boxes, such as data stores, with a short drop, a
  horizontal bracket line, and short drops to each box (`fan_down`).
- Never let a connector meet a bus at the same height as one of its branches.
  A line arriving opposite a branch reads as a direct connection to that
  branch's box. Bring it in between two branches instead.
- Connectors meet box edges at a box's centre line or on a shared row line,
  never at a corner.
- Fills: one tint for the system boundary, white for components inside it,
  pale grey for actors and external systems, and a light blue tint for data
  stores. Outlines are mid grey at 0.8 pt; the boundary uses its accent colour
  at 1 pt.
- The boundary carries a bold title in its accent colour, at the top left,
  such as "Azure UK South, with recovery copies in UK West".
- No title or caption inside the image; the document supplies the caption.
- No shadows, gradients, icons, or decorative elements. Corners are rounded at
  about 3 points (4 for the boundary). The diagram must read clearly in black
  and white, so never rely on colour alone to distinguish two kinds of box:
  each kind also needs its own band, row, or heading. The template's fills
  are pale, and adjacent kinds differ by only a few per cent of grey, which
  is why Step 5 includes a greyscale render. If you change the palette, keep
  data stores at least as dark as the template's `DATA_FILL`.
- Escape `&`, `<`, and `>` in labels (the template's `text` helper does this).

## Step 5: render, check, and fix

Run the script, then check and render:

```bash
python3 -I <out>/make_<name>.py
python3 -I <skill-dir>/scripts/check_svg.py <out>/<name>.svg --min-font <min>
python3 -I <skill-dir>/scripts/render_png.py <out>/<name>.svg --grey
```

`<out>` is the output folder from Step 1, given in full; the generator writes
beside itself, so the commands work from any directory. `-I` stops Python
importing modules from the script's folder, which is the user's document
folder and may hold files from a client pack (a stray `re.py` there would
otherwise run in place of the standard library). `--min-font` has no
default, so that the checker always tests the document's own minimum. Check
the exit code of each command, not just its output; all three exit non-zero
on failure.

`check_svg.py` confirms the units, reports the smallest printed font size,
and estimates every label's width from Arial's character widths to flag text
that overflows or comes within 3 points of a box's side, or within 2 points of
its top or bottom. It also fails lines of a label set closer than 1.15 times
the font size, a missing `viewBox` or one that does not match the width and
height in both directions, any box, line, or label whose extent (including half its stroke)
runs past the edge of the canvas, and a missing or placeholder `<title>` or
`<desc>`. If the SVG's font is not Arial or Helvetica, it says its width
estimates do not apply; the rendered PNG is then the only width check. Fix
every FAIL. Treat "tight" notes as
prompts to look. It does not check connectors, overlaps, or greyscale
contrast; the visual check below does.

`render_png.py` embeds the SVG in a small HTML page at its print size in CSS
pixels (points x 4/3) and screenshots it with headless Chrome at a device
scale factor of 4. It fails if Chrome could not load the SVG; if the SVG's
font is Arial or Helvetica but Chrome draws text at different widths (a host
without Arial substituting a wider font); or if the PNG is not the expected
pixel size. It writes the PNG's dpi (384 for scale 4) into the file itself so
that it inserts at the right size, and reads the dpi back to confirm it.
Re-rendering replaces its own earlier PNG; it refuses to replace any other
file. `--grey` also writes
`<name>_grey.png`, a greyscale copy for the black-and-white check; delete it
before delivery.

If Chrome or Chromium is not installed, the script says so. Do not substitute
another renderer, because their font handling differs from what the user's
document will show. Tell the user, and either ask them to install Chrome (or
give its path with `--chrome`), or, if they prefer, deliver the SVG and the
script with the checker's result, stating plainly that no PNG was produced
and the visual check was not done.

Then **look at the PNG and the greyscale copy** with the Read tool. The
checker only estimates; the rendered image is the truth. Fix any of these and
render again:

- text touching or overflowing a box edge: re-wrap the label or widen the box;
- cramped boxes: three lines in a box sized for two, or labels with less
  breathing room than their neighbours;
- ambiguous or overlapping connectors: a line that could belong to two boxes,
  a line meeting a bus opposite a branch, lines running along box edges;
- uneven spacing: gaps that differ between rows or columns for no reason,
  boxes in a column not sharing edges;
- in the greyscale copy, two kinds of box that are told apart only by a
  tint that has disappeared.

Repeat until the checker passes and the PNG looks clean. It usually takes two
or three rounds; do not hand over the first render without looking at it.

## Step 6: check the content against the source

Compare the finished diagram against the inventory from Step 2:

- every box and every connection in the diagram must come from the source
  (the Mermaid, description, image, or document);
- every component and connection that matters in the source must be in the
  diagram;
- every connector label and every direction left out under Step 2 is on the
  list for the user.

Do not invent components to make the picture look complete, and do not drop
awkward ones to make it fit. Where you merged, renamed, regrouped, or inferred
something, list it for the user to confirm.

## Step 7: deliver

Save the SVG, the PNG, and the generator script together in the chosen
location, delete the `_grey.png` check copy, then tell the user, in this
order:

1. where the three files are (full paths);
2. the exact width to insert the image at, in points and centimetres, and the
   resulting height; and a warning not to shrink it, because the labels are
   sized for that width and shrinking it takes them below the minimum;
3. confirmation that every label prints at or above the minimum font size at
   that width (quote the smallest size from `check_svg.py`);
4. alt text for the figure: the `DESC` text, or a fuller version written
   from the Step 2 inventory, ready to paste into Word's Alt Text pane. The
   SVG's `<title>` and `<desc>` do not carry over into Word's alt text, and
   neither makes the document accessible on its own;
5. any content questions from Step 6: additions, omissions, merges, or
   renamings for them to confirm, including the connector labels and
   directions that were left out.

The font size confirmation in item 3 only holds if the image is inserted at
the stated width. If the width came from `measure_text_width.py` rather than
the document's own stated margins, say so, so the user can check it.

To insert in Word: Insert > Pictures, then set the width in Format Picture >
Size with "Lock aspect ratio" on. Word places a PNG with correct dpi metadata
at the right size automatically; SVG is also supported in current Word and
keeps text sharp. By default Word compresses pictures when the document is
saved (often to 220 ppi), so the 384 dpi PNG will not survive at full
resolution unless "Do not compress images in file" is ticked (File > Options
> Advanced, under "Image Size and Quality"). The printed size, and so the
font size, is unaffected; tell the user if sharpness matters.

## Lessons from the example

`assets/example/make_svg.py` shows the look to aim for, but these details in
it should not be repeated:

- Its `viewBox` is `-1 -1 518 262` while the size is `516pt` by `260pt`, so
  the drawing is scaled to fit by the smaller of 516/518 and 260/262, and its
  9-unit labels print at 8.93 pt. Use the template's `viewBox="0 0 W H"`
  with a 1-point inset instead.
- "Reporting store" has under 3 points of side padding, and the three-line
  "Partner APIs (API Management)" label nearly touches the bottom of its
  34-point box. `check_svg.py` flags both. They are the kind of thing the
  visual check in Step 5 exists to catch.
- Its outer columns start at x = 0 (`UX`) and end at x = W (`EX + EW`), which
  only worked because of that `-1 -1` viewBox. With the template's
  `viewBox="0 0 W H"`, keep outer boxes inside the `M` inset, as the
  template's column constants do; otherwise half of each outer stroke is
  clipped (`check_svg.py` reports it).
- Its data-store fill (`#DCEBF7`) is lighter than the template's `DATA_FILL`
  and barely separates from the boundary tint in greyscale. Take the palette
  from the template, not the example.
- Its `text` helper does not escape `&`, `<`, or `>`, and it writes its SVG
  relative to the current directory. Use the template's helpers, which do
  both correctly.
