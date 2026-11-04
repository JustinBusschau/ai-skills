#!/usr/bin/env python3
"""Render a wireframe written as HTML to a PNG, for attaching to a screen ticket.

    render_design.py <screen>.html <screen>.png [--device mobile|tablet|desktop] [--width W --height H]

Uses headless Chrome or Chromium (set CHROME=/path if it is not found). The
HTML should be self-contained (no external images, fonts, or scripts) and
sized for the device: mobile 390x844, tablet 820x1180, desktop 1440x900.
Exits 1 with the reason if no browser is available or no image was produced,
so the caller can fall back to the design checklist (design_checklist.py).
Look at the PNG before attaching it.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEVICES = {"mobile": (390, 844), "tablet": (820, 1180), "desktop": (1440, 900)}
MIN_WIDTH = 500  # headless Chrome's narrowest layout width
CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium"]


def find_chrome():
    for c in [os.environ.get("CHROME"), *CHROME_PATHS,
              *(shutil.which(n) for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"))]:
        if c and Path(c).exists():
            return c
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("html")
    ap.add_argument("out")
    ap.add_argument("--device", choices=DEVICES, default="mobile")
    ap.add_argument("--width", type=int)
    ap.add_argument("--height", type=int)
    args = ap.parse_args(argv)
    src = Path(args.html).expanduser().resolve()
    if not src.is_file():
        print(f"{src} not found.")
        return 1
    chrome = find_chrome()
    if not chrome:
        print("No Chrome or Chromium found, so no wireframe can be rendered. Add the design to the design "
              "checklist instead (design_checklist.py add ...).")
        return 1
    width, height = DEVICES[args.device]
    width, height = args.width or width, args.height or height
    out = Path(args.out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    profile = tempfile.mkdtemp(prefix="render-design-")
    work = Path(tempfile.mkdtemp(prefix="render-design-page-"))
    base = [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            f"--user-data-dir={profile}", "--hide-scrollbars", "--virtual-time-budget=2000"]
    try:
        # Headless Chrome will not lay a page out narrower than about 500 px, though its
        # screenshot is exactly the window size. So show the design in a frame of exactly
        # the device size, centred on a neutral background when the device is narrower.
        canvas_w = max(width, MIN_WIDTH)
        win_w, win_h = canvas_w, height
        frame = work / "frame.html"
        frame.write_text(
            "<!doctype html><html><body style='margin:0;background:#e9e9ec;overflow:hidden'>"
            f"<iframe src='{src.as_uri()}' style='display:block;margin:0 auto;border:0;width:{width}px;"
            f"height:{height}px;background:#fff'></iframe></body></html>", encoding="utf-8")
        subprocess.run(base + ["--allow-file-access-from-files", f"--window-size={win_w},{win_h}",
                               f"--screenshot={out}", frame.as_uri()], capture_output=True, timeout=90)
    except subprocess.TimeoutExpired:
        print("Chrome timed out.")
        return 1
    finally:
        shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)
    if not out.exists() or not out.read_bytes().startswith(b"\x89PNG"):
        print("No image was produced.")
        return 1
    note = f", centred on a {max(width, MIN_WIDTH)} px wide background" if width < MIN_WIDTH else ""
    print(f"Rendered {out}: the design at {width}x{height}{note}. Look at it before attaching it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
