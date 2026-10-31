import type { Scenario } from '../core/types.ts';
import { FRESH_DOMAIN } from './handlers/auth.ts';
import { KYC_DECISION_SECONDS } from './handlers/kyc.ts';
import { CARD_DECLINE, CARD_PENDING } from './handlers/payments.ts';
import { emailFor, PASSWORD } from './personas.ts';

const kycBody = (lastName: string) => ({ firstName: 'Sam', lastName, dateOfBirth: '1990-04-01' });
const pay = (cardToken: string) => ({ amount: 1250, currency: 'GBP', cardToken });

export const scenarios: Scenario[] = [
  {
    id: 'signUp.created', operationId: 'signUp', status: 201, trigger: 'input', summary: 'New account, repeatable.',
    how: `Sign up with any address ending ${FRESH_DOMAIN}; repeating it replaces the earlier account.`,
    covers: ['User.status=onboarding'],
    request: { method: 'POST', path: '/v1/auth/sign-up', body: { email: `journey${FRESH_DOMAIN}`, password: PASSWORD } },
  },
  {
    id: 'signUp.email_taken', operationId: 'signUp', status: 409, errorCode: 'email_taken', trigger: 'input', summary: 'Email already registered.',
    how: 'Sign up with any persona email, e.g. active@mock.acme.test.',
    request: { method: 'POST', path: '/v1/auth/sign-up', body: { email: emailFor('active'), password: PASSWORD } },
  },
  {
    id: 'signIn.ok', operationId: 'signIn', status: 200, trigger: 'persona', summary: 'Signed in.',
    how: `Sign in with any persona email and password ${PASSWORD}.`,
    covers: ['User.status=active'],
    request: { method: 'POST', path: '/v1/auth/sign-in', body: { email: emailFor('active'), password: PASSWORD } },
  },
  {
    id: 'signIn.wrong_password', operationId: 'signIn', status: 401, errorCode: 'invalid_credentials', trigger: 'input', summary: 'Bad credentials.',
    how: 'Sign in with a persona email and any other password.',
    request: { method: 'POST', path: '/v1/auth/sign-in', body: { email: emailFor('active'), password: 'wrong-password' } },
  },
  {
    id: 'signIn.locked', operationId: 'signIn', status: 423, errorCode: 'account_locked', trigger: 'persona', summary: 'Account locked.',
    how: 'Sign in as persona locked.',
    request: { method: 'POST', path: '/v1/auth/sign-in', body: { email: emailFor('locked'), password: PASSWORD } },
  },
  {
    id: 'getMe.suspended', operationId: 'getMe', status: 200, trigger: 'persona', summary: 'Profile of a suspended account.',
    how: 'Call as suspended; other personas return their own status.',
    covers: ['User.status=suspended'],
    request: { method: 'GET', path: '/v1/me', persona: 'suspended' },
  },
  {
    id: 'getCurrentKyc.approved_after_journey', operationId: 'getCurrentKyc', status: 200, trigger: 'state',
    summary: 'Onboarding journey: submit, wait, approved.',
    how: `As new_user, submit KYC with any last name, then advance the clock ${KYC_DECISION_SECONDS}s.`,
    covers: ['KycApplication.status=approved'],
    setup: [{ method: 'POST', path: '/v1/kyc/applications', persona: 'new_user', body: kycBody('Smith') }],
    advanceClockSeconds: KYC_DECISION_SECONDS,
    request: { method: 'GET', path: '/v1/kyc/applications/current', persona: 'new_user' },
  },
  {
    id: 'submitKyc.pending', operationId: 'submitKyc', status: 202, trigger: 'persona', summary: 'Accepted, decision pending.',
    how: 'As new_user, submit KYC. Last name "Rejected" or "Moreinfo" chooses that eventual outcome.',
    covers: ['KycApplication.status=pending'],
    request: { method: 'POST', path: '/v1/kyc/applications', persona: 'new_user', body: kycBody('Smith') },
  },
  {
    id: 'submitKyc.already_submitted', operationId: 'submitKyc', status: 409, errorCode: 'application_exists', trigger: 'persona',
    summary: 'Application already in progress.', how: 'Submit KYC as kyc_pending or any approved persona.',
    request: { method: 'POST', path: '/v1/kyc/applications', persona: 'kyc_pending', body: kycBody('Smith') },
  },
  {
    id: 'getCurrentKyc.none', operationId: 'getCurrentKyc', status: 404, errorCode: 'not_found', trigger: 'persona', summary: 'Nothing submitted yet.',
    how: 'Call as new_user.',
    request: { method: 'GET', path: '/v1/kyc/applications/current', persona: 'new_user' },
  },
  {
    id: 'getCurrentKyc.rejected', operationId: 'getCurrentKyc', status: 200, trigger: 'persona', summary: 'Rejected application.',
    how: 'Call as kyc_rejected.',
    covers: ['KycApplication.status=rejected'],
    request: { method: 'GET', path: '/v1/kyc/applications/current', persona: 'kyc_rejected' },
  },
  {
    id: 'getCurrentKyc.needs_more_info', operationId: 'getCurrentKyc', status: 200, trigger: 'persona', summary: 'Returned for more information.',
    how: 'Call as kyc_needs_info.',
    covers: ['KycApplication.status=needs_more_info'],
    request: { method: 'GET', path: '/v1/kyc/applications/current', persona: 'kyc_needs_info' },
  },
  {
    id: 'listPayments.mixed', operationId: 'listPayments', status: 200, trigger: 'persona', summary: 'Payments in every status.',
    how: 'Call as active.',
    covers: ['Payment.status=succeeded', 'Payment.status=declined', 'Payment.status=pending'],
    request: { method: 'GET', path: '/v1/payments', persona: 'active' },
  },
  {
    id: 'listPayments.page', operationId: 'listPayments', status: 200, trigger: 'persona', summary: 'First of three pages.',
    how: 'Call as active_many_payments; follow nextCursor. active_no_payments returns an empty list.',
    request: { method: 'GET', path: '/v1/payments', persona: 'active_many_payments' },
  },
  {
    id: 'listPayments.invalid_cursor', operationId: 'listPayments', status: 400, errorCode: 'invalid_cursor', trigger: 'input',
    summary: 'Unknown cursor.', how: 'Send any cursor that was not returned as nextCursor.',
    request: { method: 'GET', path: '/v1/payments', persona: 'active', query: { cursor: 'pay_unknown' } },
  },
  {
    id: 'createPayment.succeeded', operationId: 'createPayment', status: 201, trigger: 'default', summary: 'Payment succeeded.',
    how: 'As active, pay with any card token.',
    covers: ['Payment.status=succeeded'],
    request: { method: 'POST', path: '/v1/payments', persona: 'active', headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000001' }, body: pay('tok_visa') },
  },
  {
    id: 'createPayment.pending', operationId: 'createPayment', status: 201, trigger: 'input', summary: 'Pending, settles after 60s with a payment.updated webhook.',
    how: `As active, pay with card token ${CARD_PENDING}; advance the clock 60s to settle.`,
    covers: ['Payment.status=pending'],
    request: { method: 'POST', path: '/v1/payments', persona: 'active', headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000002' }, body: pay(CARD_PENDING) },
  },
  {
    id: 'createPayment.declined', operationId: 'createPayment', status: 402, errorCode: 'card_declined', trigger: 'input', summary: 'Card declined.',
    how: `As active, pay with card token ${CARD_DECLINE}.`,
    request: { method: 'POST', path: '/v1/payments', persona: 'active', headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000003' }, body: pay(CARD_DECLINE) },
  },
  {
    id: 'createPayment.not_active', operationId: 'createPayment', status: 403, errorCode: 'account_not_active', trigger: 'persona', summary: 'Account not active.',
    how: 'Pay as suspended, kyc_pending or new_user.',
    request: { method: 'POST', path: '/v1/payments', persona: 'suspended', headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000004' }, body: pay('tok_visa') },
  },
  {
    id: 'createPayment.issuer_hold', operationId: 'createPayment', status: 402, errorCode: 'issuer_hold', trigger: 'header',
    summary: 'Issuer hold, only reachable on demand.', how: 'Send X-Mock-Scenario: createPayment.issuer_hold.',
    respond: (mc, req) => mc.error(402, 'issuer_hold', `The issuer placed a hold on this payment of ${req.body.amount}.`),
    request: { method: 'POST', path: '/v1/payments', persona: 'active', headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000005' }, body: pay('tok_visa') },
  },
];
