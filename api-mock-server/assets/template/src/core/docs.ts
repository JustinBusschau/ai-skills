// Browsable documentation at /__mock/docs: Swagger UI (pinned version from
// cdn.jsdelivr.net, with Subresource Integrity) rendering /__mock/openapi.json, which is
// the contract with the mock's test cases written into it:
//   - info.description gains the personas, sessions, clock, and forcing controls;
//   - each operation's description gains its scenarios, generic responses, and a
//     ready-to-run curl command per scenario;
//   - servers points at this mock, so "Try it out" calls it.
// A toolbar above Swagger UI sets X-Mock-Session, a persona's credentials, and
// X-Mock-Scenario on every "Try it out" request. Everything is generated from the
// registry and the contract, so it cannot drift from the running code.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generatedChecks } from './checks.ts';
import { basePathFromSpec, config } from './config.ts';
import { getPointer } from './contract.ts';
import type { Engine } from './engine.ts';
import { BUILT_INS } from './scenarios.ts';
import type { Scenario, ScenarioRequest } from './types.ts';

// Pinned so the integrity hashes below stay valid. To upgrade, change the version and
// recompute both hashes (see references/runtime.md, "Upgrading Swagger UI").
export const SWAGGER_UI = {
  version: '5.34.0',
  script: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.0/swagger-ui-bundle.js',
  scriptIntegrity: 'sha384-9Td7MKiIr2S83E1kZyyVi8KdJw/S8CpAvu0llLyMeg0xq/hDGiZJfVn0fV4llCmK',
  css: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.0/swagger-ui.css',
  cssIntegrity: 'sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF',
};

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Absolute origin for curl examples: MOCK_PUBLIC_URL, else the request's own host. */
function originOf(req: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? req.protocol;
  return `${proto}://${req.headers.host ?? `${config.host}:${config.port}`}`;
}

export function registerDocs(app: FastifyInstance, engine: Engine, canReadCatalogue: (req: FastifyRequest, reply: FastifyReply) => boolean) {
  const { contract, domain } = engine;

  // Commands use shell variables for the session (so each person works in their own
  // copy of the data) and, where the control plane needs it, the control token.
  // ${VAR:?message} makes the shell stop with that message when the variable is unset,
  // rather than curl silently dropping the header and acting on the shared session.
  const SESSION_ARG = `-H "X-Mock-Session: \${MOCK_SESSION:?export MOCK_SESSION first}"`;
  const controlArgs = () => `${SESSION_ARG} -H "X-Mock-Control-Token: \${MOCK_CONTROL_TOKEN:?export MOCK_CONTROL_TOKEN first}"`;
  // Scenario paths are written against the spec's own base path; follow MOCK_BASE_PATH.
  const specBase = basePathFromSpec();
  const withBase = (path: string) =>
    config.basePath !== specBase && (path === specBase || path.startsWith(`${specBase}/`)) ? config.basePath + path.slice(specBase.length) : path;

  function curl(origin: string, r: ScenarioRequest, extraHeaders: Record<string, string> = {}): string {
    const qs = r.query ? `?${new URLSearchParams(r.query)}` : '';
    const form = r.contentType === 'application/x-www-form-urlencoded';
    const headers: Record<string, string> = {
      ...(r.persona ? domain.authHeadersFor(r.persona) : {}),
      ...(r.body !== undefined ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),
      ...(r.headers ?? {}),
      ...extraHeaders,
    };
    const multipart = r.contentType === 'multipart/form-data';
    if (multipart) delete headers['Content-Type']; // curl -F sets it, with the boundary
    const control = r.path.startsWith('/__mock');
    const parts = [
      `curl -X ${r.method} ${shellQuote(origin + (control ? r.path : withBase(r.path)) + qs)}`,
      control ? controlArgs() : SESSION_ARG,
      ...Object.entries(headers).map(([k, v]) => `-H ${shellQuote(`${k}: ${v}`)}`),
    ];
    if (r.body !== undefined && multipart) {
      for (const [k, v] of Object.entries(r.body as Record<string, unknown>)) {
        const file = (v as { $file?: { filename: string; contentType: string } })?.$file;
        if (file) parts.push(`-F ${shellQuote(`${k}=@${file.filename};type=${file.contentType}`)}`);
        else if (v && typeof v === 'object') parts.push(`-F ${shellQuote(`${k}=${JSON.stringify(v)};type=application/json`)}`);
        else parts.push(`-F ${shellQuote(`${k}=${String(v)}`)}`);
      }
    } else if (r.body !== undefined && form) {
      for (const [k, v] of Object.entries(r.body as Record<string, unknown>)) {
        for (const item of Array.isArray(v) ? v : [v]) parts.push(`--data-urlencode ${shellQuote(`${k}=${String(item)}`)}`);
      }
    } else if (r.body !== undefined) parts.push(`-d ${shellQuote(JSON.stringify(r.body))}`);
    return parts.join(' \\\n  ');
  }

  function scenarioExample(origin: string, s: Scenario): string {
    const lines: string[] = [];
    // Start from the seed data, so the commands give the documented outcome every time.
    lines.push('# start from the seed data', `curl -X POST ${shellQuote(`${origin}/__mock/reset`)} ${controlArgs()}`);
    for (const step of s.setup ?? []) lines.push('# setup', curl(origin, step));
    if (s.advanceClockSeconds) {
      lines.push(
        `# advance this session's clock ${s.advanceClockSeconds}s`,
        `curl -X POST ${shellQuote(`${origin}/__mock/clock/advance`)} \\\n  ${controlArgs()} -H 'Content-Type: application/json' \\\n  -d '{"seconds": ${s.advanceClockSeconds}}'`,
      );
    }
    lines.push('# the call under test');
    lines.push(curl(origin, s.request, s.trigger === 'header' ? { 'X-Mock-Scenario': s.id } : {}));
    return lines.join('\n');
  }

  function intro(origin: string, original?: string): string {
    const personas = domain.personas
      .map((p) => `| \`${p.id}\` | ${cell(p.summary)} | ${Object.entries(p.credentials).map(([k, v]) => `${k}: \`${v}\``).join('<br>')} | ${p.resetOnSignIn ? 'yes' : 'no'} |`)
      .join('\n');
    const builtIns = BUILT_INS.map((b) => `| \`${b.id}\` | ${cell(b.summary)} |`).join('\n');
    return [
      `**This is a mock.** It holds state per session, validates every request and response against this contract, and can be driven into every documented outcome. Each operation below lists its test cases with a ready-to-run \`curl\` command.`,
      '',
      `Use the toolbar at the top of this page to choose a **session**, a **persona** (sends that persona's credentials), and optionally a **scenario** to force; they apply to every "Try it out" request. Or use the Authorize button to send your own credentials.`,
      '',
      'Before running the `curl` examples, set your own session id and the control token (on a local mock it is printed when the server starts and saved in `.mock-tokens`):',
      '',
      '```bash',
      'export MOCK_SESSION=<your-name>',
      'export MOCK_CONTROL_TOKEN=<the control token>',
      '```',
      '',
      '### Personas',
      '',
      '| Persona | What it represents | Credentials | Resets on sign-in |',
      '| --- | --- | --- | --- |',
      personas || '| (none) | | | |',
      '',
      '### Sessions, time, and forcing outcomes',
      '',
      `- \`X-Mock-Session: <id>\` gives you your own copy of the seeded data; \`POST ${origin}/__mock/reset\` restores it.`,
      `- \`POST ${origin}/__mock/clock/advance {"seconds": N}\` moves your session's clock forward, so delayed outcomes (reviews, settlements, expiries) arrive immediately. \`/__mock/clock/freeze\` stops the clock for reproducible runs.`,
      `- \`X-Mock-Scenario: <id>\` forces an outcome for one request; \`POST ${origin}/__mock/arm\` forces the next calls for clients that cannot add headers.`,
      `- \`GET ${origin}/__mock/state\` and \`GET ${origin}/__mock/requests\` show what happened in your session.`,
      '',
      ...(Object.keys(domain.actions ?? {}).length
        ? [
            '### Off-app events',
            '',
            `Things only the real back office could do, triggered with \`POST ${origin}/__mock/actions/<name>\` (control token, \`X-Mock-Session\`):`,
            '',
            '| Action | What it does | Body |',
            '| --- | --- | --- |',
            ...Object.entries(domain.actions ?? {}).map(([name, a]) => `| \`${name}\` | ${cell(a.summary)} | ${cell(a.input ?? '(none)')} |`),
            '',
          ]
        : []),
      ...(Object.keys(domain.providers ?? {}).length
        ? [
            '### Simulated provider pages',
            '',
            `The URLs the API returns for ${Object.values(domain.providers ?? {}).map((p) => p.title).join(', ')} open mock pages with outcome buttons; choosing one updates the mock and redirects to your returnUrl.`,
            '',
          ]
        : []),
      '### Built-in scenarios (every operation)',
      '',
      '| Id | Effect |',
      '| --- | --- |',
      builtIns,
      ...(original ? ['', '---', '', '### About the API', '', original] : []),
    ].join('\n');
  }

  function operationNotes(origin: string, operationId: string): string {
    const scenarios = domain.scenarios.filter((s) => s.operationId === operationId).sort((a, b) => a.status - b.status);
    const checks = generatedChecks(contract, domain).filter((c) => c.operationId === operationId);
    const out: string[] = ['', '---', '', '#### Mock test cases', ''];
    if (scenarios.length) {
      out.push('| Status | Error code | Scenario id | Outcome | How to trigger |', '| --- | --- | --- | --- | --- |');
      for (const s of scenarios) out.push(`| ${s.status} | ${s.errorCode ? `\`${s.errorCode}\`` : ''} | \`${s.id}\` | ${cell(s.summary)} | ${cell(s.how)} |`);
    } else {
      out.push('_No scenarios are registered for this operation; it answers from the spec examples._');
    }
    if (checks.length) {
      out.push('', `**Generic responses:** ${checks.map((c) => `${c.status} when ${c.reason}${c.documented ? '' : ' (not documented in the contract; the mock sends it anyway)'}`).join('; ')}.`);
    }
    for (const s of scenarios) out.push('', `**\`${s.id}\`**`, '', '```bash', scenarioExample(origin, s), '```');
    return out.join('\n');
  }

  function docsSpec(origin: string) {
    // The spec as written: contract.doc has been normalised for Ajv and is not valid OpenAPI 3.0.
    const doc = structuredClone(contract.source);
    doc.info = { ...doc.info, description: intro(origin, doc.info?.description) };
    // Relative, so "Try it out" goes to whichever host served this page. Path- and
    // operation-level servers are removed too: the mock serves every operation under
    // one base path, and leaving them would point "Try it out" at the real API.
    doc.servers = [{ url: config.basePath || '/', description: `${domain.name} (this server)` }];
    // Path items may be inline, or (OpenAPI 3.1) references into components.pathItems.
    const pathItems = new Set<any>([...Object.values<any>(doc.paths ?? {}), ...Object.values<any>(doc.components?.pathItems ?? {})]);
    for (const raw of pathItems) {
      const item = raw && typeof raw.$ref === 'string' ? getPointer(doc, raw.$ref) : raw;
      if (!item || typeof item !== 'object') continue;
      const notes: string[] = [];
      if (item.servers) {
        notes.push(`path-level servers ${item.servers.map((x: any) => x.url).join(', ')}`);
        delete item.servers;
      }
      for (const m of ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']) {
        if (item[m]?.servers) {
          item[m].description = `${item[m].description ?? ''}\n\n_The real API serves this operation from ${item[m].servers.map((x: any) => x.url).join(', ')}; the mock serves it under its common base path._`;
          delete item[m].servers;
        }
        if (notes.length && item[m]) item[m].description = `${item[m].description ?? ''}\n\n_The real API serves this path from ${notes.join('; ')}; the mock serves it under its common base path._`;
      }
    }
    for (const op of contract.operations) {
      const target = getPointer(doc, op.pointer);
      if (!target) continue;
      if (domain.webhookOperations?.includes(op.operationId)) {
        target.description = `${target.description ?? ''}\n\n_This documents a webhook the API sends; the mock does not serve it. Fire it with \`POST ${origin}/__mock/webhooks/trigger\`._`;
        continue;
      }
      target.description = `${target.description ?? ''}${operationNotes(origin, op.operationId)}`;
    }
    for (const [name, item] of Object.entries<any>(doc.webhooks ?? {})) {
      const trigger = Object.keys(domain.webhookTriggers ?? {}).find((t) => (domain.webhookContracts?.[t] ?? t) === name);
      for (const m of ['post', 'put', 'patch', 'get', 'delete']) {
        if (!item?.[m]) continue;
        const how = trigger
          ? `Fire it on demand: \`curl -X POST '${origin}/__mock/webhooks/trigger' ${controlArgs()} -H 'Content-Type: application/json' -d '{"event": "${trigger}"}'\`, after registering a target with \`POST /__mock/webhooks/target\`.`
          : 'The mock has no on-demand trigger for this webhook.';
        item[m].description = `${item[m].description ?? ''}\n\n---\n\n#### Mock\n\n${how}`;
      }
    }
    return doc;
  }

  app.get(`/__mock/openapi.json`, async (req, reply) => {
    if (!canReadCatalogue(req, reply)) return;
    return reply.header('cache-control', 'no-store').send(docsSpec(originOf(req)));
  });

  app.get(`/__mock/docs`, async (req, reply) => {
    if (!canReadCatalogue(req, reply)) return;
    const nonce = randomBytes(16).toString('base64');
    const data = {
      title: domain.name,
      specUrl: '/__mock/openapi.json',
      personas: domain.personas.map((p) => ({ id: p.id, summary: p.summary, headers: domain.authHeadersFor(p.id) })),
      // Only what can actually be forced; other scenarios are reached by persona or input.
      scenarios: domain.scenarios.filter((s) => s.trigger === 'header').map((s) => ({ id: s.id, operationId: s.operationId })),
      builtIns: BUILT_INS.map((b) => b.id).filter((id) => !id.includes('<')),
    };
    reply
      .header(
        'content-security-policy',
        [
          "default-src 'self'",
          // Only the one pinned file from the CDN, not everything jsDelivr hosts.
          `script-src 'nonce-${nonce}' ${SWAGGER_UI.script}`,
          // Swagger UI sets inline style attributes, which a nonce cannot cover.
          `style-src 'self' 'unsafe-inline' ${SWAGGER_UI.css}`,
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; '),
      )
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(docsHtml(nonce, data));
  });
}

function docsHtml(nonce: string, data: Record<string, unknown>): string {
  // JSON inside a script element: escape "<" so no value can close the element.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = String(data.title).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: docs</title>
<link rel="stylesheet" href="${SWAGGER_UI.css}" integrity="${SWAGGER_UI.cssIntegrity}" crossorigin="anonymous">
<style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #mock-toolbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: end;
    padding: 12px 20px; background: #1f2937; color: #f9fafb; font-size: 14px; }
  #mock-toolbar label { display: flex; flex-direction: column; gap: 4px; }
  #mock-toolbar input, #mock-toolbar select { font: inherit; padding: 4px 6px; min-width: 200px; border-radius: 4px; border: 1px solid #6b7280; }
  #mock-toolbar button { font: inherit; padding: 5px 12px; border-radius: 4px; border: 0; background: #f9fafb; color: #1f2937; cursor: pointer; }
  #mock-toolbar .note { flex-basis: 100%; color: #d1d5db; font-size: 12px; }
  #mock-toolbar a { color: #93c5fd; }
  #mock-fallback { padding: 20px; }
</style>
</head>
<body>
<div id="mock-toolbar" role="region" aria-label="Mock request settings">
  <label>Session <input id="mock-session" placeholder="default" autocomplete="off"></label>
  <label>Persona <select id="mock-persona"><option value="">None (use Authorize)</option></select></label>
  <label>Force scenario <input id="mock-scenario" list="mock-scenario-ids" placeholder="none" autocomplete="off"></label>
  <datalist id="mock-scenario-ids"></datalist>
  <label>Control token <input id="mock-token" type="password" placeholder="for Reset" autocomplete="off"></label>
  <button id="mock-reset" type="button">Reset this session</button>
  <span id="mock-status" role="status"></span>
  <span class="note">Session, persona, and scenario apply to every "Try it out" request; only scenarios that can be forced are listed (the rest are reached by persona or input, as each operation describes). The control token (printed when the mock starts, and saved in .mock-tokens on a local mock) is kept only for this tab and sent only to /__mock/reset. Catalogue as JSON: <a href="/__mock/personas">personas</a>, <a href="/__mock/scenarios">scenarios</a>, <a href="/__mock/openapi.json">annotated spec</a>, <a href="/__mock/">overview</a>.</span>
</div>
<div id="mock-fallback">Loading Swagger UI from cdn.jsdelivr.net. If this message stays, the CDN cannot be reached from this browser; the same test cases are listed at <a href="/__mock/scenarios">/__mock/scenarios</a> and in SCENARIOS.md in the mock's repository.</div>
<div id="swagger-ui"></div>
<script src="${SWAGGER_UI.script}" integrity="${SWAGGER_UI.scriptIntegrity}" crossorigin="anonymous"></script>
<script nonce="${nonce}">
(function () {
  var DATA = ${json};
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem('mock-docs:' + k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem('mock-docs:' + k, v); } catch (e) {} }
  };
  DATA.personas.forEach(function (p) {
    var o = document.createElement('option'); o.value = p.id; o.textContent = p.id + ': ' + p.summary; $('mock-persona').appendChild(o);
  });
  DATA.scenarios.map(function (s) { return s.id; }).concat(DATA.builtIns).forEach(function (id) {
    var o = document.createElement('option'); o.value = id; $('mock-scenario-ids').appendChild(o);
  });
  ['session', 'persona', 'scenario'].forEach(function (k) {
    var el = $('mock-' + k); el.value = store.get(k);
    el.addEventListener('change', function () { store.set(k, el.value.trim()); });
  });
  // Give each browser its own session by default, so two people trying things out do
  // not change each other's data. Clear the field to use the shared "default" session.
  if (!store.get('session-initialised')) {
    $('mock-session').value = 'docs-' + Math.random().toString(36).slice(2, 8);
    store.set('session', $('mock-session').value);
    store.set('session-initialised', '1');
  }
  var tokenStore = {
    get: function () { try { return sessionStorage.getItem('mock-docs:token') || ''; } catch (e) { return ''; } },
    set: function (v) { try { sessionStorage.setItem('mock-docs:token', v); } catch (e) {} }
  };
  $('mock-token').value = tokenStore.get();
  $('mock-token').addEventListener('change', function () { tokenStore.set($('mock-token').value.trim()); });
  $('mock-reset').addEventListener('click', function () {
    var session = $('mock-session').value.trim();
    var token = $('mock-token').value.trim();
    if (!token) { $('mock-status').textContent = 'Enter the control token first.'; return; }
    var headers = { 'X-Mock-Control-Token': token };
    if (session) headers['X-Mock-Session'] = session;
    // credentials: 'omit' so the browser never shows its own login prompt for this call.
    fetch('/__mock/reset', { method: 'POST', headers: headers, credentials: 'omit' })
      .then(function (r) {
        $('mock-status').textContent = r.ok ? 'Session "' + (session || 'default') + '" reset.'
          : r.status === 401 ? 'Reset refused: check the control token.' : 'Reset failed (' + r.status + ').';
      });
  });
  if (typeof window.SwaggerUIBundle !== 'function') return;
  $('mock-fallback').remove();
  window.SwaggerUIBundle({
    url: DATA.specUrl,
    dom_id: '#swagger-ui',
    deepLinking: true,
    validatorUrl: null,
    tryItOutEnabled: true,
    persistAuthorization: true,
    requestInterceptor: function (req) {
      if (req.url.indexOf('/__mock/') !== -1) return req;
      var session = $('mock-session').value.trim();
      var scenario = $('mock-scenario').value.trim();
      var persona = DATA.personas.filter(function (p) { return p.id === $('mock-persona').value; })[0];
      if (session) req.headers['X-Mock-Session'] = session;
      if (scenario) req.headers['X-Mock-Scenario'] = scenario;
      if (persona) Object.keys(persona.headers).forEach(function (h) { req.headers[h] = persona.headers[h]; });
      return req;
    }
  });
})();
</script>
</body>
</html>`;
}
