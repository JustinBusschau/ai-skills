// Request pipeline:
//   session -> scheduled work -> route -> scenario ids -> delay -> fault ->
//   auth -> request validation -> forced scenario | handler | spec example ->
//   response validation -> log.
// The OpenAPI document is the contract. Everything returned is checked against it,
// except deliberate faults (marked X-Mock-Fault) and the runtime's own 401 and
// validation responses on operations that do not document those statuses (marked
// X-Mock-Undocumented-Status, because the real API would still send them).
import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, DEFAULT_SESSION, SCENARIO_HEADER, SESSION_HEADER } from './config.ts';
import { buildContext, settle, virtualNow } from './context.ts';
import { Contract, type OperationInfo } from './contract.ts';
import { consumeArmed, headerScenarios, parseScenarioHeader, peekArmed } from './scenarios.ts';
import { SessionStore } from './sessions.ts';
import type { Domain, MockContext, MockRequest, MockResult } from './types.ts';
import { FILES, headerValue, parseCookies, pushBounded, sleep } from './util.ts';
import type { UploadedFile } from './types.ts';

export interface Engine {
  contract: Contract;
  store: SessionStore;
  domain: Domain;
  handle: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

type Outcome = MockResult | 'dropped';

export async function createEngine(domain: Domain): Promise<Engine> {
  const contract = await Contract.load(config.specPath, config.basePath);
  if (contract.documentProblems.length) {
    console.warn(`spec/openapi.yaml has ${contract.documentProblems.length} validity problem(s); run npm run check:spec.`);
  }
  for (const operationId of Object.keys(domain.handlers)) {
    if (!contract.getOperation(operationId)) throw new Error(`Handler registered for unknown operationId "${operationId}"`);
  }
  for (const s of domain.scenarios) {
    if (!contract.getOperation(s.operationId)) throw new Error(`Scenario ${s.id} names unknown operationId "${s.operationId}"`);
    if (s.trigger === 'header' && !s.respond) throw new Error(`Scenario ${s.id} has trigger "header" but no respond()`);
  }
  for (const id of domain.webhookOperations ?? []) {
    if (!contract.getOperation(id)) throw new Error(`webhookOperations names unknown operationId "${id}"`);
  }

  const store = new SessionStore(domain);

  async function handle(req: FastifyRequest, reply: FastifyReply) {
    const sessionId = headerValue(req.headers[SESSION_HEADER]) ?? DEFAULT_SESSION;
    if (!SessionStore.isValidId(sessionId)) {
      return send(reply, { status: 400, body: domain.errorBody(400, 'mock_invalid_session', 'X-Mock-Session must match [A-Za-z0-9._-]{1,64}.') });
    }
    const { session, created } = store.get(sessionId);
    settle(domain, contract, session);

    const match = contract.match(req.method, req.url);
    const op = typeof match === 'object' && !domain.webhookOperations?.includes(match.op.operationId) ? match.op : undefined;
    const { ids, unknown, notForceable } = headerScenarios(domain, op?.operationId, parseScenarioHeader(req.headers[SCENARIO_HEADER]));
    const principal = domain.resolvePrincipal(req.headers, session.state, new Date(virtualNow(session)));
    const mc = buildContext(domain, contract, session, principal, ids, requestOrigin(req), true);

    let result: Outcome;
    let applied: string | undefined;
    if (!op || typeof match !== 'object') {
      result = match === 'method_not_allowed' ? mc.error(405, 'method_not_allowed', 'Method not allowed for this route.') : mc.error(404, 'not_found', 'No such route in the API contract.');
    } else if (unknown.length) {
      result = mc.error(400, 'mock_unknown_scenario', `Unknown scenario id(s): ${unknown.join(', ')}. See GET /__mock/scenarios.`);
    } else if (notForceable.length) {
      const how = notForceable.map((id) => `${id}: ${domain.scenarios.find((s) => s.id === id)?.how}`).join(' ');
      result = mc.error(400, 'mock_scenario_not_forceable', `Only header-triggered and built-in scenarios can be forced. Reach these as documented instead. ${how}`);
    } else {
      let armed = peekArmed(session, op.operationId);
      const delayId = [...ids].find((id) => id.startsWith('delay.')) ?? (armed?.scenarioId.startsWith('delay.') ? armed.scenarioId : undefined);
      const delayMs = delayId ? Number(delayId.slice('delay.'.length)) : 0;
      if (delayMs > config.maxDelayMs) {
        result = mc.error(400, 'mock_delay_too_long', `Delays are capped at MOCK_MAX_DELAY_MS (${config.maxDelayMs} ms).`);
      } else {
        if (delayId && armed?.scenarioId === delayId) {
          consumeArmed(session, armed);
          armed = peekArmed(session, op.operationId);
        }
        if (delayMs) await sleep(delayMs);
        const faultId = [...ids].find((id) => id.startsWith('fault.')) ?? (armed?.scenarioId.startsWith('fault.') ? armed.scenarioId : undefined);
        if (faultId) {
          if (armed?.scenarioId === faultId) consumeArmed(session, armed);
          result = await applyFault(faultId, mc, reply);
          applied = faultId;
        } else {
          ({ result, applied } = await respond(op, match.params, req, mc, armed));
        }
      }
    }

    const undocumented = result !== 'dropped' && result.headers?.['x-mock-undocumented-status'] === 'true';
    pushBounded(session.requestLog, {
      at: new Date().toISOString(),
      method: req.method,
      path: req.url,
      operationId: op?.operationId,
      status: result === 'dropped' ? 0 : result.status,
      scenario: applied,
      ...(undocumented ? { undocumented } : {}),
    });
    if (result === 'dropped') return;
    reply.header('x-mock-session', session.id);
    if (op) reply.header('x-mock-operation', op.operationId);
    if (created) reply.header('x-mock-session-created', 'true');
    if (applied) reply.header('x-mock-scenario-applied', applied);
    return send(reply, result);
  }

  async function respond(
    op: OperationInfo,
    pathParams: Record<string, string>,
    req: FastifyRequest,
    mc: MockContext,
    armed: ReturnType<typeof peekArmed>,
  ): Promise<{ result: Outcome; applied?: string }> {
    if (op.secured && !mc.principal) {
      return { result: check(op, mc.error(401, 'unauthenticated', 'Missing or invalid credentials.'), true) };
    }
    const v = contract.validateRequest(op, {
      params: pathParams,
      query: (req.query ?? {}) as Record<string, string | string[]>,
      headers: req.headers,
      cookies: parseCookies(headerValue(req.headers.cookie)),
      body: req.body,
      contentType: headerValue(req.headers['content-type']),
    });
    if (v.problems.length) {
      const result = mc.error(domain.validationErrorStatus, 'validation_failed', 'Request does not match the API contract.', v.problems);
      return { result: check(op, result, true) };
    }
    if (armed && !armed.scenarioId.startsWith('fault.') && !armed.scenarioId.startsWith('delay.')) {
      mc.scenarios.add(armed.scenarioId);
      consumeArmed(mc.session, armed);
    }
    const mreq: MockRequest = {
      operationId: op.operationId,
      method: req.method,
      url: req.url,
      params: v.params,
      query: v.query,
      headers: req.headers,
      cookies: v.cookies,
      body: v.body,
      files: filesOf(req.body),
    };
    // Idempotency: a write retried with the same key gets the original response, as the
    // contract requires for its Idempotency-Key header; the same key with a different
    // request is refused rather than silently treated as the first.
    const idemParam = op.parameters.find((p) => p.in === 'header' && /^idempotency-key$/i.test(p.name));
    const idemKey = idemParam ? headerValue(req.headers[idemParam.name.toLowerCase()]) : undefined;
    const idemSlot = idemKey ? `${op.operationId}:${idemKey}` : undefined;
    const fingerprint = JSON.stringify([req.url, v.body ?? null, mc.principal?.subjectId ?? null]);
    if (idemSlot) {
      const prior = mc.session.idempotency[idemSlot];
      if (prior && prior.fingerprint === fingerprint) {
        return { result: { ...prior.result, headers: { ...prior.result.headers, 'x-mock-idempotent-replay': 'true' } } };
      }
      if (prior) {
        return { result: check(op, mc.error(409, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.'), true) };
      }
    }
    let result: MockResult;
    let applied: string | undefined;
    try {
      const forced = forcedScenario(op, mreq, mc);
      if (forced?.refused) {
        // The mock's own refusal, not the API's: never reported as applied, and not
        // turned into a contract violation because the operation lacks that status.
        return { result: check(op, forced.result, true) };
      } else if (forced) {
        ({ result, id: applied } = forced);
      } else {
        const handler = domain.handlers[op.operationId];
        if (handler) {
          result = await handler(mreq, mc);
        } else {
          const ex = contract.example(op);
          result = ex
            ? { status: ex.status, body: ex.body, headers: { 'x-mock-source': 'spec-example' } }
            : mc.error(501, 'not_implemented', `${op.operationId} has no handler and no documented response.`);
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`Handler for ${op.operationId} threw`, e);
      return {
        result: {
          status: 500,
          headers: { 'x-mock-handler-error': 'true' },
          body: { mockHandlerError: { operationId: op.operationId, message: e.message, stack: e.stack?.split('\n').slice(0, 5) } },
        },
      };
    }
    const checked = check(op, result, false);
    if (idemSlot && checked.status < 500 && !checked.headers?.['x-mock-contract-violation']) {
      mc.session.idempotency[idemSlot] = { fingerprint, result: checked };
    }
    return { result: checked, applied };
  }

  function forcedScenario(op: OperationInfo, mreq: MockRequest, mc: MockContext): { id: string; result: MockResult; refused?: boolean } | undefined {
    for (const id of mc.scenarios) {
      const example = /^example\.(\d{3})$/.exec(id);
      if (example) {
        const code = Number(example[1]);
        const ex = contract.responseKey(op, code) ? contract.example(op, code) : undefined;
        if (!ex) return { id, refused: true, result: mc.error(400, 'mock_scenario_not_forceable', `${op.operationId} does not document a ${code} response, so there is no example to return.`) };
        return { id, result: { status: ex.status, body: ex.body, headers: { 'x-mock-source': 'spec-example' } } };
      }
      const scenario = domain.scenarios.find((s) => s.id === id && s.trigger === 'header' && s.respond);
      if (scenario?.respond) return { id, result: scenario.respond(mc, mreq) };
    }
    return undefined;
  }

  /**
   * Validate a response against the contract. Runtime-generated 401 and validation
   * responses may use a status the operation does not document; they pass through
   * marked rather than being turned into a contract violation.
   */
  function check(op: OperationInfo, result: MockResult, runtimeGenerated: boolean): MockResult {
    if (config.responseValidation === 'off') return result;
    if (runtimeGenerated && !contract.responseKey(op, result.status)) {
      return { ...result, headers: { ...result.headers, 'x-mock-undocumented-status': 'true' } };
    }
    const problems = contract.validateResponse(op, result.status, result.body, result.headers);
    if (!problems.length) return result;
    const message = `Mock response for ${op.operationId} (${result.status}) violates the contract`;
    if (config.responseValidation === 'warn') {
      console.warn(message, JSON.stringify(problems));
      return result;
    }
    return {
      status: 500,
      headers: { 'x-mock-contract-violation': 'true' },
      body: { mockContractViolation: { message, problems, attempted: result } },
    };
  }

  return { contract, store, domain, handle };
}

async function applyFault(id: string, mc: MockContext, reply: FastifyReply): Promise<Outcome> {
  const marker = { 'x-mock-fault': id };
  const err = (status: number, code: string, message: string, extra: Record<string, string> = {}) => {
    const e = mc.error(status, code, message);
    return { ...e, headers: { ...e.headers, ...marker, ...extra } };
  };
  switch (id) {
    case 'fault.server_error':
      return err(500, 'internal_error', 'Simulated server error.');
    case 'fault.unavailable':
      return err(503, 'service_unavailable', 'Simulated outage.', { 'retry-after': '30' });
    case 'fault.rate_limited':
      return err(429, 'rate_limited', 'Simulated rate limit.', { 'retry-after': '30' });
    case 'fault.malformed_json':
      reply.hijack();
      reply.raw.writeHead(200, { ...(reply.getHeaders() as OutgoingHttpHeaders), 'content-type': 'application/json', ...marker });
      reply.raw.end('{"data": {"id": "trunc');
      return 'dropped';
    case 'fault.timeout':
      await sleep(config.timeoutFaultMs);
      reply.hijack();
      reply.raw.destroy();
      return 'dropped';
    default:
      // fault.connection_reset
      reply.hijack();
      reply.raw.destroy();
      return 'dropped';
  }
}

function send(reply: FastifyReply, result: MockResult) {
  let contentType: string | undefined;
  for (const [k, v] of Object.entries(result.headers ?? {})) {
    if (k.toLowerCase() === 'content-type') contentType = v;
    else reply.header(k, v);
  }
  reply.code(result.status);
  if (result.body === undefined || result.status === 204 || reply.request.method === 'HEAD') return reply.send();
  if (typeof result.body === 'string' || Buffer.isBuffer(result.body)) {
    return reply.type(contentType ?? 'text/plain; charset=utf-8').send(result.body);
  }
  return reply.type(contentType ?? 'application/json; charset=utf-8').send(JSON.stringify(result.body));
}

function filesOf(body: unknown): Record<string, UploadedFile> {
  const files = body && typeof body === 'object' ? (body as Record<symbol, Record<string, UploadedFile> | undefined>)[FILES] : undefined;
  return files ?? {};
}

/** The origin the caller used, so links handed back to it (provider pages) are reachable. */
function requestOrigin(req: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/+$/, '');
  const proto = headerValue(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ?? req.protocol;
  return `${proto}://${headerValue(req.headers.host) ?? `localhost:${config.port}`}`;
}
