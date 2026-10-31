// Seeded personas. Each one is a ready-made account in a specific state, present in
// every session, with a fixed token so a client can skip sign-in entirely.
// All dates derive from SEED_EPOCH so the seed is identical on every run.
import type { Persona } from '../core/types.ts';
import type { KycStatus, PaymentRecord, State, UserStatus } from './state.ts';

export const SEED_EPOCH = Date.parse('2026-01-15T09:00:00Z');
export const PASSWORD = 'Passw0rd!';
export const tokenFor = (personaId: string) => `mock_${personaId}`;
export const emailFor = (personaId: string) => `${personaId.replace(/_/g, '.')}@mock.acme.test`;

interface PersonaSeed extends Omit<Persona, "credentials"> {
  status: UserStatus;
  locked?: boolean;
  kyc?: KycStatus;
  paymentCount?: number;
}

const seeds: PersonaSeed[] = [
  { id: 'new_user', summary: 'Just signed up; onboarding not started.', status: 'onboarding', resetOnSignIn: true },
  { id: 'kyc_pending', summary: 'KYC submitted, awaiting decision.', status: 'onboarding', kyc: 'pending' },
  { id: 'kyc_needs_info', summary: 'KYC returned for more information.', status: 'onboarding', kyc: 'needs_more_info' },
  { id: 'kyc_rejected', summary: 'KYC rejected; cannot pay.', status: 'onboarding', kyc: 'rejected' },
  { id: 'active', summary: 'Verified with three payments of mixed status.', status: 'active', kyc: 'approved', paymentCount: 3 },
  { id: 'active_no_payments', summary: 'Verified, empty payment history.', status: 'active', kyc: 'approved', paymentCount: 0 },
  { id: 'active_many_payments', summary: 'Verified, 45 payments (three pages at the default limit).', status: 'active', kyc: 'approved', paymentCount: 45 },
  { id: 'suspended', summary: 'Account suspended; reads work, payments are refused.', status: 'suspended', kyc: 'approved', paymentCount: 1 },
  { id: 'locked', summary: 'Locked after failed sign-ins; sign-in returns 423.', status: 'active', locked: true, kyc: 'approved' },
];

export const personas: Persona[] = seeds.map(({ id, summary, resetOnSignIn }) => ({
  id,
  summary,
  resetOnSignIn,
  credentials: { email: emailFor(id), password: PASSWORD, bearer: tokenFor(id) },
}));

const iso = (offsetMinutes: number) => new Date(SEED_EPOCH + offsetMinutes * 60_000).toISOString();
const STATUSES = ['succeeded', 'declined', 'pending'] as const;

export function seedPersona(state: State, personaId: string): boolean {
  const p = seeds.find((s) => s.id === personaId);
  if (!p) return false;
  const userId = `usr_${p.id}`;
  state.users[userId] = { id: userId, email: emailFor(p.id), password: PASSWORD, status: p.status, personaId: p.id, locked: !!p.locked };
  state.tokens[tokenFor(p.id)] = userId;
  delete state.kyc[userId];
  if (p.kyc) {
    const decided = p.kyc !== 'pending';
    state.kyc[userId] = { id: `kyc_${p.id}`, status: p.kyc, submittedAt: iso(0), decidedAt: decided ? iso(30) : null };
  }
  const payments: PaymentRecord[] = [];
  for (let i = 0; i < (p.paymentCount ?? 0); i++) {
    payments.push({
      id: `pay_${p.id}_${String(i + 1).padStart(3, '0')}`,
      amount: 100 + i * 37,
      currency: i % 4 === 3 ? 'EUR' : 'GBP',
      status: STATUSES[i % 3]!,
      createdAt: iso(60 + i * 90),
    });
  }
  state.payments[userId] = payments.reverse();
  return true;
}

export function createState(): State {
  const state: State = { users: {}, tokens: {}, kyc: {}, payments: {}, seq: 1000 };
  for (const p of seeds) seedPersona(state, p.id);
  return state;
}
