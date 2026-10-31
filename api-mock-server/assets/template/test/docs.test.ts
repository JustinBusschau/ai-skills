// Checks the browsable documentation: the annotated spec served to Swagger UI is still
// a valid OpenAPI document, points "Try it out" at this mock, and lists every test case
// under its own operation; the page pins Swagger UI with integrity hashes.
import { validate } from '@readme/openapi-parser';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatedChecks } from '../src/core/checks.ts';
import { getPointer } from '../src/core/contract.ts';
import { SWAGGER_UI } from '../src/core/docs.ts';
import type { Engine } from '../src/core/engine.ts';
import { domain } from '../src/domain/index.ts';
import { buildServer } from '../src/server.ts';

let app: FastifyInstance;
let engine: Engine;
beforeAll(async () => {
  ({ app, engine } = await buildServer());
});
afterAll(async () => {
  await app.close();
});

describe('docs', () => {
  it('serves an annotated spec that is still valid OpenAPI', async () => {
    const res = await app.inject({ method: 'GET', url: '/__mock/openapi.json', headers: { host: 'mock.test:4010' } });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    const result = await validate(structuredClone(doc));
    expect(result.valid, JSON.stringify((result as { errors?: unknown }).errors)).toBe(true);
    expect(doc.servers).toEqual([{ url: engine.contract.basePath || '/', description: expect.any(String) }]);
    for (const p of domain.personas) expect(doc.info.description).toContain(`\`${p.id}\``);
  });

  it('lists every scenario and generic response under its own operation, with a curl command', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/__mock/openapi.json', headers: { host: 'mock.test:4010' } })).json();
    for (const s of domain.scenarios) {
      const op = engine.contract.getOperation(s.operationId)!;
      const description: string = getPointer(doc, op.pointer).description;
      expect(description, s.id).toContain(`\`${s.id}\``);
      expect(description, s.id).toContain(`curl -X ${s.request.method} 'http://mock.test:4010${s.request.path}`);
      expect(description, s.id).toContain('-H "X-Mock-Session: ${MOCK_SESSION:?export MOCK_SESSION first}"');
      expect(description, s.id).toContain('-H "X-Mock-Control-Token: ${MOCK_CONTROL_TOKEN:?export MOCK_CONTROL_TOKEN first}"');
      expect(description, s.id).not.toContain('my-session');
    }
    for (const c of generatedChecks(engine.contract, domain)) {
      const op = engine.contract.getOperation(c.operationId)!;
      expect(getPointer(doc, op.pointer).description, c.id).toContain(`${c.status} when ${c.reason}`);
    }
  });

  it('serves Swagger UI pinned by version and integrity, allowing scripts only from that file and the page', async () => {
    const res = await app.inject({ method: 'GET', url: '/__mock/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(`src="${SWAGGER_UI.script}" integrity="${SWAGGER_UI.scriptIntegrity}" crossorigin="anonymous"`);
    expect(res.body).toContain(`href="${SWAGGER_UI.css}" integrity="${SWAGGER_UI.cssIntegrity}" crossorigin="anonymous"`);
    expect(SWAGGER_UI.script).toContain(`@${SWAGGER_UI.version}/`);
    const csp = String(res.headers['content-security-policy']);
    // Exactly the pinned file, not the whole CDN host.
    expect(csp).toMatch(new RegExp(`script-src 'nonce-[^']+' ${SWAGGER_UI.script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
    expect(csp).not.toMatch(/https:\/\/cdn\.jsdelivr\.net[ ;]/);
    expect(csp).toContain("connect-src 'self'");
    const nonce = /nonce-([^']+)'/.exec(csp)![1];
    expect(res.body).toContain(`<script nonce="${nonce}">`);
  });

  it('does not serve docs outside /__mock', async () => {
    expect((await app.inject({ method: 'GET', url: '/docs' })).headers['content-type']).not.toContain('text/html');
  });
});
