import { effectiveStatus } from './commitment';
import { makeCommitment, makeUser } from './commitment.testing';
import { ActionContext, CommitmentAction, allowedActions, transition } from './lifecycle';

const anna = makeUser('anna', 'Anna');
const bence = makeUser('bence', 'Bence');
const now = new Date(2026, 10, 6, 12, 0);
const as = (actorId: string, extra: Partial<ActionContext> = {}): ActionContext => ({ actorId, now, ...extra });

const run = (commitment = makeCommitment(), action: CommitmentAction, context: ActionContext) => {
  const result = transition(commitment, action, context);
  if (!result.ok) throw new Error(result.error);
  return result.commitment;
};

describe('commitment lifecycle', () => {
  // "Megcsinálnád péntekig?" (Anna) → "Igen, vállalom." (Bence)
  const proposal = makeCommitment({ status: 'proposed', owner: bence, requestedBy: 'anna', createdBy: 'anna',
    due: new Date(2026, 10, 6).toISOString() });

  it('lets only the person concerned accept a proposal', () => {
    expect(transition(proposal, { type: 'accept' }, as('anna'))).toEqual({ ok: false, error: 'Only the person it is meant for can accept it.' });
    expect(run(proposal, { type: 'accept' }, as('bence')).status).toBe('accepted');
  });

  it('does not let anyone accept a proposal without an owner until someone takes it on', () => {
    const unowned = makeCommitment({ status: 'proposed', owner: null });
    expect(transition(unowned, { type: 'accept' }, as('bence')).ok).toBe(false);
    const claimed = run(unowned, { type: 'claim', owner: bence }, as('bence'));
    expect(claimed.status).toBe('proposed');
    expect(run(claimed, { type: 'accept' }, as('bence')).status).toBe('accepted');
    expect(transition(unowned, { type: 'claim', owner: bence }, as('anna')).ok).toBe(false);
  });

  it('lets a late commitment still be completed', () => {
    const late = makeCommitment({ owner: bence, due: new Date(2026, 10, 1).toISOString() });
    expect(effectiveStatus(late, now)).toBe('overdue');
    const done = run(late, { type: 'complete' }, as('bence'));
    expect(done.status).toBe('completed');
    expect(done.history.at(-1)).toMatchObject({ action: 'complete', from: 'overdue', to: 'completed' });
  });

  it('keeps a withdrawn commitment on record with its reason', () => {
    const accepted = makeCommitment({ owner: bence });
    expect(transition(accepted, { type: 'withdraw', reason: ' ' }, as('bence')).ok).toBe(false);
    const withdrawn = run(accepted, { type: 'withdraw', reason: 'Nem fér bele.' }, as('bence'));
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.title).toBe(accepted.title);
    expect(withdrawn.history).toEqual([expect.objectContaining({ action: 'withdraw', reason: 'Nem fér bele.', from: 'accepted', to: 'withdrawn' })]);
  });

  it('does not let a requested deadline change overwrite the commitment until the requester accepts', () => {
    // "Inkább hétfőre tudom." (Bence)
    const accepted = run(proposal, { type: 'accept' }, as('bence'));
    const monday = new Date(2026, 10, 9).toISOString();
    const asked = run(accepted, { type: 'propose_change', change: { due: monday } }, as('bence'));
    expect(asked.due).toBe(accepted.due);
    expect(asked.pendingChange?.change).toEqual({ due: monday });

    expect(transition(asked, { type: 'accept_change' }, as('bence')).ok).toBe(false);
    const agreed = run(asked, { type: 'accept_change' }, as('anna'));
    expect(agreed.due).toBe(monday);
    expect(agreed.pendingChange).toBeNull();
    expect(agreed.history.at(-1)).toMatchObject({ action: 'accept_change', before: { due: accepted.due }, after: { due: monday } });
  });

  it('applies a change to a commitment taken on unasked at once, as a new version on record', () => {
    const own = makeCommitment({ owner: bence, due: new Date(2026, 10, 6).toISOString() });
    const monday = new Date(2026, 10, 9).toISOString();
    const changed = run(own, { type: 'propose_change', change: { due: monday } }, as('bence'));
    expect(changed.due).toBe(monday);
    expect(changed.history.at(-1)).toMatchObject({ before: { due: own.due }, after: { due: monday } });
  });

  it('asks the new owner when a commitment is handed over', () => {
    const own = makeCommitment({ owner: bence });
    const handed = run(own, { type: 'propose_change', change: { owner: anna } }, as('bence'));
    expect(handed.owner).toBe(bence);
    expect(transition(handed, { type: 'accept_change' }, as('bence')).ok).toBe(false);
    expect(run(handed, { type: 'accept_change' }, as('anna')).owner).toBe(anna);
  });

  it('lets the owner turn down a change someone else proposed', () => {
    const own = makeCommitment({ owner: bence });
    const asked = run(own, { type: 'propose_change', change: { title: 'Más feladat' } }, as('anna'));
    const declined = run(asked, { type: 'reject_change' }, as('bence'));
    expect(declined.title).toBe('Test');
    expect(declined.pendingChange).toBeNull();
  });

  it('never leaves a final state', () => {
    for (const status of ['completed', 'rejected', 'withdrawn'] as const) {
      const final = makeCommitment({ owner: bence, status });
      expect(allowedActions(final, as('bence'))).toEqual([]);
      expect(transition(final, { type: 'complete' }, as('bence')).ok).toBe(false);
    }
  });

  it('lets a room owner reject a wrongly recognised proposal, but not accept it', () => {
    expect(run(proposal, { type: 'reject', reason: 'Nem vállalás.' }, as('anna', { isRoomOwner: true })).status).toBe('rejected');
    expect(transition(proposal, { type: 'accept' }, as('anna', { isRoomOwner: true })).ok).toBe(false);
  });

  it('lists the actions that fit the person and the state', () => {
    expect(allowedActions(proposal, as('bence'))).toEqual(['accept', 'reject', 'propose_change']);
    expect(allowedActions(proposal, as('anna'))).toEqual(['propose_change']);
    expect(allowedActions(makeCommitment({ owner: bence }), as('bence'))).toEqual(['complete', 'withdraw', 'propose_change']);
  });

  it('does not change the commitment it was given', () => {
    const before = structuredClone(proposal);
    run(proposal, { type: 'accept' }, as('bence'));
    expect(proposal).toEqual(before);
  });
});
