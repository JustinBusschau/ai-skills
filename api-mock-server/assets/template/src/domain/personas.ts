// Seeded personas: ready-made accounts, one per state a client must handle, present
// in every session with fixed credentials. Derive every date from SEED_EPOCH and every
// id from the persona id so the seed is identical on every run.
// See assets/example-acme-wallet/domain/personas.ts.
import type { Persona } from '../core/types.ts';
import type { State } from './state.ts';

export const SEED_EPOCH = Date.parse('2026-01-15T09:00:00Z');

export const personas: Persona[] = [];

export function seedPersona(_state: State, personaId: string): boolean {
  return personas.some((p) => p.id === personaId);
}

export function createState(): State {
  const state: State = { seq: 1000 };
  for (const p of personas) seedPersona(state, p.id);
  return state;
}
