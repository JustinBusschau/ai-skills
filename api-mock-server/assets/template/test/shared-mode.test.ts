// Checks who may use the control plane: shared instances, loopback instances reached
// through a proxy or tunnel, cross-site browser requests, and catalogue access.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV = [
  'HOST',
  'MOCK_ADMIN_TOKEN',
  'MOCK_CONTROL_TOKEN',
  'MOCK_ALLOW_OPEN_CONTROL',
  'MOCK_WEBHOOK_ALLOWED_HOSTS',
  'MOCK_CATALOGUE_ACCESS',
  'MOCK_CONTROL_ORIGINS',
  'MOCK_CLOCK',
  'MOCK_CLOCK_START',
  'MOCK_TOKENS_FILE',
  'MOCK_BASE_PATH',
];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

async function serverWith(env: Record<string, string>) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  const { buildServer } = await import('../src/server.ts');
  const { config } = await import('../src/core/config.ts');
  return { ...(await buildServer()), config };
}

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type App = Awaited<ReturnType<typeof serverWith>>['app'];
const get = (app: App, url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
const post = (app: App, url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...headers }, payload: '{}' });
const basic = (password: string) => ({ authorization: `Basic ${Buffer.from(`tester:${password}`).toString('base64')}` });

describe('shared instance', () => {
  it('refuses to start without both tokens, even when a local .mock-tokens file exists', async () => {
    await expect(serverWith({ HOST: '0.0.0.0' })).rejects.toThrow(/MOCK_ADMIN_TOKEN and MOCK_CONTROL_TOKEN/);
    const dir = mkdtempSync(join(tmpdir(), 'mock-tokens-'));
    const file = join(dir, '.mock-tokens');
    writeFileSync(file, JSON.stringify({ admin: 'adm_local', control: 'ctl_local' }));
    await expect(serverWith({ HOST: '0.0.0.0', MOCK_TOKENS_FILE: file })).rejects.toThrow(/MOCK_ADMIN_TOKEN and MOCK_CONTROL_TOKEN/);
  });

  it('protects session and global operations, and disables webhook delivery by default', async () => {
    const { app } = await serverWith({ HOST: '0.0.0.0', MOCK_ADMIN_TOKEN: 'admin-t', MOCK_CONTROL_TOKEN: 'control-t' });
    expect((await get(app, '/__mock/scenarios')).statusCode).toBe(200);
    expect((await get(app, '/__mock/state')).statusCode).toBe(401);
    const state = await get(app, '/__mock/state', { 'x-mock-control-token': 'control-t' });
    expect(state.statusCode).toBe(200);
    expect(state.json().redacted).toBe(true);
    expect((await get(app, '/__mock/state', { 'x-mock-admin-token': 'admin-t' })).json().redacted).toBe(false);
    expect((await post(app, '/__mock/reset-all', { 'x-mock-control-token': 'control-t' })).statusCode).toBe(401);
    expect((await post(app, '/__mock/reset-all', { 'x-mock-admin-token': 'admin-t' })).statusCode).toBe(200);
    expect((await post(app, '/__mock/reset-all', { 'x-mock-admin-token': 'admin-x' })).statusCode).toBe(401);
    expect((await get(app, '/__mock/docs')).statusCode).toBe(200);
    const hook = await app.inject({
      method: 'POST',
      url: '/__mock/webhooks/target',
      headers: { 'content-type': 'application/json', 'x-mock-control-token': 'control-t' },
      payload: JSON.stringify({ url: 'http://127.0.0.1:8080/x' }),
    });
    expect(hook.statusCode).toBe(400);
    await app.close();
  });

  it('with MOCK_CATALOGUE_ACCESS=token, requires the control token for docs and the catalogue', async () => {
    const { app } = await serverWith({ HOST: '0.0.0.0', MOCK_ADMIN_TOKEN: 'admin-t', MOCK_CONTROL_TOKEN: 'control-t', MOCK_CATALOGUE_ACCESS: 'token' });
    for (const url of ['/__mock/', '/__mock/personas', '/__mock/scenarios', '/__mock/docs', '/__mock/openapi.json']) {
      const denied = await get(app, url);
      expect(denied.statusCode, url).toBe(401);
      expect(denied.headers['www-authenticate'], url).toMatch(/^Basic /);
      expect((await get(app, url, basic('wrong'))).statusCode, url).toBe(401);
      expect((await get(app, url, basic('control-t'))).statusCode, url).toBe(200);
      expect((await get(app, url, { 'x-mock-control-token': 'control-t' })).statusCode, url).toBe(200);
    }
    await app.close();
  });
});

describe('loopback instance', () => {
  it('requires a token for the control plane even on this machine, generating tokens when none are set', async () => {
    const { app, config, tokens } = await serverWith({});
    expect(tokens.generated).toBe(true);
    expect(config.controlToken).toMatch(/^ctl_/);
    expect(config.adminToken).toMatch(/^adm_/);
    // Looking local earns nothing: a TCP forwarder can make a remote caller look exactly like this.
    expect((await get(app, '/__mock/state')).statusCode).toBe(401);
    expect((await get(app, '/__mock/state', { host: 'localhost' })).statusCode).toBe(401);
    expect((await get(app, '/__mock/state', { 'x-mock-control-token': config.controlToken })).statusCode).toBe(200);
    expect((await post(app, '/__mock/reset-all', { 'x-mock-control-token': config.controlToken })).statusCode).toBe(401);
    expect((await post(app, '/__mock/reset-all', { 'x-mock-admin-token': config.adminToken })).statusCode).toBe(200);
    // The catalogue stays open by default.
    expect((await get(app, '/__mock/scenarios')).statusCode).toBe(200);
    await app.close();
  });

  it('uses tokens from the environment rather than generating them', async () => {
    const { app, config, tokens } = await serverWith({ MOCK_ADMIN_TOKEN: 'admin-t', MOCK_CONTROL_TOKEN: 'control-t' });
    expect(tokens.generated).toBe(false);
    expect(config.controlToken).toBe('control-t');
    await app.close();
  });

  it('saves generated tokens with owner-only permissions and reuses them on restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mock-tokens-'));
    const file = join(dir, '.mock-tokens');
    const first = await serverWith({ MOCK_TOKENS_FILE: file });
    await first.app.close();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.control).toBe(first.config.controlToken);
    const second = await serverWith({ MOCK_TOKENS_FILE: file });
    expect(second.tokens.generated).toBe(false);
    expect(second.config.controlToken).toBe(first.config.controlToken);
    await second.app.close();
  });

  it('needs the admin token for a webhook target on this machine, whoever asks', async () => {
    const { app, config } = await serverWith({});
    const target = (headers: Record<string, string>, url = 'http://localhost:5432/') =>
      app.inject({
        method: 'POST',
        url: '/__mock/webhooks/target',
        headers: { 'content-type': 'application/json', ...headers },
        payload: JSON.stringify({ url }),
      });
    // A TCP forwarder makes a remote caller indistinguishable from this one, so the control token is not enough.
    expect((await target({ 'x-mock-control-token': config.controlToken })).statusCode).toBe(401);
    expect((await target({ 'x-mock-control-token': config.controlToken, host: 'localhost' })).statusCode).toBe(401);
    expect((await target({ 'x-mock-admin-token': config.adminToken })).statusCode).toBe(200);
    await app.close();
  });

  it('refuses to force scenarios that are not header-triggered, and wildcard arming of domain scenarios', async () => {
    const { app, config, engine } = await serverWith({});
    const { domain } = engine;
    const ctl = { 'x-mock-control-token': config.controlToken, 'content-type': 'application/json' };
    const arm = (body: unknown) => app.inject({ method: 'POST', url: '/__mock/arm', headers: ctl, payload: JSON.stringify(body) });
    const plain = domain.scenarios.find((x) => x.trigger !== 'header');
    const header = domain.scenarios.find((x) => x.trigger === 'header');
    if (plain) {
      const res = await app.inject({ method: plain.request.method as 'GET', url: plain.request.path, headers: { 'x-mock-scenario': plain.id } });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('can be forced');
      expect((await arm({ operationId: plain.operationId, scenario: plain.id })).statusCode).toBe(400);
    }
    if (header) expect((await arm({ operationId: '*', scenario: header.id })).statusCode).toBe(400);
    expect((await arm({ operationId: '*', scenario: 'fault.unavailable' })).statusCode).toBe(200);
    await app.close();
  });

  it('opens every tier, admin and catalogue included, when MOCK_ALLOW_OPEN_CONTROL=true', async () => {
    const { app } = await serverWith({ MOCK_ALLOW_OPEN_CONTROL: 'true', MOCK_CATALOGUE_ACCESS: 'token' });
    expect((await get(app, '/__mock/state')).statusCode).toBe(200);
    expect((await post(app, '/__mock/reset-all')).statusCode).toBe(200);
    expect((await get(app, '/__mock/docs')).statusCode).toBe(200);
    await app.close();
  });

  it('allows every method a browser app needs in CORS preflights', async () => {
    const { app } = await serverWith({});
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.inject({ method: 'OPTIONS', url: '/any/api/path', headers: { origin: 'http://localhost:3000', 'access-control-request-method': method } });
      expect(res.headers['access-control-allow-methods'], method).toContain(method);
    }
    const ctl = await app.inject({ method: 'OPTIONS', url: '/__mock/arm', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'DELETE' } });
    expect(ctl.headers['access-control-allow-methods']).toContain('DELETE');
    await app.close();
  });

  it('refuses example.<status> for a status the operation does not document, without claiming it applied', async () => {
    const { app, config, engine } = await serverWith({});
    const op = engine.contract.operations.find((o) => !engine.contract.responseKey(o, 418) && !o.secured && !o.requestBody?.required);
    const ctl = { 'x-mock-control-token': config.controlToken, 'content-type': 'application/json' };
    const arm = (body: unknown) => app.inject({ method: 'POST', url: '/__mock/arm', headers: ctl, payload: JSON.stringify(body) });
    expect((await arm({ operationId: '*', scenario: 'example.418' })).statusCode).toBe(400);
    if (op) {
      expect((await arm({ operationId: op.operationId, scenario: 'example.418' })).statusCode).toBe(400);
      const res = await app.inject({ method: op.method as 'GET', url: engine.contract.basePath + op.path.replace(/\{[^}]+\}/g, 'x'), headers: { 'x-mock-scenario': 'example.418' } });
      expect(res.statusCode).toBe(400);
      expect(res.headers['x-mock-scenario-applied']).toBeUndefined();
      expect(res.headers['x-mock-contract-violation']).toBeUndefined();
    }
    await app.close();
  });
});

describe('browser requests from other websites', () => {
  it('cannot reach /__mock through an encoded or doubled path', async () => {
    const { app } = await serverWith({ MOCK_ADMIN_TOKEN: 'admin-t', MOCK_CONTROL_TOKEN: 'control-t' });
    const evil = { origin: 'https://evil.example' };
    for (const url of ['/%5F_mock/state', '/%5f%5fmock/state', '/__moc%6B/state', '/__mock%2Fstate', '//__mock/state']) {
      const res = await get(app, url, evil);
      expect(res.statusCode === 403 || res.statusCode === 404, `${url} -> ${res.statusCode}`).toBe(true);
      expect(res.headers['access-control-allow-credentials'], url).toBeUndefined();
      expect(res.body, url).not.toContain('"state"');
    }
    await app.close();
  });

  it('are refused on /__mock, with or without saved credentials', async () => {
    const { app } = await serverWith({ MOCK_ADMIN_TOKEN: 'admin-t', MOCK_CONTROL_TOKEN: 'control-t' });
    const evil = { origin: 'https://evil.example' };
    expect((await post(app, '/__mock/reset-all', { ...evil, ...basic('admin-t') })).statusCode).toBe(403);
    expect((await get(app, '/__mock/state', { ...evil, ...basic('admin-t') })).statusCode).toBe(403);
    const res = await get(app, '/__mock/scenarios', evil);
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('may use /__mock from a local app with a header token, but saved credentials only count same-origin', async () => {
    const { app } = await serverWith({ MOCK_ADMIN_TOKEN: 'admin-t', MOCK_CONTROL_TOKEN: 'control-t' });
    const local = { origin: 'http://localhost:3000' };
    const header = await post(app, '/__mock/reset', { ...local, 'x-mock-control-token': 'control-t' });
    expect(header.statusCode).toBe(200);
    expect(header.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(header.headers['access-control-allow-credentials']).toBeUndefined();
    expect((await post(app, '/__mock/reset', { ...local, ...basic('control-t') })).statusCode).toBe(401);
    expect((await post(app, '/__mock/reset', { origin: 'http://localhost:80', ...basic('control-t') })).statusCode).toBe(200);
    await app.close();
  });

  it('do not change CORS for the API itself', async () => {
    const { app, engine } = await serverWith({});
    const res = await get(app, '/any/api/path', { origin: 'https://app.example' });
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    // A browser app can read the mock's headers, the spec's documented ones, and the domain's.
    const exposed = String(res.headers['access-control-expose-headers']).split(/,\s*/);
    expect(exposed).toContain('x-mock-idempotent-replay');
    for (const h of [...engine.contract.documentedResponseHeaders(), ...(engine.domain.exposeHeaders ?? []).map((x) => x.toLowerCase())]) expect(exposed).toContain(h);
    await app.close();
  });
});

describe('configuration', () => {
  it('redirects /__mock to /__mock/ so browser logins are scoped to the control plane', async () => {
    const { app } = await serverWith({});
    const res = await get(app, '/__mock');
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe('/__mock/');
    await app.close();
  });

  it('refuses invalid settings at startup', async () => {
    await expect(serverWith({ MOCK_CATALOGUE_ACCESS: 'closed' })).rejects.toThrow(/MOCK_CATALOGUE_ACCESS must be one of/);
    await expect(serverWith({ MOCK_CLOCK: 'Frozen' })).rejects.toThrow(/MOCK_CLOCK must be one of/);
    await expect(serverWith({ MOCK_CLOCK_START: '2026-13-45 9am' })).rejects.toThrow(/MOCK_CLOCK_START must be an ISO 8601/);
    // Without a zone it would mean a different instant on machines in different time zones.
    await expect(serverWith({ MOCK_CLOCK_START: '2026-03-02T09:00:00' })).rejects.toThrow(/with Z or an offset/);
    await expect(serverWith({ MOCK_CLOCK_START: '2 March 2026' })).rejects.toThrow(/with Z or an offset/);
    await expect(serverWith({ MOCK_CLOCK_START: '2026-02-30T09:00:00Z' })).rejects.toThrow(/not a real calendar date/);
    await expect(serverWith({ MOCK_BASE_PATH: 'v1' })).rejects.toThrow(/MOCK_BASE_PATH must be empty or start with/);
    await expect(serverWith({ MOCK_BASE_PATH: '/__mock/api' })).rejects.toThrow(/may not be under \/__mock/);
    await expect(serverWith({ MOCK_CONTROL_ORIGINS: 'localhost:3000' })).rejects.toThrow(/MOCK_CONTROL_ORIGINS entries/);
  });
});
