#!/usr/bin/env python3
"""Set the personal brand palette from the user's guidance.

The personal brand is deliberately not a logo: it is a set of colours, a font
and an optional decorative image. This script rewrites
assets/brands/personal/brand.css from a few choices, deriving the supporting
tokens (tints, rules, contrast text) so the shared base.css keeps working.

Usage:
  configure_personal_brand.py --primary '#2E3230' --heading '#9A6516' \
      --paper '#FFFDF7' --footer-label 'Study group' \
      [--accent '#C8892B'] [--font 'Arial, Helvetica, sans-serif'] \
      [--decor-image /path/to/image.svg] [--description '...']

With no arguments it prints the current header and tokens.
"""
import argparse
import os
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRAND_DIR = HERE.parent / "assets" / "brands" / "personal"
CSS = BRAND_DIR / "brand.css"
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def rgb(value: str) -> tuple[int, int, int]:
    if not HEX.match(value):
        raise argparse.ArgumentTypeError(f"expected a #RRGGBB colour, got {value!r}")
    return tuple(int(value[i : i + 2], 16) for i in (1, 3, 5))


def hexof(value: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{int(max(0, min(255, c))):02X}" for c in value)


def mix(a: str, b: str, weight_b: float) -> str:
    """blend a towards b; weight_b=0 gives a, 1 gives b."""
    x, y = rgb(a), rgb(b)
    return hexof(x[i] * (1 - weight_b) + y[i] * weight_b for i in range(3))


def luminance(value: str) -> float:
    r, g, b = (c / 255 for c in rgb(value))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--primary", help="dark slide background, #RRGGBB")
    p.add_argument("--heading", help="headings and links, #RRGGBB")
    p.add_argument("--paper", help="ordinary slide background, #RRGGBB")
    p.add_argument("--accent", help="rules and highlights, #RRGGBB")
    p.add_argument("--font", help="CSS font stack")
    p.add_argument("--footer-label", help="footer text, without quotes")
    p.add_argument("--description", help="one-line description shown by new_deck.sh --list")
    p.add_argument("--decor-image", help="optional decorative image, NOT a logo")
    args = p.parse_args()

    if not any(vars(args).values()):
        print(CSS.read_text() if CSS.exists() else f"no {CSS}")
        return

    # Start from the shipped palette so omitted flags keep sensible values.
    current = CSS.read_text() if CSS.exists() else ""
    def token(name: str, default: str) -> str:
        m = re.search(rf"^\s*{re.escape(name)}:\s*(.*?);\s*$", current, re.M)
        return m.group(1).strip() if m else default

    primary = args.primary or token("--primary", "#2E3230")
    heading = args.heading or token("--heading", "#9A6516")
    paper = args.paper or token("--paper", "#FFFDF7")
    accent = args.accent or token("--accent", "#C8892B")
    font = args.font or token("--font", "Arial, Helvetica, sans-serif")
    footer = args.footer_label or token("--footer-label", '"Study group"').strip('"')
    description = args.description or token("--description", "") or (
        "No logo; personal colours for study-group decks"
    )

    for name, value in (("primary", primary), ("heading", heading),
                        ("paper", paper), ("accent", accent)):
        if not HEX.match(value):
            p.error(f"--{name} must be #RRGGBB, got {value!r}")

    extra = ""
    decor = ""
    if args.decor_image:
        src = Path(args.decor_image).expanduser().resolve()
        if not src.is_file():
            p.error(f"decor image not found: {src}")
        BRAND_DIR.mkdir(parents=True, exist_ok=True)
        name = "decor" + src.suffix.lower()
        shutil.copy2(src, BRAND_DIR / name)
        extra = name
        decor = f"url('brand/personal/{name}')"

    on_primary = paper if luminance(primary) < 0.5 else "#1A1A1A"
    lines = [
        "/* brand-id: personal",
        "   name: Personal revision",
        f"   description: {description}",
        "   meta-line: Personal revision",
        "   logo: none",
    ]
    if extra:
        lines.append(f"   extra: {extra}")
    lines += [
        " */",
        ":root {",
        f"  --font: {font};",
        f"  --paper: {paper};",
        f"  --ink: {mix(primary, paper, 0.20)};",
        f"  --ink-strong: {primary};",
        f"  --muted: {mix(primary, paper, 0.48)};",
        f"  --heading: {heading};",
        f"  --primary: {primary};",
        f"  --on-primary: {on_primary};",
        f"  --on-primary-muted: {mix(on_primary, primary, 0.20)};",
        f"  --accent: {accent};",
        f"  --tint: {mix(accent, paper, 0.82)};",
        f"  --tint-ink: {primary};",
        f"  --rule: {mix(primary, paper, 0.85)};",
        f"  --zebra: {mix(paper, primary, 0.035)};",
        f"  --title-rule: {accent};",
        "  --title-rule-width: 3px;",
        f"  --neutral-head: {mix(primary, paper, 0.60)};",
        "  --logo: none;",
        "  --logo-on-dark: none;",
        "  --logo-width: 0px;",
        f"  --decor-image: {decor or 'none'};",
        f'  --footer-label: "{footer}";',
        "}",
        "",
    ]
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    CSS.write_text("\n".join(lines))
    print(f"configured personal brand: {CSS}")
    print(f"palette: primary {primary}, heading {heading}, paper {paper}, accent {accent}")
    print(f"footer: {footer}; logo: none; decor: {decor or 'none'}")


if __name__ == "__main__":
    main()
