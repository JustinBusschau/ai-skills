// Session-scoped state. Every session holds an independent copy of the seeded data,
// so parallel test runs and different developers do not see each other's changes.
// Sessions expire after an idle TTL, and the least recently used session is evicted
// once MOCK_MAX_SESSIONS is reached; either way it is re-seeded on next use and the
// response carries X-Mock-Session-Created: true so the client can tell.
import { config, DEFAULT_SESSION } from './config.ts';
import { initialClock } from './context.ts';
import type { Domain, Session } from './types.ts';

const SESSION_ID = /^[A-Za-z0-9._-]{1,64}$/;

export class SessionStore {
  private sessions = new Map<string, Session>();
  private evicted = 0;

  constructor(private domain: Domain) {}

  static isValidId(id: string): boolean {
    return SESSION_ID.test(id);
  }

  get(id: string = DEFAULT_SESSION): { session: Session; created: boolean } {
    this.evictExpired();
    let session = this.sessions.get(id);
    const created = !session;
    if (!session) {
      session = this.create(id);
      this.sessions.set(id, session);
      this.enforceCap();
    }
    session.lastSeenAt = Date.now();
    // Re-insert so Map iteration order doubles as least-recently-used order.
    this.sessions.delete(id);
    this.sessions.set(id, session);
    return { session, created };
  }

  reset(id: string): Session {
    const session = this.create(id);
    this.sessions.set(id, session);
    return session;
  }

  resetAll(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  stats() {
    return { live: this.sessions.size, max: config.maxSessions, evictedForCapacity: this.evicted };
  }

  list() {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      createdAt: new Date(s.createdAt).toISOString(),
      lastSeenAt: new Date(s.lastSeenAt).toISOString(),
      expiresAt: new Date(s.lastSeenAt + config.sessionTtlMs).toISOString(),
      clock: s.clock.frozenAt !== undefined ? 'frozen' : 'live',
    }));
  }

  private create(id: string): Session {
    const now = Date.now();
    const clock = initialClock(now);
    return {
      id,
      state: this.domain.createState(),
      createdAt: now,
      lastSeenAt: now,
      clock,
      scheduled: [],
      armed: [],
      requestLog: [],
      webhookLog: [],
      requestSeq: 0,
      internalSeq: 0,
      startedAt: clock.frozenAt ?? now,
      idempotency: {},
    };
  }

  private evictExpired() {
    const cutoff = Date.now() - config.sessionTtlMs;
    for (const [id, s] of this.sessions) if (s.lastSeenAt < cutoff) this.sessions.delete(id);
  }

  private enforceCap() {
    while (this.sessions.size > config.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
      this.evicted += 1;
      console.warn(`Session "${oldest}" evicted: MOCK_MAX_SESSIONS (${config.maxSessions}) reached.`);
    }
  }
}
