#!/usr/bin/env bash
# Render a branded Hi Mum Said Dad Marp deck (one started by new_deck.sh).
#
# Usage: render.sh <deck.md> [--pdf] [--png] [--force]
#
# 1. Converts every diagrams/*.mmd beside the deck to SVG with the shared
#    Mermaid config, when the SVG is missing or older than its source or the
#    config.
# 2. Renders the deck to HTML with raw HTML enabled (for .cols, .note and
#    .sources blocks).
# 3. Optionally renders a PDF and/or one PNG per slide for visual checking.
# 4. Runs check_overflow.mjs and reports slides that overflow.
#
# It never overwrites a file it did not create. Every file it writes is listed
# in .render-manifest beside the deck; an existing output that is not in
# that list (a hand-made export, or an SVG copied in from elsewhere) stops the
# run before anything is written, unless --force is given.
#
# Exit codes:
#   0  rendered, and the overflow check passed
#   1  unexpected failure (a command inside the script failed; see stderr)
#   2  usage error, a required tool (marp, mmdc, node) is missing, or the
#      brand logos the deck refers to are missing
#   3  HTML rendered, but verification could not run: no usable browser for
#      the PDF/PNG step or the overflow check
#   4  refused to overwrite files render.sh did not create (listed on stderr)
#   5  rendered, but one or more slides overflow (listed on stdout)
#
# Written for the bash 3.2 that ships with macOS: empty arrays are expanded
# with ${a[@]+"${a[@]}"} so set -u does not treat them as unbound.
set -euo pipefail
trap 'echo "render.sh: unexpected failure at line $LINENO" >&2' ERR

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cfg="$here/../assets/mermaid-config.json"
deck="${1:?usage: render.sh <deck.md> [--pdf] [--png] [--force]}"
shift || true
want_pdf=false
want_png=false
force=false
for arg in "$@"; do
  case "$arg" in
    --pdf) want_pdf=true ;;
    --png) want_png=true ;;
    --force) force=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[[ -f "$deck" ]] || { echo "deck not found: $deck" >&2; exit 2; }
command -v marp >/dev/null || { echo "marp not found: npm i -g @marp-team/marp-cli" >&2; exit 2; }
command -v node >/dev/null || { echo "node not found: install Node.js 18 or later" >&2; exit 2; }

deck_dir="$(cd "$(dirname "$deck")" && pwd)"
deck_name="$(basename "$deck" .md)"

# The brand stylesheet points at logos under brand/<id>/ beside the deck.
# A missing logo renders as a blank corner, not an error, so check first.
missing=()
while IFS= read -r rel; do
  [[ -f "$deck_dir/$rel" ]] || missing+=("$rel")
done < <(grep -o "url('brand/[^']*')" "$deck" | sed "s/^url('//; s/')$//" | sort -u)
if (( ${#missing[@]} > 0 )); then
  echo "missing brand files beside the deck:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  brand_id="$(echo "${missing[0]}" | cut -d/ -f2)"
  echo "restore them with: $here/new_deck.sh $brand_id $deck --assets-only" >&2
  exit 2
fi
manifest="$deck_dir/.render-manifest"
# Older versions of this skill used a brand-specific manifest name. Migrate it
# once so existing decks keep their render history without a manual step.
if [[ ! -e "$manifest" && -e "$deck_dir/.hmsd-render-manifest" ]]; then
  mv "$deck_dir/.hmsd-render-manifest" "$manifest"
fi
touch "$manifest"

in_manifest() { grep -Fxq "$1" "$manifest"; }
record() { in_manifest "$1" || echo "$1" >> "$manifest"; }

shopt -s nullglob
mmd_files=("$deck_dir"/diagrams/*.mmd)
if (( ${#mmd_files[@]} > 0 )); then
  command -v mmdc >/dev/null || { echo "mmdc not found: npm i -g @mermaid-js/mermaid-cli" >&2; exit 2; }
fi

# Work out every file this run will write, then refuse before writing any of
# them if one already exists and was not created by an earlier run.
targets=("$deck_name.html")
$want_pdf && targets+=("$deck_name.pdf")
for src in ${mmd_files[@]+"${mmd_files[@]}"}; do targets+=("diagrams/$(basename "${src%.mmd}").svg"); done

if ! $force; then
  conflicts=()
  for rel in "${targets[@]}"; do
    [[ -e "$deck_dir/$rel" ]] && ! in_manifest "$rel" && conflicts+=("$rel")
  done
  if (( ${#conflicts[@]} > 0 )); then
    echo "refusing to overwrite files that render.sh did not create:" >&2
    for rel in "${conflicts[@]}"; do
      case "$rel" in
        *.svg) echo "  $rel (probably copied from the source; it will not be in the house diagram style. Delete it so it is re-rendered from its .mmd)" >&2 ;;
        *) echo "  $rel" >&2 ;;
      esac
    done
    echo "move or delete them, choose another deck name, or rerun with --force" >&2
    exit 4
  fi
fi

for src in ${mmd_files[@]+"${mmd_files[@]}"}; do
  out="${src%.mmd}.svg"
  rel="diagrams/$(basename "$out")"
  if [[ ! -f "$out" || "$src" -nt "$out" || "$cfg" -nt "$out" ]] || ! in_manifest "$rel"; then
    echo "diagram: $(basename "$src") -> $(basename "$out")"
    mmdc -q -i "$src" -o "$out" -b white -c "$cfg"
    record "$rel"
  fi
done

marp --no-stdin --html --allow-local-files "$deck" -o "$deck_dir/$deck_name.html"
record "$deck_name.html"

no_browser() {
  echo "VERIFICATION UNAVAILABLE: $1 needs Chrome, Chromium, or Edge, and none could be launched." >&2
  echo "The HTML deck was rendered but has NOT been checked. Install Chrome, or set CHROME_PATH to a Chromium-based browser, and rerun." >&2
  exit 3
}

if $want_pdf; then
  marp --no-stdin --html --allow-local-files --pdf "$deck" -o "$deck_dir/$deck_name.pdf" || no_browser "PDF export"
  record "$deck_name.pdf"
fi
if $want_png; then
  mkdir -p "$deck_dir/.preview"
  rm -f "$deck_dir/.preview/$deck_name".*.png
  marp --no-stdin --html --allow-local-files --images png "$deck" -o "$deck_dir/.preview/$deck_name.png" || no_browser "PNG previews"
  echo "previews: $deck_dir/.preview/"
fi

# Overflow check runs against a throwaway "bare" render, which lays out every
# slide at once rather than one at a time like the presenter template.
# It sits beside the deck so relative image paths resolve, and is removed after.
bare="$deck_dir/.$deck_name.bare.html"
trap 'rm -f "$bare"' EXIT
marp --no-stdin --html --allow-local-files --template bare "$deck" -o "$bare" >/dev/null 2>&1 \
  || { echo "could not produce the bare render for the overflow check" >&2; exit 3; }
trap - ERR
set +e
node "$here/check_overflow.mjs" "$bare"
status=$?
set -e
exit "$status"
