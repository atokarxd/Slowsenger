import { AppUserSummary } from '../supabase/supabase.types';
import { Commitment, CommitmentChange, CommitmentEvent, CommitmentStatus, effectiveStatus } from './commitment';

// The commitment state machine of docs/BUSINESS_RULES.md (sections 2 and 3). Pure functions: the
// offline app runs them in the browser; the Supabase version has to enforce the same rules on the
// server, so a client cannot skip them.

export type CommitmentAction =
  | { type: 'accept' }
  | { type: 'reject'; reason?: string }
  | { type: 'claim'; owner: AppUserSummary }
  | { type: 'complete' }
  | { type: 'withdraw'; reason: string }
  | { type: 'propose_change'; change: CommitmentChange }
  | { type: 'accept_change' }
  | { type: 'reject_change' };

export type ActionType = CommitmentAction['type'];

export interface ActionContext {
  actorId: string;
  now: Date;
  /** Room owners may reject a wrongly recognised proposal. */
  isRoomOwner?: boolean;
}

export type TransitionResult = { ok: true; commitment: Commitment } | { ok: false; error: string };

const FINAL: CommitmentStatus[] = ['completed', 'rejected', 'withdrawn'];
const OPEN: CommitmentStatus[] = ['accepted', 'overdue'];

/** Who has to accept the pending change (section 3 of the rules). */
export function changeApprover(commitment: Commitment): string | null {
  const pending = commitment.pendingChange;
  if (!pending) return null;
  if (pending.change.owner) return pending.change.owner.id; // a new owner takes it on themselves
  if (pending.proposedBy === commitment.owner?.id) return commitment.requestedBy; // the owner asks the requester
  return commitment.owner?.id ?? null; // anyone else asks the owner
}

function check(commitment: Commitment, action: CommitmentAction, context: ActionContext): string | null {
  const status = effectiveStatus(commitment, context.now);
  const isOwner = commitment.owner?.id === context.actorId;

  if (FINAL.includes(status)) return `A ${status} commitment cannot change any more.`;

  switch (action.type) {
    case 'accept':
      if (status !== 'proposed') return 'Only a proposal can be accepted.';
      if (!commitment.owner) return 'Nobody is named yet: take it on first.';
      return isOwner ? null : 'Only the person it is meant for can accept it.';
    case 'reject':
      if (status !== 'proposed') return 'Only a proposal can be rejected; withdraw an accepted commitment instead.';
      if (isOwner || context.isRoomOwner) return null;
      return !commitment.owner && commitment.createdBy === context.actorId ? null : 'Only the person it is meant for can reject it.';
    case 'claim':
      if (status !== 'proposed') return 'Only a proposal can be taken on.';
      if (commitment.owner) return 'It already has an owner.';
      return action.owner.id === context.actorId ? null : 'You can only take it on yourself.';
    case 'complete':
      if (!OPEN.includes(status)) return 'Only an accepted commitment can be completed.';
      return isOwner ? null : 'Only the owner can mark it completed.';
    case 'withdraw':
      if (!OPEN.includes(status)) return 'Only an accepted commitment can be withdrawn; reject a proposal instead.';
      if (!isOwner) return 'Only the owner can withdraw it.';
      return action.reason.trim() ? null : 'Say why it is withdrawn: it stays on record.';
    case 'propose_change': {
      if (!OPEN.includes(status) && status !== 'proposed') return 'This commitment cannot be changed.';
      if (commitment.pendingChange) return 'A change is already waiting for an answer.';
      const { title, due, hasTime, owner } = action.change;
      const changes = (title !== undefined && title !== commitment.title)
        || (due !== undefined && due !== commitment.due)
        || (hasTime !== undefined && hasTime !== commitment.hasTime)
        || (owner !== undefined && owner.id !== commitment.owner?.id);
      return changes ? null : 'The change does not change anything.';
    }
    case 'accept_change':
      if (!commitment.pendingChange) return 'There is no change waiting.';
      return changeApprover(commitment) === context.actorId ? null : 'Someone else has to accept this change.';
    case 'reject_change':
      if (!commitment.pendingChange) return 'There is no change waiting.';
      return changeApprover(commitment) === context.actorId || commitment.pendingChange.proposedBy === context.actorId
        ? null
        : 'Only the one asked or the one asking can turn the change down.';
  }
}

/** Applies a change; owner changes also re-assign who has it, the history keeps the previous values. */
function withChange(commitment: Commitment, change: CommitmentChange): { next: Commitment; before: CommitmentChange } {
  const before: CommitmentChange = {};
  const next = { ...commitment };
  if (change.title !== undefined) { before.title = commitment.title; next.title = change.title; }
  if (change.due !== undefined) { before.due = commitment.due; next.due = change.due; }
  if (change.hasTime !== undefined) { before.hasTime = commitment.hasTime; next.hasTime = change.hasTime; }
  if (change.owner !== undefined) {
    if (commitment.owner) before.owner = commitment.owner;
    next.owner = change.owner;
  }
  return { next, before };
}

/** Runs one action, or says why it is not allowed. Never changes the commitment it is given. */
export function transition(commitment: Commitment, action: CommitmentAction, context: ActionContext): TransitionResult {
  const error = check(commitment, action, context);
  if (error) return { ok: false, error };

  const from = effectiveStatus(commitment, context.now);
  const at = context.now.toISOString();
  let next: Commitment = { ...commitment };
  let event: Partial<CommitmentEvent> = {};

  switch (action.type) {
    case 'accept':
      next.status = 'accepted';
      break;
    case 'reject':
      next.status = 'rejected';
      if (action.reason) event.reason = action.reason;
      break;
    case 'claim':
      next.owner = action.owner; // still a proposal: accepting it is a separate step
      break;
    case 'complete':
      next.status = 'completed'; // also when overdue: lateness does not prevent completion
      break;
    case 'withdraw':
      next.status = 'withdrawn';
      event.reason = action.reason.trim();
      break;
    case 'propose_change': {
      const selfCommitted = commitment.owner?.id === context.actorId && !commitment.requestedBy && !action.change.owner;
      if (selfCommitted) {
        // Taken on unasked: the owner may change it, but as a new version on record
        const { next: changed, before } = withChange(commitment, action.change);
        next = changed;
        event = { before, after: action.change };
      } else {
        next.pendingChange = { change: action.change, proposedBy: context.actorId, at };
        event = { after: action.change };
      }
      break;
    }
    case 'accept_change': {
      const { next: changed, before } = withChange(commitment, commitment.pendingChange!.change);
      next = { ...changed, pendingChange: null };
      event = { before, after: commitment.pendingChange!.change };
      break;
    }
    case 'reject_change':
      next.pendingChange = null;
      event = { after: commitment.pendingChange!.change };
      break;
  }

  // Store the plain status: overdue is derived from the deadline, never saved.
  if (next.status === 'overdue') next.status = 'accepted';
  next.history = [...commitment.history, {
    at, actorId: context.actorId, action: action.type, from, to: effectiveStatus(next, context.now), ...event,
  }];
  return { ok: true, commitment: next };
}

/** The actions the actor may take now, for showing the right buttons. */
export function allowedActions(commitment: Commitment, context: ActionContext): ActionType[] {
  const me: AppUserSummary = { id: context.actorId, name: '', username: '', avatarUrl: '' };
  const probes: CommitmentAction[] = [
    { type: 'accept' }, { type: 'reject' }, { type: 'claim', owner: me }, { type: 'complete' },
    { type: 'withdraw', reason: 'probe' }, { type: 'propose_change', change: { title: `${commitment.title} ` } },
    { type: 'accept_change' }, { type: 'reject_change' },
  ];
  return probes.filter((action) => check(commitment, action, context) === null).map((action) => action.type);
}
