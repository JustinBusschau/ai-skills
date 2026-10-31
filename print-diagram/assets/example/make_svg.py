"""Generate the 5.2 architecture diagram as SVG. Units are points, so at
516pt wide (the EC4 text width) every label prints at its stated size."""

W, H = 516, 260
FS = 9          # minimum font size allowed for diagrams (Part A 14.7)
LH = 10.8       # line height

INK = "#1F2933"
LINE = "#52606D"
AZ_FILL, AZ_STROKE = "#EAF3FB", "#0F6CBD"
BOX_FILL, BOX_STROKE = "#FFFFFF", "#52606D"
EXT_FILL = "#F2F2F2"
DATA_FILL = "#DCEBF7"

out = []


def rect(x, y, w, h, fill, stroke, sw=0.8, rx=3, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
               f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')


def text(x, y, s, bold=False, anchor="middle", size=FS, colour=INK):
    wgt = ' font-weight="bold"' if bold else ""
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" '
               f'fill="{colour}"{wgt}>{s}</text>')


def box(x, y, w, h, lines, fill=BOX_FILL, bold_first=False):
    rect(x, y, w, h, fill, BOX_STROKE)
    n = len(lines)
    # baseline of first line so the block is vertically centred
    y0 = y + h / 2 - (n - 1) * LH / 2 + FS * 0.35
    for i, s in enumerate(lines):
        text(x + w / 2, y0 + i * LH, s, bold=(bold_first and i == 0))


def line(x1, y1, x2, y2):
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
               f'stroke="{LINE}" stroke-width="0.8"/>')


# ---- Column positions
UX, UW = 0, 80            # users
AX, AW = 94, 306          # Azure boundary
EX, EW = 412, 104         # connected systems
FX, FW = 102, 66          # edge column inside Azure
MX, MW = 178, 114         # application column
RX, RW = 302, 90          # right column inside Azure

# ---- Users
text(UX + UW / 2, 16, "Users", bold=True)
box(UX, 30, UW, 30, ["Citizens"], EXT_FILL)
box(UX, 68, UW, 30, ["Employers and", "providers"], EXT_FILL)
box(UX, 106, UW, 30, ["EUSG staff"], EXT_FILL)
box(UX, 174, UW, 34, ["Partners and", "researchers"], EXT_FILL)

# ---- Azure boundary
rect(AX, 4, AW, H - 8, AZ_FILL, AZ_STROKE, sw=1, rx=4)
text(AX + 8, 18, "Azure UK South, with recovery copies in UK West",
     bold=True, anchor="start", colour=AZ_STROKE)

# Edge column
box(FX, 30, FW, 104, ["Front Door", "and web", "application", "firewall"])
box(FX, 140, FW, 28, ["Sign-in", "(Entra ID)"])
box(FX, 174, FW, 34, ["Partner APIs", "(API", "Management)"])

# Application column
box(MX, 30, MW, 30, ["Web application", "(Next.js)"])
box(MX, 68, MW, 140, ["Application services", "(Node.js and TypeScript)", "",
                      "Profiles, taxonomy,", "matching, vacancies,",
                      "training, employer", "tools, and concerns"],
    bold_first=True)

# Right column
box(RX, 30, RW, 30, ["Payload CMS", "(content editing)"])
box(RX, 68, RW, 30, ["Azure OpenAI", "(UK South only)"])
box(RX, 106, RW, 102, ["Integration", "", "Queues, adapters,", "retries, and a",
                       "review queue"], bold_first=True)

# Data row
DY, DH, DW = 222, 28, 67
data = [["PostgreSQL"], ["Azure AI", "Search"], ["File storage"], ["Reporting store"]]
dxs = [FX + i * (DW + 7) for i in range(4)]
for dx, lab in zip(dxs, data):
    box(dx, DY, DW, DH, lab, DATA_FILL)

# ---- Connected systems
text(EX + EW / 2, 16, "Connected systems", bold=True)
ext = [["Quartz (EUSR),", "read-only"], ["EUSG Jobs", "Database"],
       ["ATS, multiposters,", "and job boards"], ["Training providers", "and Skills England"],
       ["EUSG Dynamics 365"]]
eys = [30 + i * 38 for i in range(5)]
for ey, lab in zip(eys, ext):
    box(EX, ey, EW, 30, lab, EXT_FILL)
box(EX, DY, EW, DH, ["EUSG Power BI"], EXT_FILL)

# ---- Connectors
# users to the edge
for cy in (45, 83, 121):
    line(UX + UW, cy, FX, cy)
line(UX + UW, 191, FX, 191)                    # partners to API Management
line(FX + FW, 45, MX, 45)                      # edge to web application
line(FX + FW, 191, MX, 191)                    # API Management to services
line(MX + MW / 2, 60, MX + MW / 2, 68)         # web application to services
line(MX + MW, 45, RX, 45)                      # web application to CMS
line(MX + MW, 83, RX, 83)                      # services to Azure OpenAI
line(MX + MW, 140, RX, 140)                    # services to integration
# services to the data stores
by = 215
line(MX + MW / 2, 208, MX + MW / 2, by)
line(dxs[0] + DW / 2, by, dxs[-1] + DW / 2, by)
for dx in dxs:
    line(dx + DW / 2, by, dx + DW / 2, DY)
# integration to connected systems
bx = 404
line(RX + RW, 140, bx, 140)
line(bx, eys[0] + 15, bx, eys[-1] + 15)
for ey in eys:
    line(bx, ey + 15, EX, ey + 15)
line(dxs[-1] + DW, DY + DH / 2, EX, DY + DH / 2)  # reporting store to Power BI

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}pt" height="{H}pt" '
       f'viewBox="-1 -1 {W + 2} {H + 2}" font-family="Arial, Helvetica, sans-serif">'
       f'<rect x="-1" y="-1" width="{W + 2}" height="{H + 2}" fill="#FFFFFF"/>'
       + "".join(out) + "</svg>")
open("architecture_5.2.svg", "w").write(svg)
print("ok")
