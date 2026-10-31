// The session's data. Keep it plain JSON (records and arrays, no Maps or class
// instances) so /__mock/state can show it and the tests can compare it with the seed.
export type UserStatus = 'onboarding' | 'active' | 'suspended';
export type KycStatus = 'pending' | 'approved' | 'rejected' | 'needs_more_info';
export type PaymentStatus = 'succeeded' | 'declined' | 'pending';

export interface UserRecord {
  id: string;
  email: string;
  password: string;
  status: UserStatus;
  personaId?: string;
  locked: boolean;
}

export interface KycRecord {
  id: string;
  status: KycStatus;
  submittedAt: string;
  decidedAt: string | null;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currency: 'GBP' | 'EUR';
  status: PaymentStatus;
  createdAt: string;
}

export interface State {
  users: Record<string, UserRecord>;
  /** access token -> user id */
  tokens: Record<string, string>;
  /** user id -> current application */
  kyc: Record<string, KycRecord>;
  /** user id -> payments, newest first */
  payments: Record<string, PaymentRecord[]>;
  seq: number;
}
