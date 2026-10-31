#!/usr/bin/env python3
"""
Convert a .pptx (or legacy .ppt) file to Markdown, one section per slide.

Pandoc has no PPTX reader, so this walks the deck with python-pptx directly:
titles become headings, body text frames become paragraphs/bullets, tables
become Markdown tables, and speaker notes are appended as a blockquote so
the content survives without being mistaken for on-slide text.

Usage: python3 convert_pptx.py input.pptx output.md
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from pptx import Presentation


def ensure_pptx(input_path: Path) -> Path:
    if input_path.suffix.lower() != ".ppt":
        return input_path
    tmpdir = Path(tempfile.mkdtemp())
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "pptx", "--outdir", str(tmpdir), str(input_path)],
        check=True, capture_output=True,
    )
    converted = tmpdir / (input_path.stem + ".pptx")
    if not converted.exists():
        raise RuntimeError(f"LibreOffice did not produce {converted}")
    return converted


def table_to_markdown(table) -> str:
    rows = [[cell.text.replace("|", "\\|").replace("\n", " ") for cell in row.cells] for row in table.rows]
    if not rows:
        return ""
    header, body = rows[0], rows[1:]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * len(header)) + " |"]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)


def shape_text_blocks(shape) -> list[str]:
    blocks = []
    if shape.has_table:
        md = table_to_markdown(shape.table)
        if md:
            blocks.append(md)
    elif shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            line = "".join(run.text for run in para.runs).strip()
            if line:
                prefix = "- " if para.level > 0 else ""
                blocks.append(prefix + line)
    return blocks


def main(input_file: str, output_file: str):
    input_path = ensure_pptx(Path(input_file))
    output_path = Path(output_file)
    prs = Presentation(str(input_path))

    sections = []
    slide_meta = []

    for i, slide in enumerate(prs.slides, start=1):
        title = None
        if slide.shapes.title and slide.shapes.title.text.strip():
            title = slide.shapes.title.text.strip()

        heading = f"## Slide {i}: {title}" if title else f"## Slide {i}"
        body_blocks = []
        for shape in slide.shapes:
            if shape == slide.shapes.title:
                continue
            body_blocks.extend(shape_text_blocks(shape))

        notes = ""
        if slide.has_notes_slide:
            notes = (slide.notes_slide.notes_text_frame.text or "").strip()

        block = [heading]
        block.extend(body_blocks)
        if notes:
            quoted = "\n".join(f"> {line}" for line in notes.splitlines())
            block.append(f"**Speaker notes:**\n{quoted}")

        sections.append("\n\n".join(block))
        slide_meta.append({"slide": i, "has_title": bool(title), "text_blocks": len(body_blocks), "has_notes": bool(notes)})

    output_path.write_text("\n\n---\n\n".join(sections), encoding="utf-8")

    meta = {"source": input_file, "slide_count": len(slide_meta), "slides": slide_meta}
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {output_path} ({len(slide_meta)} slides)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 convert_pptx.py input.pptx output.md", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
