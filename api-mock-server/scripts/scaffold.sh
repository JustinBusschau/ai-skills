#!/usr/bin/env bash
# Copies the mock runtime template into a new project directory and fills its placeholders.
# Usage: scaffold.sh <target-dir> <project-name> "<API title>" <path-to-openapi.yaml|json>
#
# A spec that $refs other files is copied, with exactly the files it references, into
# spec/source/, and `npm run bundle:spec` (after npm install) writes the single
# spec/openapi.yaml the mock uses. A single-file spec is copied straight there.
set -euo pipefail

if [ $# -ne 4 ]; then
  echo "Usage: $0 <target-dir> <project-name> \"<API title>\" <path-to-openapi.yaml|json>" >&2
  exit 2
fi
target=$1 name=$2 title=$3 spec=$4
here=$(cd "$(dirname "$0")/.." && pwd)

command -v node >/dev/null || { echo "Node.js is required (22.13 or later on 22.x, 24.x, or 26 or later)." >&2; exit 1; }
if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "Refusing to scaffold into non-empty directory: $target" >&2
  exit 1
fi
if [ ! -f "$spec" ]; then
  echo "Spec not found: $spec" >&2
  exit 1
fi
if ! [[ $name =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
  echo "Project name must be a lower-case npm package name, e.g. acme-wallet-mock" >&2
  exit 1
fi
case "$title" in
  *$'\n'*) echo "The API title must be a single line." >&2; exit 1 ;;
esac

# The target was empty (or absent) when we started, so on any failure from here on put
# it back that way: a re-run then works without the user having to clean up by hand.
created=0
[ -e "$target" ] || created=1
mkdir -p "$target"
target=$(cd "$target" && pwd)   # absolute from here on, whatever the caller's directory
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    if [ "$created" = 1 ]; then rm -rf "$target"; else find "$target" -mindepth 1 -delete 2>/dev/null || true; fi
    echo "Scaffold failed; $target has been left as it was." >&2
  fi
}
trap cleanup EXIT

# Resolve the spec's references before writing anything (CHECK_ONLY=1 below).
SPEC="$spec" TARGET="$target" CHECK_ONLY=1 node "$here/scripts/copy-spec.cjs"

cp -R "$here/assets/template/." "$target/"
mkdir -p "$target/spec"

# Copy the spec. If it $refs other files, copy exactly the files it references (followed
# recursively, including ones in parent directories) into spec/source/, keeping their
# relative layout, so `npm run bundle:spec` can resolve every reference. Nothing else
# from the source directory is copied. URL references are left for the bundler to fetch.
SPEC="$spec" TARGET="$target" node "$here/scripts/copy-spec.cjs"
if [ -f "$target/spec/.multi-file" ]; then multi_file=1; rm "$target/spec/.multi-file"; else multi_file=0; fi

# Fill placeholders with Node so any character in the title is escaped for the file it
# lands in: JSON in package.json, a single-quoted string in TypeScript, plain text elsewhere.
TITLE="$title" NAME="$name" TARGET="$target" node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const { TITLE, NAME, TARGET } = process.env;
const fill = (file, escape) => {
  const p = path.join(TARGET, file);
  const out = fs.readFileSync(p, 'utf8').replaceAll('__PROJECT_NAME__', escape(NAME)).replaceAll('__API_TITLE__', escape(TITLE));
  fs.writeFileSync(p, out);
};
fill('package.json', (v) => JSON.stringify(v).slice(1, -1));
fill('src/domain/index.ts', (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
fill('README.md', (v) => v);
JSON.parse(fs.readFileSync(path.join(TARGET, 'package.json'), 'utf8'));
EOF
cp "$target/.env.example" "$target/.env"

echo "Scaffolded $name in $target"
if [ "$multi_file" = 1 ]; then
  echo "The spec references other files; they were copied to spec/source/."
  echo "Next: cd $target && npm install && npm run bundle:spec"
else
  echo "Next: cd $target && npm install"
fi
