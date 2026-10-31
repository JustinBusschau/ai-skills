// Confirms the Swagger UI files pinned in src/core/docs.ts still match their integrity
// hashes on the CDN. Needs network access, so it is not part of npm run verify; run it
// after changing the pinned version, or when the docs page shows only the fallback.
import { createHash } from 'node:crypto';
import { SWAGGER_UI } from '../src/core/docs.ts';

let failed = false;
for (const [url, expected] of [
  [SWAGGER_UI.script, SWAGGER_UI.scriptIntegrity],
  [SWAGGER_UI.css, SWAGGER_UI.cssIntegrity],
] as const) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const actual = `sha384-${createHash('sha384').update(Buffer.from(await res.arrayBuffer())).digest('base64')}`;
    const ok = actual === expected;
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${url}${ok ? '' : `\n     expected ${expected}\n     actual   ${actual}`}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
