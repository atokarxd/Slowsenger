import { CommitmentRow, toActionPayload, toChangeRow, toCommitment } from './commitment-rows';
import { makeUser as user } from './commitment.testing';

describe('commitment rows', () => {
  const me = user('me', 'Me');
  const anna = user('anna', 'Anna');
  const people = (id: string) => [me, anna].find((p) => p.id === id);

  function row(overrides: Partial<CommitmentRow> = {}): CommitmentRow {
    return {
      id: 'c1',
      participant_ids: ['anna', 'me'],
      title: 'Send the slides',
      owner_id: 'me',
      due: '2026-11-20T23:00:00+00:00',
      has_time: false,
      status: 'proposed',
      origin: 'manual',
      source_message_id: 'm1',
      source_text: 'Can you send the slides?',
      source_author_id: 'anna',
      created_by: 'me',
      requested_by: 'anna',
      pending_change: null,
      created_at: '2026-11-16T10:00:00+00:00',
      commitment_events: [],
      ...overrides,
    };
  }

  it('maps the columns, with dates written the way the client writes them', () => {
    const commitment = toCommitment(row(), people, 'me');
    expect(commitment.owner).toEqual(me);
    expect(commitment.ownedByMe).toBe(true);
    expect(commitment.due).toBe('2026-11-20T23:00:00.000Z');
    expect(commitment.requestedBy).toBe('anna');
  });

  it('quotes the message from the reader’s side', () => {
    expect(toCommitment(row(), people, 'me').source).toEqual({
      threadTitle: 'Anna', authorName: 'Anna', sentByMe: false, text: 'Can you send the slides?', messageId: 'm1', threadId: null,
    });
    const theirs = toCommitment(row(), people, 'anna').source;
    expect(theirs?.threadTitle).toBe('Me');
    expect(theirs?.sentByMe).toBe(true);
    expect(theirs?.messageId).toBeNull(); // the creator's copy of the message
  });

  it('keeps someone missing from the profiles as an unknown user', () => {
    const commitment = toCommitment(row({ owner_id: 'gone' }), people, 'me');
    expect(commitment.owner?.name).toBe('Unknown user');
    expect(commitment.ownedByMe).toBe(false);
  });

  it('turns the pending change and the history into the app’s shape, oldest event first', () => {
    const commitment = toCommitment(row({
      pending_change: { change: { owner_id: 'anna', due: null }, proposed_by: 'me', at: '2026-11-17T08:00:00+00:00' },
      commitment_events: [
        { id: 2, at: '2026-11-16T11:00:00+00:00', actor_id: 'me', action: 'propose_change', from_status: 'accepted', to_status: 'accepted', reason: null, before: { title: 'Old' }, after: { title: 'New', has_time: true } },
        { id: 1, at: '2026-11-16T10:00:00+00:00', actor_id: 'me', action: 'create', from_status: 'proposed', to_status: 'proposed', reason: null, before: null, after: null },
      ],
    }), people, 'me');
    expect(commitment.pendingChange).toEqual({ change: { owner: anna, due: null }, proposedBy: 'me', at: '2026-11-17T08:00:00.000Z' });
    expect(commitment.history.map((event) => event.action)).toEqual(['create', 'propose_change']);
    expect(commitment.history[0]).toEqual({ at: '2026-11-16T10:00:00.000Z', actorId: 'me', action: 'create', from: 'proposed', to: 'proposed' });
    expect(commitment.history[1].before).toEqual({ title: 'Old' });
    expect(commitment.history[1].after).toEqual({ title: 'New', hasTime: true });
  });

  it('has no source without a message', () => {
    expect(toCommitment(row({ source_message_id: null, source_text: null, source_author_id: null }), people, 'me').source).toBeNull();
  });

  it('sends only the fields a change sets, under the column names', () => {
    expect(toChangeRow({ title: 'New', due: null })).toEqual({ title: 'New', due: null });
    expect(toChangeRow({ owner: anna, hasTime: false })).toEqual({ owner_id: 'anna', has_time: false });
  });

  it('gives each action what the server needs', () => {
    expect(toActionPayload({ type: 'accept' })).toEqual({});
    expect(toActionPayload({ type: 'reject' })).toEqual({});
    expect(toActionPayload({ type: 'reject', reason: 'Not me' })).toEqual({ reason: 'Not me' });
    expect(toActionPayload({ type: 'withdraw', reason: 'Ill' })).toEqual({ reason: 'Ill' });
    expect(toActionPayload({ type: 'claim', owner: me })).toEqual({ owner_id: 'me' });
    expect(toActionPayload({ type: 'propose_change', change: { title: 'X' } })).toEqual({ change: { title: 'X' } });
  });
});
