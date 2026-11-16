import { DEFAULT_AVATAR } from '../default-avatar';
import { AppUserSummary } from '../supabase/supabase.types';
import { Commitment, CommitmentChange, CommitmentEvent, CommitmentStatus } from './commitment';
import { CommitmentAction } from './lifecycle';

// The commitments as stored in Supabase (supabase/migrations/20261116_commitments.sql), and how
// they become the app's Commitment and back. Pure functions, so they can be tested without a server.

export const COMMITMENT_COLUMNS = 'id, participant_ids, title, owner_id, due, has_time, status, origin, '
  + 'source_message_id, source_text, source_author_id, created_by, requested_by, pending_change, created_at, '
  + 'commitment_events(id, at, actor_id, action, from_status, to_status, reason, before, after)';

/** A change as stored: the keys of the columns it sets. */
export interface CommitmentChangeRow {
  title?: string;
  due?: string | null;
  has_time?: boolean;
  owner_id?: string;
}

export interface CommitmentEventRow {
  id: number;
  at: string;
  actor_id: string | null;
  action: string;
  from_status: CommitmentStatus;
  to_status: CommitmentStatus;
  reason: string | null;
  before: CommitmentChangeRow | null;
  after: CommitmentChangeRow | null;
}

export interface CommitmentRow {
  id: string;
  participant_ids: string[];
  title: string;
  owner_id: string | null;
  due: string | null;
  has_time: boolean;
  status: Exclude<CommitmentStatus, 'overdue'>;
  origin: 'detected' | 'manual';
  source_message_id: string | null;
  source_text: string | null;
  source_author_id: string | null;
  created_by: string | null;
  requested_by: string | null;
  pending_change: { change: CommitmentChangeRow; proposed_by: string; at: string } | null;
  created_at: string;
  commitment_events: CommitmentEventRow[];
}

/** Looks up a person by id. */
export type PeopleLookup = (userId: string) => AppUserSummary | undefined;

/** Someone no longer found among the profiles. */
function unknownUser(id: string): AppUserSummary {
  return { id, name: 'Unknown user', username: 'unknown', avatarUrl: DEFAULT_AVATAR };
}

/** The same instant as the client writes it: Postgres returns '+00:00' instead of 'Z' and drops the milliseconds. */
function toIso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function toChange(row: CommitmentChangeRow, people: PeopleLookup): CommitmentChange {
  const change: CommitmentChange = {};
  if (row.title !== undefined) change.title = row.title;
  if (row.due !== undefined) change.due = toIso(row.due);
  if (row.has_time !== undefined) change.hasTime = row.has_time;
  if (row.owner_id !== undefined) change.owner = people(row.owner_id) ?? unknownUser(row.owner_id);
  return change;
}

export function toChangeRow(change: CommitmentChange): CommitmentChangeRow {
  const row: CommitmentChangeRow = {};
  if (change.title !== undefined) row.title = change.title;
  if (change.due !== undefined) row.due = change.due;
  if (change.hasTime !== undefined) row.has_time = change.hasTime;
  if (change.owner !== undefined) row.owner_id = change.owner.id;
  return row;
}

function toEvent(row: CommitmentEventRow, people: PeopleLookup): CommitmentEvent {
  return {
    at: toIso(row.at)!,
    actorId: row.actor_id ?? '',
    action: row.action,
    from: row.from_status,
    to: row.to_status,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.before ? { before: toChange(row.before, people) } : {}),
    ...(row.after ? { after: toChange(row.after, people) } : {}),
  };
}

/** The commitment as the signed-in user (myId) sees it. */
export function toCommitment(row: CommitmentRow, people: PeopleLookup, myId: string | null): Commitment {
  const person = (id: string | null) => (id === null ? null : people(id) ?? unknownUser(id));
  const partnerId = row.participant_ids.find((id) => id !== myId) ?? null;
  const owner = person(row.owner_id);
  return {
    id: row.id,
    title: row.title,
    owner,
    ownedByMe: !!owner && owner.id === myId,
    due: toIso(row.due),
    hasTime: row.has_time,
    status: row.status,
    origin: row.origin,
    source: row.source_text === null ? null : {
      threadTitle: person(partnerId)?.name ?? '',
      authorName: person(row.source_author_id)?.name ?? '',
      sentByMe: row.source_author_id === myId,
      text: row.source_text,
      // The creator's copy of the message: the other person cannot open it
      messageId: row.created_by === myId ? row.source_message_id : null,
      threadId: null,
    },
    createdBy: row.created_by,
    requestedBy: row.requested_by,
    pendingChange: row.pending_change && {
      change: toChange(row.pending_change.change, people),
      proposedBy: row.pending_change.proposed_by,
      at: toIso(row.pending_change.at)!,
    },
    history: [...row.commitment_events].sort((a, b) => a.id - b.id).map((event) => toEvent(event, people)),
  };
}

/** What apply_commitment_action needs besides the action's name. */
export function toActionPayload(action: CommitmentAction): Record<string, unknown> {
  switch (action.type) {
    case 'reject':
      return action.reason ? { reason: action.reason } : {};
    case 'withdraw':
      return { reason: action.reason };
    case 'claim':
      return { owner_id: action.owner.id };
    case 'propose_change':
      return { change: toChangeRow(action.change) };
    default:
      return {};
  }
}
