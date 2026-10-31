import type { Domain } from '../core/types.ts';
import { handlers } from './handlers/index.ts';
import { createState, personas, seedPersona, tokenFor } from './personas.ts';
import { scenarios } from './scenarios.ts';
import type { KycStatus } from './state.ts';

export const domain: Domain = {
  name: 'Acme Wallet API mock',
  createState,
  personas,
  scenarios,
  handlers,
  validationErrorStatus: 400,
  errorBody: (_status, code, message, details) => ({ error: { code, message, ...(details === undefined ? {} : { details }) } }),
  errorCodeOf: (body) => (body as { error?: { code?: string } } | undefined)?.error?.code,
  authHeadersFor: (personaId) => ({ authorization: `Bearer ${tokenFor(personaId)}` }),
  resolvePrincipal: (headers, state) => {
    const auth = headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const userId = token ? state.tokens[token] : undefined;
    if (!userId || !state.users[userId]) return undefined;
    return { subjectId: userId, personaId: state.users[userId]!.personaId, credential: token };
  },
  resetPersona: seedPersona,
  actions: {
    'kyc.decide': {
      summary: "Decide new_user's pending KYC application now, instead of waiting for the clock.",
      input: '{"outcome": "approved" | "rejected" | "needs_more_info"}',
      run: (mc, input) => {
        const app = mc.state.kyc.usr_new_user;
        if (!app || app.status !== 'pending') throw new Error('new_user has no pending KYC application.');
        const outcome = String(input.outcome ?? 'approved') as KycStatus;
        if (!['approved', 'rejected', 'needs_more_info'].includes(outcome)) throw new Error(`Unknown outcome ${outcome}.`);
        app.status = outcome;
        app.decidedAt = mc.now().toISOString();
        if (outcome === 'approved') mc.state.users.usr_new_user!.status = 'active';
        return app;
      },
    },
  },
  webhookTriggers: {
    // Fires for the newest payment of the persona named in the body ({"persona": "..."}), default active.
    'payment.updated': (mc, input) => {
      const userId = `usr_${String(input.persona ?? 'active')}`;
      const payment = mc.state.payments[userId]?.[0] ?? mc.state.payments.usr_active![0]!;
      return { type: 'payment.updated', data: payment };
    },
  },
};
