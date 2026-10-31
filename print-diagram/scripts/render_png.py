#!/usr/bin/env python3
"""Render a points-based SVG to a high-resolution PNG with headless Chrome.

Usage: render_png.py diagram.svg [diagram.png] [--scale 4] [--chrome PATH]
                     [--grey] [--force]

The SVG must give its width and height in pt. The page shows the SVG at its
print size in CSS pixels (points x 4/3), Chrome renders it at --scale device
pixels per CSS pixel, and the PNG's dpi is then written into the file so that
it inserts into a document at exactly the SVG's width in points.

The SVG is embedded in the page as a data URI, so the path may contain any
characters. Each PNG this script writes is marked as its own. An existing PNG
at the output path is replaced only if it carries that mark, so a user's
image with the same name is never overwritten without --force. Before
rendering, the script checks that Chrome can load the SVG, that the SVG's
first font is installed (otherwise Chrome silently draws a fallback), and,
when that font is Arial or Helvetica, that Chrome really draws text with
Arial's widths (a host may map Arial to a wider font). Each PNG is marked as
soon as Chrome writes it, so a run that fails later can still replace it.
Afterwards it checks that the PNG has the expected pixel size and that its
dpi reads back correctly. It exits 1 if any of these fail.

--grey also writes <name>_grey.png, a greyscale copy for checking that the
diagram reads in black and white. Do not deliver it.
"""

import argparse
import base64
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_svg import text_width   # noqa: E402  (Arial advance widths)

MARK = b"print-diagram render_png"
PROBE = "Hamburgefonstiv 0123456789"
GENERIC = ("serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui")

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
]


def find_chrome(explicit):
    for c in ([explicit] if explicit else []) + CHROME_CANDIDATES:
        path = c if os.path.isabs(c) else shutil.which(c)
        if path and os.path.exists(path):
            return path
    sys.exit("Could not find Chrome or Chromium; pass --chrome PATH.")


def size_pt(svg_path):
    root = ET.parse(svg_path).getroot()
    family = (root.get("font-family") or "").split(",")[0].strip().strip("'\"")
    dims = [family]
    for attr in ("width", "height"):
        m = re.fullmatch(r"\s*([\d.]+)\s*pt\s*", root.get(attr, ""))
        if not m:
            sys.exit(f"SVG {attr} must be given in pt (found {root.get(attr)!r}).")
        dims.append(float(m.group(1)))
    return dims


def page(data_uri, w_px, h_px, grey, family):
    filt = "filter:grayscale(1);" if grey else ""
    return ("<!doctype html><html><head><meta charset='utf-8'><style>"
            "html,body{margin:0;padding:0;background:#fff}"
            f"img{{display:block;width:{w_px}px;height:{h_px}px;{filt}}}"
            "</style></head><body>"
            f"<img src=\"{data_uri}\" "
            "onerror=\"document.body.setAttribute('data-broken','1')\">"
            "<script>const c=document.createElement('canvas').getContext('2d');"
            f"const w=f=>{{c.font='100px '+f;return c.measureText('{PROBE}').width}};"
            f"const fam='\"{family}\"';"
            "document.body.setAttribute('data-probe',w(fam));"
            # an installed font changes the width against at least one fallback
            "document.body.setAttribute('data-installed',"
            "['monospace','serif','sans-serif'].some(g=>w(fam+', '+g)!==w(g)))"
            "</script></body></html>")


def chrome(exe, tmp, args, html):
    try:
        return subprocess.run(
            [exe, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             f"--user-data-dir={os.path.join(tmp, 'profile')}", *args,
             "file://" + html], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        tail = "\n".join((e.stderr or "").strip().splitlines()[-5:])
        sys.exit(f"Chrome failed (exit {e.returncode}):\n{tail}")


def png_chunks(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit("Output is not a PNG.")
    i = 8
    while i < len(data):
        n, kind = struct.unpack(">I4s", data[i:i + 8])
        yield i, kind, data[i + 8:i + 8 + n]
        i += 12 + n


def png_size(path):
    with open(path, "rb") as f:
        for _, kind, body in png_chunks(f.read()):
            if kind == b"IHDR":
                return struct.unpack(">II", body[:8])
    sys.exit("PNG has no IHDR chunk.")


def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body +
            struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))


def is_ours(path):
    with open(path, "rb") as f:
        data = f.read()
    try:
        return any(k == b"tEXt" and b == b"Software\0" + MARK
                   for _, k, b in png_chunks(data))
    except (SystemExit, struct.error):
        return False


def stamp(path, dpi):
    """Write a pHYs chunk (pixels per metre) and this script's mark after IHDR."""
    with open(path, "rb") as f:
        data = f.read()
    ppm = round(dpi / 0.0254)
    extra = chunk(b"pHYs", struct.pack(">IIB", ppm, ppm, 1)) + \
        chunk(b"tEXt", b"Software\0" + MARK)
    out = bytearray(data[:8])
    for start, kind, body in png_chunks(data):
        if kind == b"pHYs":
            continue
        out += data[start:start + 12 + len(body)]
        if kind == b"IHDR":
            out += extra
    with open(path, "wb") as f:
        f.write(out)


def read_dpi(path):
    with open(path, "rb") as f:
        for _, kind, body in png_chunks(f.read()):
            if kind == b"pHYs":
                x, _, unit = struct.unpack(">IIB", body)
                return x * 0.0254 if unit == 1 else None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svg")
    ap.add_argument("png", nargs="?")
    ap.add_argument("--scale", type=float, default=4)
    ap.add_argument("--chrome")
    ap.add_argument("--grey", action="store_true",
                    help="also write <name>_grey.png for a black-and-white check")
    ap.add_argument("--force", action="store_true",
                    help="replace an existing PNG this script did not write")
    a = ap.parse_args()

    svg = os.path.abspath(a.svg)
    png = os.path.abspath(a.png or os.path.splitext(svg)[0] + ".png")
    family, w_pt, h_pt = size_pt(svg)
    w_px, h_px = w_pt * 4 / 3, h_pt * 4 / 3
    win = (math.ceil(w_px), math.ceil(h_px))
    expected = (round(win[0] * a.scale), round(win[1] * a.scale))
    exe = find_chrome(a.chrome)
    with open(svg, "rb") as f:
        data_uri = "data:image/svg+xml;base64," + base64.b64encode(f.read()).decode()

    outputs = [(png, False)]
    if a.grey:
        outputs.append((os.path.splitext(png)[0] + "_grey.png", True))
    for out, _ in outputs:
        if os.path.exists(out) and not is_ours(out) and not a.force:
            sys.exit(f"{out} exists and was not written by this script; move it, "
                     "choose another output name, or pass --force.")

    # pixels per inch when the PNG is printed at the SVG's width in points
    dpi = a.scale * 4 / 3 * 72

    with tempfile.TemporaryDirectory() as tmp:
        html = os.path.join(tmp, "page.html")
        for out, grey in outputs:
            with open(html, "w") as f:
                f.write(page(data_uri, w_px, h_px, grey, family))
            dom = chrome(exe, tmp, ["--dump-dom"], html).stdout
            if re.search(r"<body[^>]*data-broken", dom):
                sys.exit("Chrome could not load the SVG; open it in a browser "
                         "to see the error.")
            if (family and family.lower() not in GENERIC
                    and 'data-installed="true"' not in dom):
                sys.exit(f"The SVG's font {family!r} is not installed, so Chrome "
                         "would draw a fallback font. Install it, or use a font "
                         "that is installed, then render again.")
            m = re.search(r'data-probe="([\d.]+)"', dom)
            if family.lower() in ("arial", "helvetica") and m:
                want = text_width(PROBE, 100, False)
                if abs(float(m.group(1)) / want - 1) > 0.02:
                    sys.exit(f"Chrome is not drawing {family} at Arial's widths "
                             f"({float(m.group(1)):.0f} px against {want:.0f}); "
                             "install Arial or a metric-compatible font such "
                             "as Liberation Sans, then render again.")
            if os.path.exists(out):
                os.remove(out)      # so a stale PNG cannot pass for a new one
            chrome(exe, tmp, [f"--force-device-scale-factor={a.scale:g}",
                              f"--window-size={win[0]},{win[1]}",
                              f"--screenshot={out}"], html)
            if not os.path.exists(out):
                sys.exit(f"Chrome did not write {out}.")
            stamp(out, dpi)         # mark it ours at once, so a rerun can replace it
            got = png_size(out)
            if got != expected:
                sys.exit(f"{out} is {got[0]} x {got[1]} px; expected "
                         f"{expected[0]} x {expected[1]}.")

    got = read_dpi(png)
    if got is None or abs(got - dpi) > 1:
        sys.exit(f"Could not write {dpi:g} dpi into {png} (read back {got}).")
    print(f"PNG: {png}")
    print(f"Print size: {w_pt:g} x {h_pt:g} pt "
          f"({w_pt / 72 * 2.54:.2f} x {h_pt / 72 * 2.54:.2f} cm)")
    print(f"Resolution: {dpi:g} dpi (read back from the file)")
    if a.grey:
        print(f"Greyscale check copy: {outputs[1][0]} (not a deliverable)")


if __name__ == "__main__":
    main()
