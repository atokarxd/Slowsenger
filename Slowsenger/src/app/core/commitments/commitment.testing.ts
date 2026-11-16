import { AppUserSummary } from '../supabase/supabase.types';
import { Commitment } from './commitment';

/** A person for tests. */
export function makeUser(id: string, name = id): AppUserSummary {
  return { id, name, username: id, avatarUrl: '' };
}

/** An accepted, undated, manually added commitment, with the given fields changed. For tests. */
export function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1',
    title: 'Test',
    owner: null,
    ownedByMe: false,
    due: null,
    hasTime: false,
    status: 'accepted',
    origin: 'manual',
    source: null,
    createdBy: null,
    requestedBy: null,
    pendingChange: null,
    history: [],
    ...overrides,
  };
}
