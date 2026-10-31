import type { MockHandler } from '../../core/types.ts';
import type { KycStatus } from '../state.ts';
import { nextId } from './support.ts';

// Decision time for a new application, in virtual time. Advance the clock with
// POST /__mock/clock/advance {"seconds": 30} to receive the decision immediately.
export const KYC_DECISION_SECONDS = 30;

// Magic last names choose the eventual outcome; anything else is approved.
const OUTCOME_BY_LAST_NAME: Record<string, KycStatus> = { rejected: 'rejected', moreinfo: 'needs_more_info' };

export const submitKyc: MockHandler = (req, mc) => {
  const userId = mc.principal!.subjectId;
  const current = mc.state.kyc[userId];
  if (current && current.status !== 'needs_more_info') {
    return mc.error(409, 'application_exists', `An application is already ${current.status}.`);
  }
  const { lastName } = req.body as { lastName: string };
  const outcome = OUTCOME_BY_LAST_NAME[lastName.toLowerCase()] ?? 'approved';
  const app = { id: nextId(mc, 'kyc'), status: 'pending' as KycStatus, submittedAt: mc.now().toISOString(), decidedAt: null as string | null };
  mc.state.kyc[userId] = app;
  mc.schedule(KYC_DECISION_SECONDS * 1000, `kyc ${app.id} -> ${outcome}`, (later) => {
    const rec = later.state.kyc[userId];
    if (!rec || rec.id !== app.id) return;
    rec.status = outcome;
    rec.decidedAt = later.now().toISOString();
    const user = later.state.users[userId];
    if (user && outcome === 'approved') user.status = 'active';
  });
  return { status: 202, body: app };
};

export const getCurrentKyc: MockHandler = (_req, mc) => {
  const app = mc.state.kyc[mc.principal!.subjectId];
  if (!app) return mc.error(404, 'not_found', 'No KYC application has been submitted.');
  return { status: 200, body: app };
};
