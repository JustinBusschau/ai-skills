#!/usr/bin/env python3
"""
Convert a PDF to Markdown.

Pandoc can't read PDFs at all, so this uses pdfplumber for text and table
extraction. Pages that come back with next to no extractable text (common
for scanned pages, cover images, or forms) are re-rendered as images and
run through Tesseract OCR instead.

PDFs have no real structure tags, so headings and list nesting are inferred
from typography:
  - Heading level comes from font size, ranked against the document's most
    common (body) font size — the largest size in the doc becomes H1, the
    next distinct size H2, and so on.
  - List items are recognised by their bullet glyph (•, ‣, ◦, ...) or, for
    the common Word-export quirk where a second-level bullet renders as a
    plain "o" in a symbol/monospace font, by that font swap. Nesting level
    comes from the bullet's horizontal indent (x0), ranked across the doc.
  - Page-number footers (a short numeric line sitting in the bottom of the
    page) are dropped as source pagination noise, along with the page
    boundaries themselves — the output is one continuous document, not a
    page-by-page dump, since downstream readers care about content, not
    which physical page it fell on.

Usage: python3 convert_pdf.py input.pdf output.md

Writes output.md and a sidecar output.md.meta.json recording, per page,
whether it was read natively or via OCR and how much text it yielded -
scan_markdown.py uses this to flag pages worth a second look.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pdfplumber

OCR_THRESHOLD_CHARS = 20  # below this, treat the page as "no real text" and try OCR
BULLET_GLYPHS = "•●▪‣◦○·"
FONT_BULLET_HINTS = ("courier", "wingding", "webding", "symbol")
PAGE_NUMBER_RE = re.compile(r"^[\-–—#]*\s*\d{1,4}\s*[\-–—]*$")
FOOTER_TOP_FRACTION = 0.9  # a bare page number sitting in the bottom 10% of the page
HEADING_SIZE_MARGIN = 1.0  # a font size must beat body size by at least this many points
HEADING_MERGE_TOLERANCE = 2  # sizes this close are the same tier (kerning/rendering noise, not a new level)


def table_char_count(tables: list[list[list]]) -> int:
    """Total characters of real content across extracted table cells - used
    alongside prose char_count so a page with a falsely-detected table (e.g.
    scanned form grid lines that yield an empty/garbage table) doesn't get
    silently exempted from the OCR fallback and the low-content scan check."""
    return sum(len(str(cell)) for table in tables for row in table for cell in row if cell)


def table_to_markdown(table: list[list]) -> str:
    if not table or not table[0]:
        return ""
    rows = [[("" if cell is None else str(cell).replace("|", "\\|").replace("\n", " ")) for cell in row] for row in table]
    header, body = rows[0], rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * len(header)) + " |",
    ]
    for row in body:
        # Pad/truncate ragged rows so the table stays parseable.
        row = (row + [""] * len(header))[: len(header)]
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def ocr_page(pdf_path: str, page_number: int) -> str:
    from pdf2image import convert_from_path
    import pytesseract

    images = convert_from_path(pdf_path, first_page=page_number, last_page=page_number, dpi=200)
    if not images:
        return ""
    return pytesseract.image_to_string(images[0])


def dominant_size(line: dict) -> float | None:
    if not line["chars"]:
        return None
    sizes = Counter(round(c["size"]) for c in line["chars"])
    return sizes.most_common(1)[0][0]


def bullet_text(line: dict) -> str | None:
    """Return the item's text with its bullet marker stripped, or None if
    this line isn't a bullet line."""
    stripped = line["text"].lstrip()
    if not stripped or not line["chars"]:
        return None
    first_char = stripped[0]
    if first_char in BULLET_GLYPHS:
        return stripped[1:].lstrip()
    first_font = line["chars"][0]["fontname"].lower()
    if (
        first_char == "o"
        and len(stripped) > 1
        and stripped[1] == " "
        and any(hint in first_font for hint in FONT_BULLET_HINTS)
    ):
        return stripped[1:].lstrip()
    return None


def is_footer_page_number(line: dict, page_height: float) -> bool:
    text = line["text"].strip()
    if not text or not PAGE_NUMBER_RE.match(text):
        return False
    return line["top"] >= page_height * FOOTER_TOP_FRACTION


def extract_page_items(page, page_number: int):
    """Return (band_lines, tables, char_count, page_height) for one page.
    band_lines has one entry per horizontal band between tables (see below),
    each a list of pdfplumber line dicts for that band, in reading order."""
    found_tables = sorted(page.find_tables(), key=lambda t: t.bbox[1])
    tables = [t.extract() for t in found_tables]
    table_bboxes = [t.bbox for t in found_tables]

    # Table cells are also picked up by line extraction, which would print
    # every table twice (once as prose, once as a Markdown table). Mask out
    # the table regions before extracting prose.
    def outside_tables(obj, boxes=table_bboxes):
        for x0, top, x1, bottom in boxes:
            if x0 <= obj["x0"] and obj["x1"] <= x1 and top <= obj["top"] and obj["bottom"] <= bottom:
                return False
        return True

    text_source = page.filter(outside_tables) if table_bboxes else page

    # Reading order matters: a table halfway down the page belongs between
    # the paragraph above it and the paragraph below it, not bolted onto the
    # end. Slice the page into horizontal bands - the gaps above/between/
    # below the tables - and interleave each band's lines with the table
    # that follows it.
    bands = []
    prev_bottom = 0.0
    for _, top, _, bottom in table_bboxes:
        bands.append((prev_bottom, max(top, prev_bottom)))
        prev_bottom = max(bottom, prev_bottom)
    bands.append((prev_bottom, page.height))

    band_lines = []
    char_count = 0
    for top, bottom in bands:
        if bottom - top < 1:
            band_lines.append([])
            continue
        cropped = text_source.within_bbox((0, top, page.width, bottom), relative=False)
        lines = cropped.extract_text_lines(return_chars=True)
        band_lines.append(lines)
        char_count += sum(len(l["text"]) for l in lines)

    return band_lines, tables, char_count, page.height


def main(input_file: str, output_file: str):
    output_path = Path(output_file)
    pages = []  # per-page dict: method, chars, tables, items (for native pages)

    with pdfplumber.open(input_file) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            band_lines, tables, char_count, page_height = extract_page_items(page, i)
            table_chars = table_char_count(tables)

            method = "native"
            items = []
            if char_count + table_chars < OCR_THRESHOLD_CHARS:
                ocr_text = ocr_page(input_file, i).strip()
                if len(ocr_text) > char_count + table_chars:
                    method = "ocr"
                    char_count = len(ocr_text)
                    items = [{"type": "ocr", "text": ocr_text}]

            if method == "native":
                for idx, lines in enumerate(band_lines):
                    for line in lines:
                        items.append({"type": "line", "page_height": page_height, **line})
                    if idx < len(tables):
                        items.append({"type": "table", "table": tables[idx]})

            pages.append({
                "page": i, "method": method, "chars": char_count, "tables": len(tables),
                "table_chars": table_chars, "items": items,
            })

    # ---- Pass 1: document-wide typography stats, used to classify lines in pass 2 ----
    size_char_counts = Counter()
    bullet_x0s = set()
    for rec in pages:
        for item in rec["items"]:
            if item["type"] != "line":
                continue
            for c in item["chars"]:
                size_char_counts[round(c["size"])] += 1
            if bullet_text(item) is not None:
                bullet_x0s.add(round(item["x0"]))

    body_size = size_char_counts.most_common(1)[0][0] if size_char_counts else 11
    heading_sizes = sorted({s for s in size_char_counts if s >= body_size + HEADING_SIZE_MARGIN}, reverse=True)
    # Rank sizes into tiers, chain-merging sizes within HEADING_MERGE_TOLERANCE
    # of their neighbour - a one-off rendering quirk (e.g. a stray 1pt size
    # from a drop-cap/kerning artifact) shouldn't consume its own hierarchy
    # level and push every real heading below it down a notch.
    heading_level = {}
    prev_size, tier = None, 0
    for s in heading_sizes:
        if prev_size is None or prev_size - s > HEADING_MERGE_TOLERANCE:
            tier += 1
        heading_level[s] = min(tier, 6)
        prev_size = s
    bullet_indent_rank = {x0: rank for rank, x0 in enumerate(sorted(bullet_x0s))}

    # ---- Pass 2: render the whole document as one continuous stream of blocks ----
    # Deliberately NOT scoped per page: a list or paragraph that spans a page
    # break (common - PDF page boundaries rarely land on paragraph breaks)
    # must stay one block, not get split by an artificial per-page reset.
    blocks = []
    current_block = None  # (kind, [lines]) where kind is "para", "list", or ("heading", level)

    def flush():
        nonlocal current_block
        if not current_block:
            return
        kind, lines = current_block
        if isinstance(kind, tuple) and kind[0] == "heading":
            blocks.append("#" * kind[1] + " " + " ".join(lines))
        else:
            blocks.append("\n".join(lines))
        current_block = None

    for rec in pages:
        if rec["method"] == "ocr":
            flush()
            blocks.append("_[Text below extracted via OCR - verify against the original page image]_")
            if rec["items"]:
                blocks.append(rec["items"][0]["text"])
            continue

        for item in rec["items"]:
            if item["type"] == "table":
                flush()
                md_table = table_to_markdown(item["table"])
                if md_table:
                    blocks.append(md_table)
                continue

            text = item["text"]
            if not text.strip():
                continue
            if is_footer_page_number(item, item["page_height"]):
                continue

            size = dominant_size(item)
            if size in heading_level:
                level = heading_level[size]
                # Consecutive lines at the same heading size are almost
                # always one wrapped heading (e.g. a title spanning two
                # lines), not two separate headings - merge them.
                if current_block and current_block[0] == ("heading", level):
                    current_block[1].append(text.strip())
                else:
                    flush()
                    current_block = (("heading", level), [text.strip()])
                continue

            item_text = bullet_text(item)
            if item_text is not None:
                level = bullet_indent_rank.get(round(item["x0"]), 0)
                rendered = ("  " * level) + "- " + item_text
                if current_block and current_block[0] == "list":
                    current_block[1].append(rendered)
                else:
                    flush()
                    current_block = ("list", [rendered])
                continue

            if current_block and current_block[0] == "para":
                current_block[1].append(text)
            else:
                flush()
                current_block = ("para", [text])
    flush()

    output_path.write_text("\n\n".join(blocks), encoding="utf-8")

    meta = {
        "source": input_file,
        "page_count": len(pages),
        "pages": [{"page": r["page"], "method": r["method"], "chars": r["chars"], "tables": r["tables"], "table_chars": r["table_chars"]} for r in pages],
    }
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {output_path} ({len(pages)} pages)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 convert_pdf.py input.pdf output.md", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
