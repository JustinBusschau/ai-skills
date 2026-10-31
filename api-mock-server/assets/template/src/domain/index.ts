import type { Domain } from '../core/types.ts';
import { handlers } from './handlers/index.ts';
import { createState, personas, seedPersona } from './personas.ts';
import { scenarios } from './scenarios.ts';

export const domain: Domain = {
  name: '__API_TITLE__ mock',
  createState,
  personas,
  scenarios,
  handlers,
  validationErrorStatus: 400,
  // Shape both of these exactly like the contract's error envelope.
  errorBody: (_status, code, message, details) => ({ error: { code, message, ...(details === undefined ? {} : { details }) } }),
  errorCodeOf: (body) => (body as { error?: { code?: string } } | undefined)?.error?.code,
  authHeadersFor: (personaId) => ({ authorization: `Bearer mock_${personaId}` }),
  resolvePrincipal: () => undefined,
  resetPersona: seedPersona,
};
