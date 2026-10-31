"""Generate the <name> diagram as SVG. Units are points, so at W pt wide
(the document's text width) every label prints at its stated size.

Save as make_<name>.py. Run: python3 make_<name>.py   (writes <name>.svg
next to this script, so each diagram's script and SVG share a name)
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = re.sub(r"^make_|\.py$", "", os.path.basename(__file__)) + ".svg"
MARK = 'data-generator="print-diagram"'   # lets a rebuild replace its own SVG only

# Read by screen readers from the SVG; give the same text to the user as alt text.
TITLE = "<Short name of the diagram>"
DESC = "<One or two sentences: what the diagram shows and its main groupings.>"

W, H = 516, 200   # W is the printed width from Step 1, in points
FS = 9            # set to the minimum font size from Step 1
LH = 1.2 * FS     # line height
M = 1           # inset so outer strokes are not clipped at the page edge

FONT = "Arial, Helvetica, sans-serif"
INK = "#1F2933"
LINE = "#52606D"
SYS_FILL, SYS_STROKE = "#EAF3FB", "#0F6CBD"   # system boundary
BOX_FILL, BOX_STROKE = "#FFFFFF", "#52606D"   # components inside it
EXT_FILL = "#F2F2F2"                          # actors and external systems
DATA_FILL = "#CFE2F3"                         # data stores (darker so it still shows in greyscale)

out = []


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rect(x, y, w, h, fill, stroke, sw=0.8, rx=3, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
               f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')


def text(x, y, s, bold=False, anchor="middle", size=FS, colour=INK):
    assert size >= FS, f"{s!r} is below the minimum font size"
    wgt = ' font-weight="bold"' if bold else ""
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" '
               f'fill="{colour}"{wgt}>{esc(s)}</text>')


def box(x, y, w, h, lines, fill=BOX_FILL, bold_first=False):
    # grouped so check_svg.py measures every line against this box
    out.append("<g>")
    rect(x, y, w, h, fill, BOX_STROKE)
    n = len(lines)
    # baseline of first line so the block is vertically centred
    y0 = y + h / 2 - (n - 1) * LH / 2 + FS * 0.35
    for i, s in enumerate(lines):
        text(x + w / 2, y0 + i * LH, s, bold=(bold_first and i == 0))
    out.append("</g>")


def line(x1, y1, x2, y2):
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
               f'stroke="{LINE}" stroke-width="0.8"/>')


def bus(x, ys, x_to):
    """Vertical bus at x with a horizontal branch to x_to at each y."""
    line(x, min(ys), x, max(ys))
    for y in ys:
        line(x, y, x_to, y)


def fan_down(x_from, y_from, xs, y_bracket, y_to):
    """Drop from (x_from, y_from) to a bracket at y_bracket, then to each x."""
    line(x_from, y_from, x_from, y_bracket)
    line(min(xs + [x_from]), y_bracket, max(xs + [x_from]), y_bracket)
    for x in xs:
        line(x, y_bracket, x, y_to)


# ---- Column positions (x, width), derived from W so a new width keeps the bands
GAP = 13                  # between the outer bands and the boundary
UX, UW = M, 80            # users
EW = 103                  # connected systems
EX = W - M - EW
SX = UX + UW + GAP        # system boundary
SW = EX - GAP - SX

# ---- Users
text(UX + UW / 2, 16, "Users", bold=True)
box(UX, 30, UW, 30, ["Example user"], EXT_FILL)

# ---- System boundary
rect(SX, M + 3, SW, H - 2 * M - 6, SYS_FILL, SYS_STROKE, sw=1, rx=4)
text(SX + 8, 18, "System boundary title", bold=True, anchor="start",
     colour=SYS_STROKE)
box(SX + 8, 30, 120, 30, ["Example component"])

# ---- Connected systems
text(EX + EW / 2, 16, "Connected systems", bold=True)
box(EX, 30, EW, 30, ["Example system"], EXT_FILL)

# ---- Connectors
line(UX + UW, 45, SX + 8, 45)
line(SX + 128, 45, EX, 45)

# width/height in pt and a viewBox of the same size: one unit prints as one point
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}pt" height="{H}pt" '
       f'viewBox="0 0 {W} {H}" font-family="{FONT}" role="img" {MARK}>'
       f'<title>{esc(TITLE)}</title><desc>{esc(DESC)}</desc>'
       f'<rect x="0" y="0" width="{W}" height="{H}" fill="#FFFFFF"/>'
       + "".join(out) + "</svg>")
path = os.path.join(HERE, OUT)
if os.path.exists(path):
    with open(path) as f:
        if MARK not in f.read(2000):
            sys.exit(f"{path} exists and was not written by a print-diagram script; "
                     "rename OUT or move the file rather than overwrite it.")
with open(path, "w") as f:
    f.write(svg)
print(path)
