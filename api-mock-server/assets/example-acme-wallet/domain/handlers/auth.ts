import type { MockHandler } from '../../core/types.ts';
import { personas, seedPersona, tokenFor } from '../personas.ts';
import { nextId, publicUser } from './support.ts';

// Any address on this domain signs up fresh every time, replacing an earlier account
// with the same address, so an onboarding journey can be replayed without inventing
// new email addresses or resetting the session.
export const FRESH_DOMAIN = '@fresh.mock.acme.test';

export const signUp: MockHandler = (req, mc) => {
  const { email, password } = req.body as { email: string; password: string };
  const existing = Object.values(mc.state.users).find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing && !email.toLowerCase().endsWith(FRESH_DOMAIN)) {
    return mc.error(409, 'email_taken', 'An account with this email already exists.');
  }
  if (existing) {
    delete mc.state.users[existing.id];
    delete mc.state.kyc[existing.id];
    delete mc.state.payments[existing.id];
  }
  const user = { id: nextId(mc, 'usr'), email, password, status: 'onboarding' as const, locked: false };
  mc.state.users[user.id] = user;
  mc.state.payments[user.id] = [];
  const token = nextId(mc, 'tok');
  mc.state.tokens[token] = user.id;
  return { status: 201, body: { accessToken: token, user: publicUser(user) } };
};

export const signIn: MockHandler = (req, mc) => {
  const { email, password } = req.body as { email: string; password: string };
  let user = Object.values(mc.state.users).find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) return mc.error(401, 'invalid_credentials', 'Email or password is incorrect.');
  if (user.locked) return mc.error(423, 'account_locked', 'Account locked after repeated failed sign-ins.');
  const persona = user.personaId;
  if (persona && personas.find((p) => p.id === persona)?.resetOnSignIn) {
    // Replay the journey from the start each time this persona signs in.
    seedPersona(mc.state, persona);
    user = mc.state.users[user.id]!;
  }
  const token = persona ? tokenFor(persona) : nextId(mc, 'tok');
  mc.state.tokens[token] = user.id;
  return { status: 200, body: { accessToken: token, user: publicUser(user) } };
};

export const getMe: MockHandler = (_req, mc) => {
  const user = mc.state.users[mc.principal!.subjectId]!;
  return { status: 200, body: publicUser(user) };
};
