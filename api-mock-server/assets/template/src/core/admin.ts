// Control plane under /__mock/: discover personas and scenarios, reset state, move
// time, force outcomes, and see what happened.
//
// Access has three tiers, decided per request by access.ts:
//   - catalogue (/__mock/, personas, scenarios, docs, openapi.json): open by default;
//     with MOCK_CATALOGUE_ACCESS=token it needs the control token;
//   - session operations (reset, state, arm, clock, requests, webhooks): the control
//     or admin token;
//   - global operations (reset-all, sessions) and unredacted state: the admin token.
// Tokens are always required (generated at startup when not configured; see
// ensureTokens in config.ts). Browser requests from other origins are refused before
// any of this (see server.ts). A shared instance refuses to start unless it is given
// both tokens, or MOCK_ALLOW_OPEN_CONTROL=true.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hostnameOf, mayAdminister, mayControl, mayReadCatalogue, refusalReason, TOKEN_HEADERS } from './access.ts';
import { config, DEFAULT_SESSION, SESSION_HEADER, validateConfig } from './config.ts';
import { advanceClock, buildContext, initialClock, settle, virtualNow } from './context.ts';
import { registerDocs } from './docs.ts';
import type { Engine } from './engine.ts';
import { BUILT_INS, isBuiltIn } from './scenarios.ts';
import { SessionStore } from './sessions.ts';
import { headerValue } from './util.ts';
import { isAllowedWebhookTarget } from './webhooks.ts';

export const ADMIN_PREFIX = '/__mock';
const SENSITIVE_KEY = /pass(word|phrase|code)?$|secret|^pin$|cvv|cvc|private.?key/i;

export function assertSafeToServe() {
  validateConfig();
  if (!config.shared || config.allowOpenControl) return;
  const missing = [!config.adminToken && 'MOCK_ADMIN_TOKEN', !config.controlToken && 'MOCK_CONTROL_TOKEN'].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `HOST=${config.host} exposes the mock beyond this machine, so the control plane must be protected. ` +
        `Set ${missing.join(' and ')}, or set MOCK_ALLOW_OPEN_CONTROL=true to accept that anyone who can reach it can read and reset every session.`,
    );
  }
}

export function registerAdmin(app: FastifyInstance, engine: Engine) {
  const { domain, store, contract } = engine;

  // 401 with a Basic challenge, so a browser prompts for the token (any user name). The
  // challenge always comes from a URL under /__mock/, so browsers scope the saved
  // credentials to /__mock/ and do not attach them to API requests.
  const challenge = (req: FastifyRequest, reply: FastifyReply, needs: string) =>
    reply.code(401).header('www-authenticate', 'Basic realm="mock control plane", charset="UTF-8"').send({ error: refusalReason(req, needs) });
  const canReadCatalogue = (req: FastifyRequest, reply: FastifyReply) => {
    if (mayReadCatalogue(req)) return true;
    challenge(req, reply, `${TOKEN_HEADERS.control} (MOCK_CONTROL_TOKEN), because MOCK_CATALOGUE_ACCESS=token`);
    return false;
  };
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply) => {
    if (mayAdminister(req)) return true;
    challenge(req, reply, `${TOKEN_HEADERS.admin} (MOCK_ADMIN_TOKEN)`);
    return false;
  };

  /** Session id for a session-tier operation, or undefined after replying with an error. */
  const sessionOf = (req: FastifyRequest, reply: FastifyReply) => {
    if (!mayControl(req)) {
      challenge(req, reply, `${TOKEN_HEADERS.control} (MOCK_CONTROL_TOKEN) or ${TOKEN_HEADERS.admin}`);
      return undefined;
    }
    const id = headerValue(req.headers[SESSION_HEADER]) ?? DEFAULT_SESSION;
    if (!SessionStore.isValidId(id)) {
      reply.code(400).send({ error: 'X-Mock-Session must match [A-Za-z0-9._-]{1,64}.' });
      return undefined;
    }
    return id;
  };
  const session = (id: string) => store.get(id).session;

  // Served at /__mock/ (trailing slash) so a browser login prompted here is scoped to /__mock/.
  app.get(ADMIN_PREFIX, async (_req, reply) => reply.redirect(`${ADMIN_PREFIX}/`, 308));
  app.get(`${ADMIN_PREFIX}/`, async (req, reply) => {
    if (!canReadCatalogue(req, reply)) return;
    return {
    mock: domain.name,
    openapi: contract.version,
    basePath: config.basePath || '/',
    shared: config.shared,
    sessions: store.stats(),
    headers: {
      session: 'X-Mock-Session: <id> isolates state; omit to use "default".',
      scenario: 'X-Mock-Scenario: <id>[,<id>] forces an outcome for this request.',
      control: `${TOKEN_HEADERS.control}: <token> is required for every session operation (the token is printed at startup and saved in .mock-tokens on a local mock).`,
    },
    endpoints: [
      'GET  /__mock/personas',
      'GET  /__mock/scenarios[?operationId=]',
      'POST /__mock/reset                     reset the current session to seed data',
      'POST /__mock/personas/:id/reset        restore one persona inside the current session',
      'POST /__mock/reset-all                 (admin) discard every session',
      'GET  /__mock/sessions                  (admin) list live sessions',
      'GET  /__mock/state                     dump the current session state',
      'POST /__mock/arm {operationId|*, scenario, times}  force the next N calls',
      'DELETE /__mock/arm',
      'GET  /__mock/clock | POST /__mock/clock/advance {seconds} | POST /__mock/clock/freeze {at?} | POST /__mock/clock/resume | POST /__mock/clock/reset',
      'GET  /__mock/requests                  recent requests in this session',
      'GET  /__mock/actions | POST /__mock/actions/:name {...}  trigger an off-app event (underwriting decision, back-office step)',
      'GET  /__mock/providers/:provider/:ref  simulated provider page (opened from URLs the API returns)',
      'POST /__mock/webhooks/target {url} | GET /__mock/webhooks/log | POST /__mock/webhooks/trigger {event, ...}',
    ],
    docs: '/__mock/docs (Swagger UI with every test case) and /__mock/openapi.json (the annotated spec)',
    };
  });

  app.get(`${ADMIN_PREFIX}/personas`, async (req, reply) => {
    if (!canReadCatalogue(req, reply)) return;
    return domain.personas;
  });

  app.get<{ Querystring: { operationId?: string } }>(`${ADMIN_PREFIX}/scenarios`, async (req, reply) => {
    if (!canReadCatalogue(req, reply)) return;
    return {
      builtIn: BUILT_INS,
      scenarios: domain.scenarios
        .filter((s) => !req.query.operationId || s.operationId === req.query.operationId)
        .map(({ respond: _r, ...rest }) => rest),
    };
  });

  registerDocs(app, engine, canReadCatalogue);

  app.post(`${ADMIN_PREFIX}/reset`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    store.reset(id);
    return { reset: id };
  });

  app.post<{ Params: { id: string } }>(`${ADMIN_PREFIX}/personas/:id/reset`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    if (!domain.resetPersona) return reply.code(501).send({ error: 'This mock does not support per-persona reset; use POST /__mock/reset.' });
    if (!domain.resetPersona(session(id).state, req.params.id)) return reply.code(404).send({ error: `Unknown persona ${req.params.id}` });
    return { session: id, persona: req.params.id, reset: true };
  });

  app.post(`${ADMIN_PREFIX}/reset-all`, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { discardedSessions: store.resetAll() };
  });

  app.get(`${ADMIN_PREFIX}/sessions`, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { ...store.stats(), sessions: store.list() };
  });

  app.get(`${ADMIN_PREFIX}/state`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const s = session(id);
    settle(domain, contract, s);
    const redact = !mayAdminister(req);
    return {
      session: id,
      now: new Date(virtualNow(s)).toISOString(),
      clock: s.clock.frozenAt !== undefined ? 'frozen' : 'live',
      pending: s.scheduled.map((t) => ({ at: new Date(t.at).toISOString(), label: t.label })),
      armed: s.armed,
      redacted: redact,
      state: redact ? redactSensitive(s.state) : s.state,
    };
  });

  app.post<{ Body: { operationId?: string; scenario?: string; times?: number } }>(`${ADMIN_PREFIX}/arm`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const { operationId, scenario, times = 1 } = req.body ?? {};
    if (!operationId || !scenario) return reply.code(400).send({ error: 'Body needs operationId (or "*") and scenario.' });
    if (operationId !== '*' && !contract.getOperation(operationId)) return reply.code(400).send({ error: `Unknown operationId ${operationId}` });
    if (operationId === '*' && (!isBuiltIn(scenario) || scenario.startsWith('example.'))) {
      return reply.code(400).send({
        error: 'operationId "*" takes only fault.* and delay.* (every operation can produce those); arm example.<status> or a domain scenario for its own operation.',
      });
    }
    const exampleCode = /^example\.(\d{3})$/.exec(scenario)?.[1];
    const armedOp = operationId === '*' ? undefined : contract.getOperation(operationId);
    if (exampleCode && armedOp && !contract.responseKey(armedOp, Number(exampleCode))) {
      return reply.code(400).send({ error: `${operationId} does not document a ${exampleCode} response, so example.${exampleCode} cannot be armed for it.` });
    }
    const target = domain.scenarios.find((s) => s.id === scenario && s.operationId === operationId);
    if (!isBuiltIn(scenario) && !target) return reply.code(400).send({ error: `Unknown scenario ${scenario} for ${operationId}` });
    if (target && target.trigger !== 'header') {
      return reply.code(400).send({ error: `${scenario} is reached by ${target.trigger}, not forced: ${target.how}` });
    }
    const s = session(id);
    s.armed.push({ operationId, scenarioId: scenario, remaining: Math.max(1, Math.min(1000, Number(times) || 1)) });
    return { session: id, armed: s.armed };
  });

  app.delete(`${ADMIN_PREFIX}/arm`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    session(id).armed = [];
    return { session: id, armed: [] };
  });

  const clockView = (id: string) => {
    const s = session(id);
    return { session: id, now: new Date(virtualNow(s)).toISOString(), clock: s.clock.frozenAt !== undefined ? 'frozen' : 'live' };
  };

  app.get(`${ADMIN_PREFIX}/clock`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    return clockView(id);
  });

  app.post<{ Body: { seconds?: number } }>(`${ADMIN_PREFIX}/clock/advance`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const seconds = Number(req.body?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return reply.code(400).send({ error: 'Body needs a positive number of seconds.' });
    const s = session(id);
    advanceClock(s, seconds * 1000);
    const ran = settle(domain, contract, s);
    return { ...clockView(id), ran };
  });

  app.post<{ Body: { at?: string } }>(`${ADMIN_PREFIX}/clock/freeze`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const s = session(id);
    const at = req.body?.at ? Date.parse(req.body.at) : virtualNow(s);
    if (!Number.isFinite(at)) return reply.code(400).send({ error: 'at must be an ISO 8601 date-time.' });
    s.clock = { frozenAt: at, offsetMs: 0 };
    return { ...clockView(id), ran: settle(domain, contract, s) };
  });

  app.post(`${ADMIN_PREFIX}/clock/resume`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const s = session(id);
    s.clock = { offsetMs: virtualNow(s) - Date.now() };
    return clockView(id);
  });

  app.post(`${ADMIN_PREFIX}/clock/reset`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    session(id).clock = initialClock();
    return clockView(id);
  });

  app.get(`${ADMIN_PREFIX}/requests`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    return session(id).requestLog;
  });

  app.post<{ Body: { url?: string } }>(`${ADMIN_PREFIX}/webhooks/target`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const url = req.body?.url;
    if (!url || !isAllowedWebhookTarget(url)) {
      return reply.code(400).send({
        error: `url must be http(s) on an allowed host: ${config.webhookAllowedHosts.join(', ') || '(none; set MOCK_WEBHOOK_ALLOWED_HOSTS)'}`,
      });
    }
    // A target on this machine's own loopback can reach any local service, and whether
    // the caller is really on this machine cannot be told (a TCP forwarder makes a remote
    // caller look local). So only the admin token, held by whoever runs the mock, may set one.
    if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(hostnameOf(new URL(url).host)) && !mayAdminister(req)) {
      return challenge(req, reply, `${TOKEN_HEADERS.admin} (MOCK_ADMIN_TOKEN), because the target is on this machine's loopback`);
    }
    session(id).webhookTarget = url;
    return { session: id, target: url };
  });

  app.get(`${ADMIN_PREFIX}/webhooks/log`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    return session(id).webhookLog;
  });

  // Off-app events (domain.actions): a tester triggers what only the real back office could.
  app.get(`${ADMIN_PREFIX}/actions`, async (req, reply) => {
    if (!canReadCatalogue(req, reply)) return;
    return Object.entries(domain.actions ?? {}).map(([name, a]) => ({ name, summary: a.summary, input: a.input ?? null }));
  });

  app.post<{ Params: { name: string }; Body: Record<string, unknown> }>(`${ADMIN_PREFIX}/actions/:name`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const action = domain.actions?.[req.params.name];
    if (!action) return reply.code(404).send({ error: `Unknown action ${req.params.name}.`, available: Object.keys(domain.actions ?? {}) });
    const s = session(id);
    settle(domain, contract, s);
    const mc = buildContext(domain, contract, s, undefined);
    try {
      const result = action.run(mc, (req.body ?? {}) as Record<string, unknown>);
      return { session: id, action: req.params.name, result: result ?? null };
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Body: { event?: string } & Record<string, unknown> }>(`${ADMIN_PREFIX}/webhooks/trigger`, async (req, reply) => {
    const id = sessionOf(req, reply);
    if (!id) return;
    const { event, ...input } = req.body ?? {};
    const trigger = event ? domain.webhookTriggers?.[event] : undefined;
    if (!trigger) return reply.code(400).send({ error: 'Unknown event.', available: Object.keys(domain.webhookTriggers ?? {}) });
    const s = session(id);
    const mc = buildContext(domain, contract, s, undefined);
    const payload = trigger(mc, input);
    mc.emitWebhook(event as string, payload);
    return { session: id, event, payload };
  });
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) && typeof v !== 'object' ? '[redacted]' : redactSensitive(v)]),
  );
}
