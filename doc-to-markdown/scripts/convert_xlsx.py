#!/usr/bin/env python3
"""
Convert a spreadsheet (.xlsx, .xls, .csv, .tsv) to Markdown, one table per sheet.

Usage: python3 convert_xlsx.py input.xlsx output.md
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd


def ensure_xlsx(input_path: Path) -> Path:
    """pandas' xls engine (xlrd) is often not installed - normalize legacy
    .xls to .xlsx via LibreOffice so we don't need it as a dependency."""
    if input_path.suffix.lower() != ".xls":
        return input_path
    tmpdir = Path(tempfile.mkdtemp())
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "xlsx", "--outdir", str(tmpdir), str(input_path)],
        check=True, capture_output=True,
    )
    converted = tmpdir / (input_path.stem + ".xlsx")
    if not converted.exists():
        raise RuntimeError(f"LibreOffice did not produce {converted}")
    return converted


def main(input_file: str, output_file: str):
    input_path = ensure_xlsx(Path(input_file))
    output_path = Path(output_file)
    suffix = input_path.suffix.lower()

    if suffix in (".csv", ".tsv"):
        sep = "\t" if suffix == ".tsv" else ","
        sheets = {input_path.stem: pd.read_csv(input_path, sep=sep, dtype=str)}
    else:
        sheets = pd.read_excel(input_path, sheet_name=None, dtype=str)

    sections = []
    sheet_meta = []
    for name, df in sheets.items():
        df = df.fillna("")
        sections.append(f"## Sheet: {name}\n\n{df.to_markdown(index=False)}")
        sheet_meta.append({"sheet": name, "rows": len(df), "columns": len(df.columns)})

    output_path.write_text("\n\n---\n\n".join(sections), encoding="utf-8")

    meta = {"source": input_file, "sheet_count": len(sheet_meta), "sheets": sheet_meta}
    Path(str(output_path) + ".meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {output_path} ({len(sheet_meta)} sheet(s))")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 convert_xlsx.py input.xlsx output.md", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
