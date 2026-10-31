#!/usr/bin/env python3
"""
Heuristic quality scan for a converted Markdown file.

This catches the mechanical failure modes conversion tools produce -
mojibake, tables that fell apart, sections that came out empty, pages/
slides that likely failed extraction. It does NOT judge whether the
content reads coherently or faithfully represents the source; that
judgment is for the AI read-through step described in SKILL.md.

Usage: python3 scan_markdown.py output.md [output.md.meta.json]
Prints a JSON report: {"issue_count": N, "issues": [...]}
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

MOJIBAKE_PATTERNS = [
    "�",  # replacement character
    "Ã¢â‚¬", "Ã©", "Ã¨", "Â ", "â€™", "â€œ", "â€\x9d", "â€“", "â€”",
]
PLACEHOLDER_PATTERNS = [
    r"\blorem ipsum\b", r"\bTODO\b", r"\[insert[^\]]*\]", r"\bxxx+\b",
]


def find_mojibake(text: str) -> list[dict]:
    issues = []
    for i, line in enumerate(text.splitlines(), start=1):
        for pat in MOJIBAKE_PATTERNS:
            if pat in line:
                issues.append({
                    "type": "mojibake",
                    "line": i,
                    "detail": f"Found '{pat}' - likely a character-encoding artifact from conversion",
                    "snippet": line.strip()[:120],
                })
                break
    return issues


def find_placeholders(text: str) -> list[dict]:
    issues = []
    for i, line in enumerate(text.splitlines(), start=1):
        for pat in PLACEHOLDER_PATTERNS:
            if re.search(pat, line, re.IGNORECASE):
                issues.append({
                    "type": "placeholder_text",
                    "line": i,
                    "detail": f"Line matches placeholder pattern /{pat}/",
                    "snippet": line.strip()[:120],
                })
    return issues


def find_empty_sections(text: str) -> list[dict]:
    """A heading immediately followed by another heading of the same or a
    shallower level (or end of doc), with no real content in between,
    usually means extraction dropped that section's body. A heading
    followed by a *deeper* heading is not flagged - a section that just
    introduces subsections with no prose of its own is normal document
    structure, not a sign of dropped content."""
    issues = []
    lines = text.splitlines()
    heading_idx = [i for i, l in enumerate(lines) if l.lstrip().startswith("#")]

    def heading_level(line: str) -> int:
        return len(line) - len(line.lstrip("#"))

    for pos, i in enumerate(heading_idx):
        next_i = heading_idx[pos + 1] if pos + 1 < len(heading_idx) else len(lines)
        if pos + 1 < len(heading_idx) and heading_level(lines[next_i]) > heading_level(lines[i]):
            continue
        body = "\n".join(lines[i + 1:next_i]).strip()
        # strip separator markers and metadata noise before judging "empty"
        body_stripped = re.sub(r"^-{3,}$", "", body, flags=re.MULTILINE).strip()
        if len(body_stripped) < 3:
            issues.append({
                "type": "empty_section",
                "line": i + 1,
                "detail": "Heading has no content before the next heading",
                "snippet": lines[i].strip()[:120],
            })
    return issues


def find_broken_tables(text: str) -> list[dict]:
    """Markdown tables where row cell-counts don't match the header are a
    strong sign a source table's columns/rows didn't line up during
    extraction (common with merged cells or multi-line cells in PDFs)."""
    issues = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("|") and i + 1 < len(lines) and set(lines[i + 1].strip()) <= set("|-: "):
            header_cols = line.count("|")
            j = i + 2
            while j < len(lines) and lines[j].strip().startswith("|"):
                if lines[j].count("|") != header_cols:
                    issues.append({
                        "type": "broken_table",
                        "line": j + 1,
                        "detail": f"Row has {lines[j].count('|')} cell separators, header has {header_cols}",
                        "snippet": lines[j].strip()[:120],
                    })
                j += 1
            i = j
        else:
            i += 1
    return issues


def check_meta_flags(meta: dict, text: str) -> list[dict]:
    """Surface anything the conversion script itself flagged as low-confidence
    (OCR fallback pages, near-empty slides/pages, source-vs-output element
    count drops) recorded in the sidecar .meta.json each convert_*.py script
    writes."""
    issues = []
    for page in meta.get("pages", []):
        if page.get("method") == "ocr":
            issues.append({"type": "ocr_fallback", "line": None,
                            "detail": f"Page {page['page']} had little/no extractable text and was OCR'd - verify accuracy",
                            "snippet": ""})
        total_chars = page.get("chars", 999) + page.get("table_chars", 0)
        if total_chars < 20:
            issues.append({"type": "low_content_page", "line": None,
                            "detail": f"Page {page['page']} yielded only {total_chars} characters of text/table content - may be a blank/image page or a mis-detected table",
                            "snippet": ""})
    for slide in meta.get("slides", []):
        if slide.get("text_blocks", 0) == 0 and not slide.get("has_notes"):
            issues.append({"type": "low_content_slide", "line": None,
                            "detail": f"Slide {slide['slide']} has no extracted text or notes - likely image-only content",
                            "snippet": ""})

    if "source_counts" in meta and "output_counts" in meta:
        src, out = meta["source_counts"], meta["output_counts"]
        for key, label in (("heading_count", "heading"), ("table_count", "table"), ("image_count", "image")):
            if out.get(key, 0) < src.get(key, 0):
                issues.append({"type": "possible_conversion_loss", "line": None,
                                "detail": f"Source had {src.get(key, 0)} {label}(s), output has {out.get(key, 0)} - possible dropped content",
                                "snippet": ""})

    if "sheets" in meta:
        actual_sheet_headings = sum(1 for line in text.splitlines() if line.lstrip().startswith("## Sheet:"))
        reported = meta.get("sheet_count", len(meta["sheets"]))
        if actual_sheet_headings != reported:
            issues.append({"type": "possible_conversion_loss", "line": None,
                            "detail": f"Source had {reported} sheet(s), output has {actual_sheet_headings} '## Sheet:' section(s)",
                            "snippet": ""})
    return issues


def main(md_path: str, meta_path: str | None):
    text = Path(md_path).read_text(encoding="utf-8", errors="replace")
    issues = []
    issues += find_mojibake(text)
    issues += find_placeholders(text)
    issues += find_empty_sections(text)
    issues += find_broken_tables(text)

    if meta_path and Path(meta_path).exists():
        meta = json.loads(Path(meta_path).read_text())
        issues += check_meta_flags(meta, text)

    report = {"issue_count": len(issues), "issues": issues}
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print("Usage: python3 scan_markdown.py output.md [output.md.meta.json]", file=sys.stderr)
        sys.exit(2)
    md_file = sys.argv[1]
    meta_file = sys.argv[2] if len(sys.argv) == 3 else (md_file + ".meta.json")
    main(md_file, meta_file)
