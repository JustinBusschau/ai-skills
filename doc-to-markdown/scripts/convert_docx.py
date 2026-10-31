#!/usr/bin/env python3
"""
Convert a .docx (or legacy .doc) file to Markdown using pandoc.

Usage: python3 convert_docx.py input.docx output.md

Writes output.md and a sidecar output.md.meta.json recording element
counts (headings, tables, images) from both the *source* .docx XML and
the *converted* Markdown output, so scan_markdown.py can flag a drop
(e.g. "source had 12 headings, output has 3") as a sign of lost content.
"""
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def ensure_docx(input_path: Path) -> Path:
    """Legacy .doc files can't be read by pandoc directly - convert via LibreOffice first."""
    if input_path.suffix.lower() != ".doc":
        return input_path
    tmpdir = Path(tempfile.mkdtemp())
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "docx", "--outdir", str(tmpdir), str(input_path)],
        check=True, capture_output=True,
    )
    converted = tmpdir / (input_path.stem + ".docx")
    if not converted.exists():
        raise RuntimeError(f"LibreOffice did not produce {converted}")
    return converted


def extract_source_counts(docx_path: Path) -> dict:
    """Count headings, tables, and images directly from the source .docx
    XML/zip structure - independent of pandoc's output, so it's a real
    sanity check rather than comparing the output against itself."""
    try:
        with zipfile.ZipFile(docx_path) as z:
            image_count = sum(1 for n in z.namelist() if n.startswith("word/media/"))
            try:
                xml = z.read("word/document.xml").decode("utf-8", errors="replace")
            except KeyError:
                xml = ""
    except zipfile.BadZipFile:
        image_count, xml = 0, ""
    return {
        "heading_count": len(re.findall(r'<w:pStyle\s+w:val="Heading\d"', xml)),
        "table_count": len(re.findall(r"<w:tbl[ >]", xml)),
        "image_count": image_count,
    }


def main(input_file: str, output_file: str):
    input_path = ensure_docx(Path(input_file))
    output_path = Path(output_file)
    source_counts = extract_source_counts(input_path)

    # gfm (GitHub-flavored Markdown) renders tables far more reliably than
    # pandoc's default markdown dialect, and is what most downstream AI
    # tooling expects.
    subprocess.run(
        ["pandoc", "-f", "docx", "-t", "gfm", "--wrap=none", "-o", str(output_path), str(input_path)],
        check=True,
    )

    text = output_path.read_text(encoding="utf-8", errors="replace")
    output_counts = {
        "heading_count": sum(1 for line in text.splitlines() if line.lstrip().startswith("#")),
        "table_count": sum(1 for line in text.splitlines() if line.strip() and set(line.strip()) <= set("|-: ")),
        "image_count": text.count("!["),
    }
    meta = {
        "source": str(input_file),
        "source_counts": source_counts,
        "output_counts": output_counts,
    }
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 convert_docx.py input.docx output.md", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
