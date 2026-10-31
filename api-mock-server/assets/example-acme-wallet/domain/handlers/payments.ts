import type { MockHandler } from '../../core/types.ts';
import type { PaymentRecord } from '../state.ts';
import { currentUser, nextId } from './support.ts';

// Magic card tokens, in the style of payment-provider test cards.
export const CARD_DECLINE = 'tok_decline';
export const CARD_PENDING = 'tok_pending';
export const PENDING_SETTLE_SECONDS = 60;

export const listPayments: MockHandler = (req, mc) => {
  const all = mc.state.payments[mc.principal!.subjectId] ?? [];
  const limit = Number(req.query.limit ?? 20);
  const cursor = req.query.cursor as string | undefined;
  const start = cursor ? all.findIndex((p) => p.id === cursor) + 1 : 0;
  if (cursor && start === 0) return mc.error(400, 'invalid_cursor', 'Cursor not recognised.');
  const data = all.slice(start, start + limit);
  const nextCursor = start + limit < all.length ? data[data.length - 1]!.id : null;
  return { status: 200, body: { data, nextCursor } };
};

export const createPayment: MockHandler = (req, mc) => {
  const user = currentUser(mc)!;
  if (user.status !== 'active') return mc.error(403, 'account_not_active', `Payments need an active account; this one is ${user.status}.`);
  const { amount, currency, cardToken } = req.body as { amount: number; currency: 'GBP' | 'EUR'; cardToken: string };
  if (cardToken === CARD_DECLINE) return mc.error(402, 'card_declined', 'The card was declined.');
  const payment: PaymentRecord = {
    id: nextId(mc, 'pay'),
    amount,
    currency,
    status: cardToken === CARD_PENDING ? 'pending' : 'succeeded',
    createdAt: mc.now().toISOString(),
  };
  (mc.state.payments[user.id] ??= []).unshift(payment);
  if (payment.status === 'pending') {
    mc.schedule(PENDING_SETTLE_SECONDS * 1000, `payment ${payment.id} -> succeeded`, (later) => {
      const rec = later.state.payments[user.id]?.find((p) => p.id === payment.id);
      if (!rec) return;
      rec.status = 'succeeded';
      later.emitWebhook('payment.updated', { type: 'payment.updated', data: rec });
    });
  }
  return { status: 201, body: payment };
};
