// Builds the MockContext handed to every handler, and runs scheduled state changes
// whose virtual time has arrived. Scheduled work runs lazily (on the next request or
// clock advance) rather than on timers.
//
// Each session's clock is either live (real time plus an offset, so delayed outcomes
// also arrive by simply waiting) or frozen (time moves only through
// POST /__mock/clock/advance, so every timestamp is reproducible). MOCK_CLOCK sets the
// default for new sessions; the test suite runs frozen.
import { createHash } from 'node:crypto';
import { config } from './config.ts';
import { fileUrl, providerUrl } from './providers.ts';
import type { Contract } from './contract.ts';
import type { Domain, MockContext, Principal, Session, SessionClock } from './types.ts';
import { deliverWebhook } from './webhooks.ts';

export function initialClock(now = Date.now()): SessionClock {
  return config.clockMode === 'frozen' ? { frozenAt: config.clockStart ?? now, offsetMs: 0 } : { offsetMs: 0 };
}

export function virtualNow(session: Session): number {
  return session.clock.frozenAt ?? Date.now() + session.clock.offsetMs;
}

export function advanceClock(session: Session, ms: number) {
  if (session.clock.frozenAt !== undefined) session.clock.frozenAt += ms;
  else session.clock.offsetMs += ms;
}

/** A UUID-shaped id derived from text, so ids are reproducible across runs. */
export function uuidFrom(text: string): string {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16]!, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const defaultOrigin = () => config.publicUrl.replace(/\/+$/, '') || `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;

export function buildContext(
  domain: Domain,
  contract: Contract,
  session: Session,
  principal: Principal | undefined,
  scenarios: Set<string> = new Set(),
  origin: string = defaultOrigin(),
  /** Count this as an API request (only those advance requestId, so ids stay predictable). */
  isRequest = false,
): MockContext {
  if (isRequest) session.requestSeq += 1;
  const requestId = uuidFrom(`request:${session.requestSeq}${isRequest ? '' : `:internal:${session.internalSeq++}`}`);
  const mc: MockContext = {
    session,
    state: session.state,
    principal,
    scenarios,
    requestId,
    origin,
    providerUrl: (provider, ref) => providerUrl(origin, session.id, provider, ref),
    fileUrl: (ref, expiresAt) => fileUrl(origin, session.id, ref, expiresAt.getTime()),
    now: () => new Date(virtualNow(session)),
    schedule: (delayMs, label, run) => {
      session.scheduled.push({ at: virtualNow(session) + delayMs, label, run });
      session.scheduled.sort((a, b) => a.at - b.at);
    },
    emitWebhook: (event, payload) => {
      void deliverWebhook(domain, contract, session, event, payload);
    },
    error: (status, code, message, details) => ({
      status,
      body: domain.errorBody(status, code, message, details, { requestId }),
      ...(domain.errorContentType ? { headers: { 'content-type': domain.errorContentType } } : {}),
    }),
  };
  return mc;
}

/** Run every scheduled task that is due. Tasks may schedule further tasks. */
export function settle(domain: Domain, contract: Contract, session: Session): string[] {
  const ran: string[] = [];
  const mc = buildContext(domain, contract, session, undefined);
  // Bounded loop so a task that keeps rescheduling itself in the past cannot hang the server.
  for (let i = 0; i < 1000; i++) {
    const next = session.scheduled[0];
    if (!next || next.at > virtualNow(session)) break;
    session.scheduled.shift();
    next.run(mc);
    ran.push(next.label);
  }
  return ran;
}
