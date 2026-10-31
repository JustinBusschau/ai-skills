// Used by scaffold.sh. Finds every file a spec references (following $refs recursively,
// including into parent directories) and copies exactly those into the new project:
// a single-file spec to spec/openapi.yaml, a multi-file one to spec/source/ with its
// layout kept. With CHECK_ONLY set it only checks that every referenced file exists.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.SPEC);
const target = process.env.TARGET;
// A $ref value, double-quoted, single-quoted (either may contain spaces), or bare.
const REF = /["']?\$ref["']?\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}\]]+))/g;
const seen = new Set();
const missing = [];
const visit = (file) => {
  if (seen.has(file)) return;
  if (!fs.existsSync(file)) { missing.push(file); return; }
  seen.add(file);
  // Ignore whole-line YAML comments, so a commented-out $ref is not followed.
  const text = fs.readFileSync(file, 'utf8').replace(/^[ \t]*#.*$/gm, '');
  for (const m of text.matchAll(REF)) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? '').split('#')[0];
    if (!ref) continue; // a reference within the same file
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue; // http:, https:, file: and similar
    let decoded = ref;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      // keep it as written
    }
    visit(path.resolve(path.dirname(file), decoded));
  }
};
visit(root);
if (missing.length) {
  // Possibly not real references (a $ref quoted inside a description or example), so
  // do not abort: report them, and let npm run bundle:spec / check:spec decide.
  console.warn(
    `Warning: these files are referenced but do not exist (if they are real references, npm run bundle:spec will fail):\n  ${missing.join('\n  ')}`,
  );
}
if (process.env.CHECK_ONLY) process.exit(0);
if (seen.size === 1) {
  fs.copyFileSync(root, path.join(target, 'spec', 'openapi.yaml'));
  process.exit(0);
}
// Common ancestor directory of every referenced file.
let common = path.dirname(root).split(path.sep);
for (const file of seen) {
  const parts = path.dirname(file).split(path.sep);
  let i = 0;
  while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
  common = common.slice(0, i);
}
const base = common.join(path.sep) || path.sep;
for (const file of seen) {
  const dest = path.join(target, 'spec', 'source', path.relative(base, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
fs.writeFileSync(path.join(target, 'spec', 'source', '.root'), `${path.relative(base, root)}\n`);
fs.writeFileSync(path.join(target, 'spec', '.multi-file'), '');
console.log(`Copied ${seen.size} spec files into spec/source/.`);
