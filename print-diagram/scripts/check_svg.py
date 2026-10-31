#!/usr/bin/env python3
"""Check a points-based diagram SVG for print problems.

Usage: check_svg.py diagram.svg --min-font PT [--min-pad 3]

--min-font is required: pass the document's minimum font size, not a habit.

Reports:
  - whether width and height are in pt and match the viewBox scale, in both
    directions (a missing viewBox fails: without one, a unit is a CSS pixel,
    so text prints at 0.75 of its size);
  - any text smaller than the minimum font size;
  - lines of a label set closer than 1.15 times the font size;
  - any label whose estimated width runs closer than --min-pad points to the
    edge of its box, or past it. A label inside a <g> with exactly one <rect>
    (as the template's box() writes) belongs to that rect, so a line that has
    spilled out of a short box is still measured against it; any other label
    belongs to the smallest rectangle containing its anchor point;
  - any rectangle, line, or label (including its stroke) that runs past the
    edge of the canvas and would be clipped;
  - a missing <title> or <desc>, or the template's placeholder left in place.

Text widths are estimated from Arial (Helvetica) advance widths, so treat a
near miss as a prompt to look at the PNG, not as proof; if the SVG names a
different font first, the estimates do not apply and the script says so.
Exits 1 if anything fails.
"""

import argparse
import re
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.w3.org/2000/svg}"

# Arial regular advance widths in 1/1000 em
W = {" ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
     "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
     ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584,
     "?": 556, "@": 1015, "[": 278, "]": 278, "_": 556, "|": 260,
     "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
     "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722,
     "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
     "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
     "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556,
     "h": 556, "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556,
     "o": 556, "p": 556, "q": 556, "r": 333, "s": 500, "t": 278, "u": 556,
     "v": 500, "w": 722, "x": 500, "y": 500, "z": 500}
W.update({d: 556 for d in "0123456789"})
BOLD_FACTOR = 1.08     # Arial Bold is about 8% wider on typical labels
MIN_LEADING = 1.15     # smallest line spacing, as a multiple of font size


def text_width(s, size, bold):
    em = sum(W.get(c, 600) for c in s) / 1000
    return em * size * (BOLD_FACTOR if bold else 1)


def num(v, default=0.0):
    m = re.match(r"\s*(-?[\d.]+)", v or "")
    return float(m.group(1)) if m else default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svg")
    ap.add_argument("--min-font", type=float, required=True,
                    help="the document's minimum font size in pt")
    ap.add_argument("--min-pad", type=float, default=3)
    a = ap.parse_args()

    root = ET.parse(a.svg).getroot()
    problems, notes = [], []

    width, height = root.get("width", ""), root.get("height", "")
    if not (width.endswith("pt") and height.endswith("pt")):
        problems.append(f"width/height should be in pt (found {width!r}, {height!r})")
    try:
        vb = [float(v) for v in root.get("viewBox", "").replace(",", " ").split()]
    except ValueError:
        vb = []
    if len(vb) != 4:
        problems.append(f"viewBox missing or malformed ({root.get('viewBox')!r}); "
                        "set it to \"0 0 W H\" to match the width and height")
    if len(vb) == 4 and width.endswith("pt") and height.endswith("pt"):
        sx, sy = num(width) / vb[2], num(height) / vb[3]
        # the drawing is scaled uniformly to fit, so the smaller scale applies
        scale = min(sx, sy)
        if abs(sx - 1) > 0.01 or abs(sy - 1) > 0.01:
            problems.append(f"viewBox {vb[2]:g} x {vb[3]:g} differs from size "
                            f"{num(width):g} x {num(height):g} pt, so 1 unit "
                            f"prints at {scale:.3f} pt")
    elif width.endswith("pt"):
        scale = 0.75            # no viewBox: one unit is a CSS pixel, 0.75 pt
    else:
        scale = 1.0

    if len(vb) == 4:
        cx0, cy0, cx1, cy1 = vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]
    else:
        cx0 = cy0 = 0.0
        cx1, cy1 = num(width), num(height)

    def off_canvas(what, x0, y0, x1, y1):
        over = max(cx0 - x0, cy0 - y0, x1 - cx1, y1 - cy1)
        if over > 0.01:
            problems.append(f"{what} runs {over:.1f} pt past the edge of the canvas")

    def stroke(el):
        if el.get("stroke") in (None, "none"):
            return 0.0
        return num(el.get("stroke-width"), 1)

    rects, owner = [], {}
    for r in root.iter(NS + "rect"):
        x, y, w, h = (num(r.get(k)) for k in ("x", "y", "width", "height"))
        if len(vb) == 4 and w >= vb[2] - 0.5 and h >= vb[3] - 0.5:
            continue            # page background
        rects.append((x, y, w, h))
        sw = stroke(r) / 2
        off_canvas(f"box at ({x:g}, {y:g}) {w:g} wide", x - sw, y - sw,
                   x + w + sw, y + h + sw)
    for g in root.iter(NS + "g"):
        own = g.findall(NS + "rect")
        if len(own) == 1:
            box = tuple(num(own[0].get(k)) for k in ("x", "y", "width", "height"))
            for t in g.findall(NS + "text"):
                owner[t] = box

    for ln in root.iter(NS + "line"):
        x1, y1, x2, y2 = (num(ln.get(k)) for k in ("x1", "y1", "x2", "y2"))
        sw = stroke(ln) / 2
        px = sw if x1 == x2 else 0      # stroke widens a line across its run
        py = sw if y1 == y2 else 0
        off_canvas(f"line from ({x1:g}, {y1:g}) to ({x2:g}, {y2:g})",
                   min(x1, x2) - px, min(y1, y2) - py,
                   max(x1, x2) + px, max(y1, y2) + py)

    family = (root.get("font-family") or "").split(",")[0].strip().strip("'\"")
    if family.lower() not in ("arial", "helvetica"):
        notes.append(f"font {family or '(none)'!r} is not Arial: width estimates "
                     "do not apply, so rely on the rendered PNG")

    default_size = num(root.get("font-size"), 16)
    smallest = None
    in_box = {}
    for t in root.iter(NS + "text"):
        s = "".join(t.itertext())
        if not s.strip():
            continue
        size = num(t.get("font-size"), default_size)
        printed = size * scale
        smallest = printed if smallest is None else min(smallest, printed)
        if printed < a.min_font - 1e-6:
            problems.append(f"{s!r}: prints at {printed:.2f} pt, below {a.min_font:g} pt")

        x, y = num(t.get("x")), num(t.get("y"))
        tw = text_width(s, size, t.get("font-weight") in ("bold", "700"))
        anchor = t.get("text-anchor", "start")
        x0 = {"middle": x - tw / 2, "end": x - tw}.get(anchor, x)
        x1 = x0 + tw
        top, bottom = y - 0.72 * size, y + 0.21 * size
        off_canvas(repr(s), x0, top, x1, bottom)

        if t in owner:
            rx, ry, rw, rh = owner[t]
        else:
            inside = [r for r in rects
                      if r[0] <= x <= r[0] + r[2] and r[1] <= y <= r[1] + r[3]]
            if not inside:
                continue        # free-standing heading
            rx, ry, rw, rh = min(inside, key=lambda r: r[2] * r[3])
        in_box.setdefault((rx, ry, rw, rh, x), []).append((y, size, s))
        pad = min(x0 - rx, rx + rw - x1)
        vpad = min(top - ry, ry + rh - bottom)
        where = f"box at ({rx:g}, {ry:g}) {rw:g} wide"
        if pad < 0:
            problems.append(f"{s!r}: overflows {where} by about {-pad:.1f} pt")
        elif pad < a.min_pad:
            problems.append(f"{s!r}: only {pad:.1f} pt from the side of {where}")
        elif pad < a.min_pad + 2:
            notes.append(f"{s!r}: {pad:.1f} pt side margin in {where}")
        if vpad < 0:
            problems.append(f"{s!r}: spills about {-vpad:.1f} pt out of the top "
                            f"or bottom of {where}")
        elif vpad < 2:
            problems.append(f"{s!r}: is within 2 pt of the top or bottom of {where}")

    for (rx, ry, rw, _, _), lines in in_box.items():
        lines.sort()
        for (y0, s0, t0), (y1, s1, t1) in zip(lines, lines[1:]):
            if 0 < y1 - y0 < MIN_LEADING * max(s0, s1) - 1e-6:
                problems.append(f"{t0!r} and {t1!r}: lines {y1 - y0:.1f} pt apart "
                                f"in box at ({rx:g}, {ry:g}), under "
                                f"{MIN_LEADING:g} x font size")

    for tag in ("title", "desc"):
        el = root.find(NS + tag)
        if el is None or not (el.text or "").strip() or el.text.startswith("<"):
            problems.append(f"no <{tag}> (or the template's placeholder): "
                            "set TITLE and DESC")

    if width.endswith("pt") and height.endswith("pt"):
        print(f"Print size: {num(width):g} x {num(height):g} pt "
              f"({num(width) / 72 * 2.54:.2f} x {num(height) / 72 * 2.54:.2f} cm)")
    if smallest is not None:
        print(f"Smallest text prints at {smallest:.2f} pt (minimum {a.min_font:g} pt)")
    for n in notes:
        print("tight:", n)
    for p in problems:
        print("FAIL:", p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
