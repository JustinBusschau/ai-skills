#!/usr/bin/env python3
"""Capture a screenshot of a web page with headless Chrome, for ticket evidence.

    capture_screenshot.py <url> <out.png> [--width 1440] [--height 900] [--wait-ms 4000]

Only for pages reachable without signing in (headless Chrome starts with an
empty profile). Checks the page answers before capturing, and that a real PNG
was written afterwards; exits 1 with the reason otherwise, so the caller can
fall back to asking a human for the screenshot. Attach the result with the
project-kanban-board skill's `edit_board.py` "attach" operation.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]


def find_chrome():
    for c in [os.environ.get("CHROME"), *CHROME_PATHS,
              *(shutil.which(n) for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"))]:
        if c and Path(c).exists():
            return c
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--wait-ms", type=int, default=4000, help="Time for the page's scripts to run before capture.")
    args = ap.parse_args(argv)
    if not args.url.startswith(("http://", "https://")):
        print("Only http and https URLs can be captured.")
        return 1
    chrome = find_chrome()
    if not chrome:
        print("No Chrome or Chromium found (set CHROME=/path/to/chrome); ask a human for the screenshot.")
        return 1
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(args.url, timeout=10) as resp:
            status = resp.status
    except Exception as exc:  # any failure means there is nothing to capture
        print(f"{args.url} did not answer ({exc}). Is the app running? Ask a human, or start it first.")
        return 1
    out = Path(args.out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    profile = tempfile.mkdtemp(prefix="audit-chrome-")
    try:
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                        f"--user-data-dir={profile}", "--hide-scrollbars", f"--window-size={args.width},{args.height}",
                        f"--virtual-time-budget={args.wait_ms}", f"--screenshot={out}", args.url],
                       capture_output=True, timeout=90)
    except subprocess.TimeoutExpired:
        print("Chrome timed out.")
        return 1
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not out.exists() or not out.read_bytes().startswith(b"\x89PNG"):
        print("No screenshot was produced.")
        return 1
    print(f"Saved {out} (HTTP {status} from {args.url}). Look at it before attaching: a sign-in page or an error "
          "screen is not evidence.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
