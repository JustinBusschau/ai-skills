import type { MockContext } from '../../core/types.ts';
import type { UserRecord } from '../state.ts';

export const nextId = (mc: MockContext, prefix: string) => `${prefix}_${String(++mc.state.seq).padStart(6, '0')}`;

export function currentUser(mc: MockContext): UserRecord | undefined {
  return mc.principal ? mc.state.users[mc.principal.subjectId] : undefined;
}

export const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, status: u.status });
