// Scenario selection. A request can ask for an outcome three ways, in this order:
//   1. X-Mock-Scenario header (comma-separated ids) on the request itself;
//   2. a scenario armed for this operation through POST /__mock/arm (for clients that
//      cannot add headers, such as a third-party SDK or a release build);
//   3. nothing: the domain handler decides from persona, inputs and state.
// An armed scenario is used up only when it actually takes effect: a fault when the
// fault fires, anything else after authentication and request validation have passed.
// Built-in ids work on every operation without any domain code.
import type { Domain, Session } from './types.ts';

export interface BuiltIn {
  id: string;
  summary: string;
}

export const BUILT_INS: BuiltIn[] = [
  { id: 'fault.server_error', summary: '500 with the contract error envelope.' },
  { id: 'fault.unavailable', summary: '503 with Retry-After: 30.' },
  { id: 'fault.rate_limited', summary: '429 with Retry-After: 30.' },
  { id: 'fault.timeout', summary: 'Holds the connection open past typical client timeouts, then drops it.' },
  { id: 'fault.connection_reset', summary: 'Drops the connection without a response.' },
  { id: 'fault.malformed_json', summary: '200 with a truncated JSON body, to test client parsing errors.' },
  { id: 'delay.<ms>', summary: 'Adds latency before responding, e.g. delay.3000 (capped by MOCK_MAX_DELAY_MS). Combines with any other id.' },
  { id: 'example.<status>', summary: "Returns the spec's own example for that documented status, e.g. example.409." },
];

export const FAULT_STATUSES: Record<string, number> = { 'fault.server_error': 500, 'fault.unavailable': 503, 'fault.rate_limited': 429 };

export function parseScenarioHeader(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : value;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isBuiltIn(id: string): boolean {
  return (
    /^fault\.(server_error|unavailable|rate_limited|timeout|connection_reset|malformed_json)$/.test(id) ||
    /^delay\.\d{1,7}$/.test(id) ||
    /^example\.\d{3}$/.test(id)
  );
}

/**
 * Only built-ins and scenarios with trigger "header" can be forced. Every other
 * scenario is reached by its persona, input, or earlier calls; "forcing" one could not
 * change the outcome, so it is refused rather than silently reported as applied.
 */
export function isForceable(domain: Domain, id: string): boolean {
  return isBuiltIn(id) || domain.scenarios.some((s) => s.id === id && s.trigger === 'header');
}

/** Ids requested by header for this operation. Ids for other operations are ignored. */
export function headerScenarios(domain: Domain, operationId: string | undefined, headerIds: string[]) {
  const ids = new Set<string>();
  const unknown: string[] = [];
  const notForceable: string[] = [];
  for (const id of headerIds) {
    if (isBuiltIn(id)) ids.add(id);
    else {
      const s = domain.scenarios.find((x) => x.id === id);
      if (!s) unknown.push(id);
      else if (s.trigger !== 'header') notForceable.push(id);
      // A scenario for a different operation is ignored, so a client can send one
      // header value for a whole journey and have each call pick up its own part.
      else if (s.operationId === operationId) ids.add(id);
    }
  }
  return { ids, unknown, notForceable };
}

export function peekArmed(session: Session, operationId: string) {
  return session.armed.find((a) => (a.operationId === operationId || a.operationId === '*') && a.remaining > 0);
}

export function consumeArmed(session: Session, armed: { remaining: number }) {
  armed.remaining -= 1;
  session.armed = session.armed.filter((a) => a.remaining > 0);
}
