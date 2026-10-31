import type { MockHandler } from '../../core/types.ts';
import { getMe, signIn, signUp } from './auth.ts';
import { getCurrentKyc, submitKyc } from './kyc.ts';
import { createPayment, listPayments } from './payments.ts';

// Keyed by operationId. Operations without a handler fall back to the spec's examples.
export const handlers: Record<string, MockHandler> = { signUp, signIn, getMe, submitKyc, getCurrentKyc, listPayments, createPayment };
