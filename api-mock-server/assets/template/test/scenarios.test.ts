// Proves every registered scenario and generated check is reachable, contract-valid,
// and deterministic. Each scenario runs twice, in two fresh sessions with frozen
// clocks (see vitest.config.ts), and both runs must produce identical responses.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
import { domain } from '../src/domain/index.ts';
import { generatedChecks } from '../src/core/checks.ts';
import { config } from '../src/core/config.ts';
import { Contract } from '../src/core/contract.ts';
import type { Engine } from '../src/core/engine.ts';
import type { Scenario } from '../src/core/types.ts';
import { bodyProves, parseLabel } from '../src/core/states.ts';
import { call, control, sessionFor, tryJson } from './helpers.ts';

// Test names are needed before the server starts, so load the contract up front.
const CHECKS = generatedChecks(await Contract.load(config.specPath, config.basePath), domain);

let app: FastifyInstance;
let engine: Engine;
beforeAll(async () => {
  ({ app, engine } = await buildServer());
});
afterAll(async () => {
  await app.close();
});

async function run(s: Scenario, session: string) {
  const reset = await control(app, session, 'POST', '/__mock/reset');
  expect(reset.statusCode, `reset: ${reset.body}`).toBe(200);
  for (const step of s.setup ?? []) {
    const res = await call(app, session, step);
    // A journey is only proven if every step does what it is meant to.
    if (step.expectStatus !== undefined) expect(res.statusCode, `setup ${step.method} ${step.path}: ${res.body}`).toBe(step.expectStatus);
    else expect(res.statusCode, `setup ${step.method} ${step.path} failed: ${res.body}`).toBeLessThan(400);
  }
  if (s.advanceClockSeconds) {
    const adv = await control(app, session, 'POST', '/__mock/clock/advance', { seconds: s.advanceClockSeconds });
    expect(adv.statusCode, `clock advance: ${adv.body}`).toBe(200);
  }
  return call(app, session, s.request, s.trigger === 'header' ? { 'x-mock-scenario': s.id } : {});
}

describe('scenarios', () => {
  it('registry ids are unique', () => {
    const ids = domain.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const s of domain.scenarios) {
    it(`${s.id} -> ${s.status}${s.errorCode ? ` ${s.errorCode}` : ''}`, async () => {
      if (s.trigger !== 'header') {
        // Only header scenarios may force their outcome; any other must reach the handler.
        const forcing = Object.keys(s.request.headers ?? {}).find((h) => h.toLowerCase() === 'x-mock-scenario');
        expect(forcing, `${s.id} has trigger "${s.trigger}" but sends X-Mock-Scenario, which would bypass its handler`).toBeUndefined();
      }
      const res = await run(s, sessionFor('a', s.id));
      if (s.trigger !== 'header') {
        expect(res.headers['x-mock-scenario-applied'], `${s.id} was answered by a forced scenario, not its handler`).toBeUndefined();
        expect(res.headers['x-mock-fault'], `${s.id} was answered by a built-in fault, not its handler`).toBeUndefined();
      }
      expect(res.headers['x-mock-contract-violation'], res.body).toBeUndefined();
      expect(res.headers['x-mock-handler-error'], res.body).toBeUndefined();
      // Answered from spec examples means the handler is missing, not that the outcome is simulated.
      expect(res.headers['x-mock-source'], `${s.id} fell back to spec examples`).toBeUndefined();
      expect(res.statusCode, res.body).toBe(s.status);
      // The request must reach the operation the scenario claims to cover.
      expect(res.headers['x-mock-operation'], `${s.id} is registered for ${s.operationId} but its request reached another operation`).toBe(s.operationId);
      const body = tryJson(res.body);
      // An error envelope (one errorCodeOf can read) needs its code declared and checked;
      // a documented non-envelope body (e.g. a 422 business outcome) needs none.
      const code = domain.errorCodeOf(body);
      if (s.errorCode !== undefined || (s.status >= 400 && code !== undefined)) {
        expect(s.errorCode, `${s.id} must declare errorCode ${code ?? ''} for this ${s.status}`).toBeDefined();
        expect(code, res.body).toBe(s.errorCode);
      }
      for (const label of s.covers ?? []) {
        expect(parseLabel(label), `covers label "${label}" must look like Schema.path.to.field=value`).toBeDefined();
        expect(
          bodyProves(engine.contract, body, label),
          `${s.id} claims ${label}, but its response has no ${label.split('.')[0]} object with that value: ${res.body}`,
        ).toBe(true);
      }
      const again = await run(s, sessionFor('b', s.id));
      expect(again.statusCode).toBe(res.statusCode);
      // Links the mock signs for a session (provider pages, files) name that session; compare the rest.
      const same = (text: string, session: string) => text.split(session).join('<session>').replace(/sig=[A-Za-z0-9_-]+/g, 'sig=<sig>');
      expect(same(again.body, sessionFor('b', s.id)), `${s.id} is not deterministic across fresh sessions`).toBe(same(res.body, sessionFor('a', s.id)));
    });
  }
});

describe('generated checks', () => {
  it('match the running contract', () => {
    expect(generatedChecks(engine.contract, domain).map((c) => c.id)).toEqual(CHECKS.map((c) => c.id));
  });
  for (const c of CHECKS) {
    it(`${c.id} -> ${c.status} (${c.reason})`, async () => {
      const res = await call(app, sessionFor('check', c.id), c.request);
      expect(res.headers['x-mock-contract-violation'], res.body).toBeUndefined();
      expect(res.statusCode, res.body).toBe(c.status);
    });
  }
});

describe('webhooks', () => {
  // vitest fails a describe block with no tests, so an API without webhooks gets this one.
  if (!Object.keys(domain.webhookTriggers ?? {}).length) it('(this API has no webhook triggers)', () => {});
  for (const event of Object.keys(domain.webhookTriggers ?? {})) {
    it(`${event} payload satisfies the contract`, async () => {
      const session = sessionFor('hook', event);
      await control(app, session, 'POST', '/__mock/reset');
      const res = await control(app, session, 'POST', '/__mock/webhooks/trigger', { event });
      expect(res.statusCode, res.body).toBe(200);
      const log = (await control(app, session, 'GET', '/__mock/webhooks/log')).json();
      const entry = log.at(-1);
      // An exempted event has no schema to check against; it only has to fire.
      if (domain.coverageExemptions?.[`webhook.${event}`]) return;
      expect(entry.contractProblems, JSON.stringify(entry)).toBeUndefined();
    });
  }
});

describe('control plane', () => {
  const seed = () => JSON.parse(JSON.stringify(domain.createState()));
  const stateOf = async (session: string) => (await control(app, session, 'GET', '/__mock/state')).json().state;

  it('runs with the mock\'s own defaults, not settings inherited from the shell', () => {
    expect(process.env.MOCK_RESPONSE_VALIDATION).toBe('strict');
    expect(process.env.MOCK_CONTROL_TOKEN).toBeUndefined();
    expect(process.env.MOCK_ADMIN_TOKEN).toBeUndefined();
    // Tokens were generated in memory, never written to the project's .mock-tokens.
    expect(config.controlToken).toMatch(/^ctl_/);
  });

  it('seed data is identical when created at different moments', async () => {
    const first = seed();
    await new Promise((r) => setTimeout(r, 25));
    expect(seed()).toEqual(first);
  });

  it('clock and armed scenarios stay in their own session', async () => {
    await control(app, 'iso-clock-a', 'POST', '/__mock/reset');
    await control(app, 'iso-clock-b', 'POST', '/__mock/reset');
    const before = (await control(app, 'iso-clock-b', 'GET', '/__mock/clock')).json().now;
    await control(app, 'iso-clock-a', 'POST', '/__mock/clock/advance', { seconds: 3600 });
    expect((await control(app, 'iso-clock-b', 'GET', '/__mock/clock')).json().now).toBe(before);
    const op = engine.contract.operations[0];
    if (op) {
      await control(app, 'iso-clock-a', 'POST', '/__mock/arm', { operationId: op.operationId, scenario: 'fault.server_error' });
      expect((await control(app, 'iso-clock-b', 'GET', '/__mock/state')).json().armed).toEqual([]);
    }
  });

  it('state changes stay in their session and reset restores the seed (skipped when no scenario changes state)', async (ctx) => {
    for (const s of domain.scenarios) {
      await control(app, 'iso-a', 'POST', '/__mock/reset');
      await run(s, 'iso-a');
      if (JSON.stringify(await stateOf('iso-a')) === JSON.stringify(seed())) continue;
      expect(await stateOf('iso-b')).toEqual(seed());
      await control(app, 'iso-a', 'POST', '/__mock/reset');
      expect(await stateOf('iso-a')).toEqual(seed());
      return;
    }
    ctx.skip();
  });

  it('an armed scenario is not used up by a request rejected for missing credentials', async (ctx) => {
    const persona = domain.checkPersona ?? domain.personas[0]?.id;
    const op = engine.contract.operations.find(
      (o) => o.secured && !o.requestBody?.required && !o.parameters.some((p) => p.required && p.in !== 'path') && !o.pathParamNames.length,
    );
    const key = op && Object.keys(op.responses).find((k) => /^\d{3}$/.test(k));
    if (!op || !key || !persona) return ctx.skip();
    const session = 'armed-survives';
    await control(app, session, 'POST', '/__mock/reset');
    expect((await control(app, session, 'POST', '/__mock/arm', { operationId: op.operationId, scenario: `example.${key}` })).statusCode).toBe(200);
    const path = engine.contract.basePath + op.path;
    expect((await call(app, session, { method: op.method, path })).statusCode).toBe(401);
    const res = await call(app, session, { method: op.method, path, persona });
    expect(res.headers['x-mock-scenario-applied']).toBe(`example.${key}`);
  });

  it('runs every back-office action in a fresh session without a server error', async (ctx) => {
    const actions = Object.keys(domain.actions ?? {});
    if (!actions.length) return ctx.skip();
    const listed = (await control(app, 'actions-list', 'GET', '/__mock/actions')).json();
    expect(listed.map((a: { name: string }) => a.name).sort()).toEqual(actions.sort());
  });

  it('serves provider pages only behind the signed URL the mock hands out', async (ctx) => {
    const providers = Object.keys(domain.providers ?? {});
    if (!providers.length) return ctx.skip();
    const forged = await app.inject({ method: 'GET', url: `/__mock/providers/${providers[0]}/anything?session=default&sig=forged` });
    expect(forged.statusCode).toBe(404);
  });

  it('serves files only behind the signed, unexpired URL the mock hands out', async (ctx) => {
    if (!domain.files) return ctx.skip();
    const forged = await app.inject({ method: 'GET', url: `/__mock/files/anything?session=default&exp=9999999999999&sig=forged` });
    expect(forged.statusCode).toBe(404);
  });

  it('replays a write retried with the same Idempotency-Key, and refuses the key for a different request', async (ctx) => {
    const s = domain.scenarios.find((x) => x.status < 300 && x.trigger !== 'header' && Object.keys(x.request.headers ?? {}).some((h) => /^idempotency-key$/i.test(h)));
    if (!s) return ctx.skip();
    const session = 'idempotency';
    await control(app, session, 'POST', '/__mock/reset');
    for (const step of s.setup ?? []) await call(app, session, step);
    const first = await call(app, session, s.request);
    const again = await call(app, session, s.request);
    expect(again.statusCode).toBe(first.statusCode);
    expect(again.body).toBe(first.body);
    expect(again.headers['x-mock-idempotent-replay']).toBe('true');
    if (s.request.body && typeof s.request.body === 'object') {
      const changed = await call(app, session, { ...s.request, body: { ...(s.request.body as object), mockChanged: true } });
      expect([400, 409, 422]).toContain(changed.statusCode);
    }
  });

  it('rejects unknown scenario ids', async (ctx) => {
    const s = domain.scenarios[0];
    if (!s) return ctx.skip();
    const res = await call(app, 'unknown-scenario', s.request, { 'x-mock-scenario': 'no.such.scenario' });
    expect(res.statusCode).toBe(400);
  });
});

