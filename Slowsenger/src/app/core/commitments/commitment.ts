import { AppUserSummary } from '../supabase/supabase.types';

// Commitments ("vállalások") recognised in conversations. This is the thesis part of the app,
// kept apart from the chat code it builds on.

/** Month names, weekday names and dates in the calendar views follow this locale (e.g. 'hu-HU'). */
export const DATE_LOCALE = 'en-GB';

/**
 * proposed → accepted → completed / rejected / overdue, plus withdrawn (docs/BUSINESS_RULES.md).
 * A proposal only becomes a commitment once the person concerned accepts it, an overdue
 * commitment can still be completed, and a withdrawn one stays on record.
 */
export type CommitmentStatus = 'proposed' | 'accepted' | 'completed' | 'rejected' | 'withdrawn' | 'overdue';

/** The chat message a commitment was recognised in. */
export interface CommitmentSource {
  threadTitle: string;
  authorName: string;
  sentByMe: boolean;
  text: string;
  /** Id of the message (offline: the signed-in user's copy of it) and its thread; null if not found. */
  messageId: string | null;
  threadId: string | null;
}

/** What a change proposal would set; fields left out stay as they are. */
export interface CommitmentChange {
  title?: string;
  due?: string | null;
  hasTime?: boolean;
  owner?: AppUserSummary;
}

/** One entry of a commitment's history. The history is only ever appended to. */
export interface CommitmentEvent {
  at: string;
  actorId: string;
  action: string;
  from: CommitmentStatus;
  to: CommitmentStatus;
  reason?: string;
  /** For changes: the values before and after. */
  before?: CommitmentChange;
  after?: CommitmentChange;
}

export interface Commitment {
  id: string;
  title: string;
  /** null when the conversation does not say who: it has to be clarified, not guessed. */
  owner: AppUserSummary | null;
  ownedByMe: boolean;
  /** ISO date-time; null when no deadline was agreed. */
  due: string | null;
  /** false: due by the end of that day. */
  hasTime: boolean;
  status: CommitmentStatus;
  /** detected: suggested by the recogniser from a message; manual: added by a user. */
  origin: 'detected' | 'manual';
  /** null for commitments added manually without a message. */
  source: CommitmentSource | null;
  /** Who added it (null: the recogniser), and who asked for it (null: taken on unasked). */
  createdBy: string | null;
  requestedBy: string | null;
  /** A change waiting for acceptance; the commitment keeps its current values until then. */
  pendingChange: { change: CommitmentChange; proposedBy: string; at: string } | null;
  history: CommitmentEvent[];
}

export const STATUS_LABELS: Record<CommitmentStatus, string> = {
  proposed: 'Needs confirmation',
  accepted: 'Accepted',
  completed: 'Completed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  overdue: 'Overdue',
};

/** When the commitment is due: the end of the day if no time was given. */
export function deadlineOf(commitment: Commitment): Date | null {
  if (!commitment.due) return null;
  const deadline = new Date(commitment.due);
  if (!commitment.hasTime) deadline.setHours(23, 59, 59, 999);
  return deadline;
}

/** The status to show: an accepted commitment past its deadline is overdue. */
export function effectiveStatus(commitment: Commitment, now: Date = new Date()): CommitmentStatus {
  const deadline = deadlineOf(commitment);
  if (commitment.status === 'accepted' && deadline && deadline < now) return 'overdue';
  return commitment.status;
}

/** Earliest deadline first; commitments without a deadline last. */
export function compareByDeadline(a: Commitment, b: Commitment): number {
  const time = (commitment: Commitment) => deadlineOf(commitment)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return time(a) - time(b);
}

/** Local calendar day as 'YYYY-MM-DD'. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Commitments with a deadline, by dayKey, earliest deadline first. Undated ones are left out. */
export function groupByDay(commitments: Commitment[]): Map<string, Commitment[]> {
  const byDay = new Map<string, Commitment[]>();
  for (const commitment of [...commitments].sort(compareByDeadline)) {
    if (!commitment.due) continue;
    const key = dayKey(new Date(commitment.due));
    byDay.set(key, [...(byDay.get(key) ?? []), commitment]);
  }
  return byDay;
}
