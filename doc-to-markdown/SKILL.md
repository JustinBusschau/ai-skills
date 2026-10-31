---
name: doc-to-markdown
description: Converts a source document — PDF, Word (.doc/.docx), Excel (.xls/.xlsx/.csv), PowerPoint (.ppt/.pptx), or a Google Docs/Sheets/Slides link — into clean Markdown that AI agents and downstream skills can parse, then scans the result for conversion problems before handing it back. Use whenever the user wants to turn an RFP, RFI, requirements spec, contract, deck, or spreadsheet into Markdown, wants a document "in a format an AI can read," mentions feeding a document into an agent/pipeline/skill, or wants to avoid manual copy-paste or pandoc one-liners. Trigger even without the word "Markdown" — phrases like "make this doc machine-readable" or "extract this PDF into text for Claude" mean this skill. Do NOT use for general PDF manipulation (merging, splitting, forms — that's the pdf skill) or for producing a polished Office deliverable (use docx/xlsx/pptx skills) — this is for going *from* a rich format *to* Markdown.
---

# Document → Markdown Conversion

## Why this exists

Source documents are laid out for human eyes: multi-column PDFs, merged
spreadsheet cells, decks with a title on one shape and body text on another.
None of that survives a naive copy-paste, and generic converters either choke
on one format (pandoc can't read PDF or PPTX at all) or silently mangle tables.
This skill picks the right extraction method per format, then — because
conversion tools fail quietly, not loudly — checks its own output before
calling the job done.

## Workflow

1. **Get one source file.** If the user gives you a Google Docs/Sheets/Slides
   link instead of a local file, read `references/google_export.md` first —
   it needs a browser export step before anything below applies.

2. **Check dependencies before converting anything:**
   ```bash
   python3 scripts/check_deps.py <ext>   # ext = pdf, docx, pptx, xlsx, etc.
   ```
   If it reports an `"error"` (the extension isn't in the Format routing
   table below and nothing was actually checked), stop and tell the user this
   skill has no conversion path for that file type — don't guess a workaround
   or hand-roll one.

   If it reports anything missing, **stop and ask the user**: name the tool,
   the one-line reason it's needed (the script gives you this), and the
   install command, then wait for a yes before running any install command
   yourself. Don't install silently — some of these (LibreOffice especially)
   are large, and a user running this locally may not want them on their
   machine without knowing. The Python library install commands use
   `--break-system-packages` as the quick path; if the user would rather keep
   the install isolated, offer a virtualenv instead
   (`python3 -m venv .venv && source .venv/bin/activate && pip install <package>`)
   rather than defaulting to the system-wide install.

3. **Convert using the script that matches the file extension** (see table
   below). Each script writes `<output>.md` plus a `<output>.md.meta.json`
   sidecar recording per-page/slide/sheet extraction details — the scan step
   needs this file, so don't delete it until after scanning.

4. **Run the heuristic scan**, then **read the Markdown yourself**, then
   **report findings** — see "Comprehension scan" below. Don't try to
   auto-fix issues; surface them and let the user decide, since guessing at a
   fix risks introducing an error more subtle than the original one.

5. **Save the output next to the source**, same base filename, `.md`
   extension (e.g. `RFP_2026.pdf` → `RFP_2026.md`). If the source came from a
   Google export, save next to wherever the exported copy landed and tell the
   user both paths. Before writing, check whether a file of that name already
   exists. If it does, don't silently overwrite it — ask whether to overwrite,
   or save under a distinguishing name (e.g. a version suffix), since a prior
   conversion may have been hand-edited since.

## Format routing

| Source extension | Script | Notes |
|---|---|---|
| `.docx` | `scripts/convert_docx.py` | Uses pandoc (`gfm` output) — pandoc reads docx natively and does a solid job with headings/lists/tables. |
| `.doc` | `scripts/convert_docx.py` | Same script; it converts to `.docx` via LibreOffice first since pandoc can't read the legacy binary format. |
| `.pdf` | `scripts/convert_pdf.py` | Pandoc has no PDF reader at all. Uses `pdfplumber` per page; pages with almost no extractable text (scanned pages, cover images) automatically fall back to Tesseract OCR. Table regions are extracted separately so they don't also appear as garbled prose. Since PDFs carry no structure tags, headings, list nesting, and page-number footers are all inferred from typography (font size, bullet glyph/font, indent) rather than kept as literal page-by-page dump — output is one continuous document with no `## Page N` / `---` markers. |
| `.pptx` / `.ppt` | `scripts/convert_pptx.py` | Pandoc has no PPTX reader either. Walks the deck with `python-pptx`: one `## Slide N` section each, tables as Markdown tables, speaker notes as a blockquote so they're not confused with on-slide text. `.ppt` is normalized to `.pptx` via LibreOffice first. |
| `.xlsx` / `.xls` / `.csv` / `.tsv` | `scripts/convert_xlsx.py` | One `## Sheet: <name>` table per sheet via pandas. `.xls` is normalized to `.xlsx` via LibreOffice first (avoids needing the separate `xlrd` dependency). |

Run each script as `python3 scripts/<name>.py <input> <output.md>`.

## Comprehension scan

A conversion can run without errors and still be wrong — a table that lost a
column, a scanned page nobody OCR'd, a paragraph that came out as
`Ã¢â‚¬Â` mojibake. Catching this needs two different kinds of checking, and
they're not redundant:

**1. Heuristic scan (mechanical, run this first):**
```bash
python3 scripts/scan_markdown.py <output.md>
```
This catches things a script can verify without understanding the content:
encoding artifacts, placeholder text (`TODO`, `[insert ...]`) left behind by
a template, headings with no body, Markdown tables where a row's cell count
doesn't match the header, and anything the conversion script itself flagged
as low-confidence (an OCR'd page, a slide with zero extracted text). It
prints a JSON list of issues with line numbers — real, but narrow: it can't
tell you whether the document *makes sense*.

**2. Your own read-through (judgment, do this second):** Read the resulting
Markdown file yourself, the way you'd skim a document a colleague handed you.
Ask: does this read coherently start to finish? Do section headings match
their content? If a table's numbers look truncated or a paragraph cuts off
mid-sentence, that's worth flagging even though no heuristic caught it. This
step exists because heuristics can't judge fidelity to the source — only a
read can.

**Report both sets of findings to the user in one summary** — don't fix
anything automatically. If the scan comes back clean and your read-through
finds nothing odd, say so briefly; don't manufacture caveats for a clean
conversion.

## Handling multiple files

If the user hands you several documents at once (a folder of RFP
attachments, say), convert and scan each one independently — don't average
issues across files or skip the scan step "to save time." Each document gets
its own `.md` file and its own findings, because an issue in one file (a
broken table) says nothing about whether another file converted cleanly.

## Dependencies

- `pandoc` — reads `.docx`
- LibreOffice (`soffice`) — normalizes legacy `.doc`/`.ppt`/`.xls` to modern formats
- `pdfplumber`, `pdf2image`, `pytesseract` + the `tesseract` binary — PDF text/table extraction and OCR fallback
- `python-pptx` — reads `.pptx`
- `pandas`, `openpyxl`, `tabulate` — reads spreadsheets and renders Markdown tables

`scripts/check_deps.py` checks all of these and tells you exactly what's
missing and how to install it — always run it before the first conversion in
a session rather than assuming a prior session's install still holds.
