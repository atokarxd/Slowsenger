import { compareByDeadline, dayKey, effectiveStatus, groupByDay } from './commitment';
import { makeCommitment as commitment } from './commitment.testing';

describe('commitment helpers', () => {
  const now = new Date(2026, 10, 4, 15, 0);

  it('shows an accepted commitment past its deadline as overdue', () => {
    expect(effectiveStatus(commitment({ due: new Date(2026, 10, 4, 14, 0).toISOString(), hasTime: true }), now)).toBe('overdue');
  });

  it('keeps an all-day commitment open until the end of its day', () => {
    expect(effectiveStatus(commitment({ due: new Date(2026, 10, 4).toISOString() }), now)).toBe('accepted');
  });

  it('never turns proposals, completed or rejected commitments overdue', () => {
    const past = new Date(2026, 10, 1).toISOString();
    expect(effectiveStatus(commitment({ due: past, status: 'proposed' }), now)).toBe('proposed');
    expect(effectiveStatus(commitment({ due: past, status: 'completed' }), now)).toBe('completed');
    expect(effectiveStatus(commitment({ due: past, status: 'rejected' }), now)).toBe('rejected');
  });

  it('does not make a commitment without a deadline overdue', () => {
    expect(effectiveStatus(commitment({ due: null }), now)).toBe('accepted');
  });

  it('sorts timed deadlines before the same day’s all-day ones, and undated last', () => {
    const allDay = commitment({ id: 'all-day', due: new Date(2026, 10, 4).toISOString() });
    const timed = commitment({ id: 'timed', due: new Date(2026, 10, 4, 18, 0).toISOString(), hasTime: true });
    const undated = commitment({ id: 'undated' });
    expect([undated, allDay, timed].sort(compareByDeadline).map((c) => c.id)).toEqual(['timed', 'all-day', 'undated']);
  });

  it('formats the local day as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('groups dated commitments by day in deadline order and leaves undated ones out', () => {
    const evening = commitment({ id: 'evening', due: new Date(2026, 10, 4, 18, 0).toISOString(), hasTime: true });
    const morning = commitment({ id: 'morning', due: new Date(2026, 10, 4, 9, 0).toISOString(), hasTime: true });
    const tomorrow = commitment({ id: 'tomorrow', due: new Date(2026, 10, 5).toISOString() });
    const byDay = groupByDay([evening, commitment({ id: 'undated' }), tomorrow, morning]);

    expect([...byDay.keys()]).toEqual(['2026-11-04', '2026-11-05']);
    expect(byDay.get('2026-11-04')?.map((c) => c.id)).toEqual(['morning', 'evening']);
  });
});
