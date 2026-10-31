#!/usr/bin/env python3
"""Measure the body text width of a PDF, in points and centimetres.

Usage: measure_text_width.py document.pdf [--pages 3-12]

Groups the words on each page into lines, then takes the most common left
edge and the 95th-percentile right edge of those lines. Odd and even pages
are measured separately, because documents set up for double-sided printing
mirror their margins, and mixing the two would pair one page's left edge with
the other's right edge. The narrower of the two widths is reported, since a
figure inserted at that width fits on both.

The result is an estimate: indented lists, wide tables, landscape pages, and
multi-column layouts can all move it. Check it against the page width and the
document's stated margins before relying on it.

Needs pdfplumber, which the system Python usually lacks. Create a virtual
environment in a scratch directory, install it there, and run this script with
that environment's Python, giving both paths in full:

    python3 -m venv /path/to/scratch/.venv
    /path/to/scratch/.venv/bin/pip install pdfplumber==0.11.10
    /path/to/scratch/.venv/bin/python -I /path/to/this/script.py /path/to/document.pdf

(0.11.10 is the version this script was tested with in October 2026; a later
0.11.x should also work.)
"""

import argparse
import statistics
import sys
from collections import Counter

try:
    import pdfplumber
except ImportError:
    sys.exit(__doc__)


def page_range(spec, n):
    if not spec:
        return range(n)
    lo, _, hi = spec.partition("-")
    try:
        lo, hi = int(lo), int(hi or lo)
    except ValueError:
        sys.exit(f"--pages {spec!r} should look like 3-12 (pages are numbered from 1).")
    if lo < 1 or hi < lo or lo > n:
        sys.exit(f"--pages {spec} is not a range within the document's pages 1-{n}.")
    return range(lo - 1, min(hi, n))


def block(lefts, rights):
    left = Counter(lefts).most_common(1)[0][0]
    # the right margin of justified or ragged text: a high percentile of line ends
    right = statistics.quantiles(rights, n=20)[-1] if len(rights) > 1 else rights[0]
    return left, right


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--pages", help="1-based range such as 3-12")
    a = ap.parse_args()

    edges = {"odd": ([], []), "even": ([], [])}
    page_widths = set()
    with pdfplumber.open(a.pdf) as pdf:
        for i in page_range(a.pages, len(pdf.pages)):
            page = pdf.pages[i]
            page_widths.add(round(page.width, 1))
            lefts, rights = edges["odd" if i % 2 == 0 else "even"]
            lines = {}
            for w in page.extract_words():
                key = round(w["top"])
                l, r = lines.get(key, (w["x0"], w["x1"]))
                lines[key] = (min(l, w["x0"]), max(r, w["x1"]))
            for l, r in lines.values():
                lefts.append(round(l))
                rights.append(round(r))

    found = {k: block(*v) for k, v in edges.items() if v[0]}
    if not found:
        sys.exit("No text found; the PDF may be scanned images.")
    print("Page width: " + ", ".join(f"{w:g} pt" for w in sorted(page_widths))
          + ("  (mixed page sizes: narrow --pages to the portrait body pages)"
             if len(page_widths) > 1 else ""))
    for k, (left, right) in found.items():
        print(f"{k.capitalize()} pages: left {left:.1f} pt, right {right:.1f} pt, "
              f"width {right - left:.1f} pt")
    lefts = {round(l) for l, _ in found.values()}
    if len(lefts) > 1:
        print("Odd and even pages have different left edges: the margins look "
              "mirrored.")
    width = min(right - left for left, right in found.values())
    print(f"Text width: {width:.1f} pt ({width / 72 * 2.54:.2f} cm)")


if __name__ == "__main__":
    main()
