#!/usr/bin/env python3
"""
Check which tools/libraries doc-to-markdown needs are available.

Usage: python3 check_deps.py [ext]
  ext - optional file extension (pdf, docx, doc, pptx, ppt, xlsx, xls, csv, tsv)
        to scope the check to only what that format needs.

Prints JSON: {"present": [...], "missing": [{"name": ..., "why": ..., "install": ...}]}
or, for an extension no converter in this skill supports:
{"present": [], "missing": [], "error": "..."}

Exit code 0 if nothing missing, 1 if something is missing, 2 if the given
extension isn't supported at all (nothing was actually checked).
"""
import importlib
import json
import shutil
import sys

CLI_TOOLS = {
    "pandoc": {
        "why": "converts .docx to Markdown, preserving headings/lists/tables",
        "install": "apt-get install -y pandoc  (or: brew install pandoc)",
        "formats": {"docx", "doc"},
    },
    "soffice": {
        "why": "converts legacy .doc/.ppt/.xls to modern Office formats before extraction",
        "install": "apt-get install -y libreoffice  (or: brew install --cask libreoffice)",
        "formats": {"doc", "ppt", "xls"},
    },
    "tesseract": {
        "why": "OCR fallback for scanned/image-only PDF pages",
        "install": "apt-get install -y tesseract-ocr",
        "formats": {"pdf"},
    },
}

PY_LIBS = {
    "pdfplumber": {
        "why": "extracts text and tables from PDF pages",
        "install": "pip install pdfplumber --break-system-packages",
        "formats": {"pdf"},
    },
    "pdf2image": {
        "why": "rasterizes PDF pages to images for OCR",
        "install": "pip install pdf2image --break-system-packages",
        "formats": {"pdf"},
    },
    "pytesseract": {
        "why": "Python wrapper around the tesseract OCR engine",
        "install": "pip install pytesseract --break-system-packages",
        "formats": {"pdf"},
    },
    "pptx": {
        "why": "reads slides, tables, and speaker notes from .pptx files",
        "install": "pip install python-pptx --break-system-packages",
        "formats": {"pptx", "ppt"},
    },
    "pandas": {
        "why": "reads spreadsheet data sheet by sheet",
        "install": "pip install pandas --break-system-packages",
        "formats": {"xlsx", "xls", "csv", "tsv"},
    },
    "openpyxl": {
        "why": "pandas' engine for reading modern .xlsx files",
        "install": "pip install openpyxl --break-system-packages",
        "formats": {"xlsx"},
    },
    "tabulate": {
        "why": "renders spreadsheet data as Markdown tables",
        "install": "pip install tabulate --break-system-packages",
        "formats": {"xlsx", "xls", "csv", "tsv"},
    },
}


def check(ext=None):
    present, missing = [], []

    all_formats = set()
    for info in list(CLI_TOOLS.values()) + list(PY_LIBS.values()):
        all_formats |= info["formats"]
    if ext and ext not in all_formats:
        return {
            "present": [],
            "missing": [],
            "error": f"no converter in this skill supports the '.{ext}' extension - check the Format routing table in SKILL.md",
        }

    for name, info in CLI_TOOLS.items():
        if ext and ext not in info["formats"]:
            continue
        if shutil.which(name):
            present.append(name)
        else:
            missing.append({"name": name, "why": info["why"], "install": info["install"]})

    for module, info in PY_LIBS.items():
        if ext and ext not in info["formats"]:
            continue
        try:
            importlib.import_module(module)
            present.append(module)
        except ImportError:
            missing.append({"name": module, "why": info["why"], "install": info["install"]})

    return {"present": present, "missing": missing}


if __name__ == "__main__":
    ext = sys.argv[1].lower().lstrip(".") if len(sys.argv) > 1 else None
    result = check(ext)
    print(json.dumps(result, indent=2))
    sys.exit(2 if "error" in result else (1 if result["missing"] else 0))
