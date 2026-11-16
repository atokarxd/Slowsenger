import { TestBed } from '@angular/core/testing';

import { makeCommitment } from '../../../core/commitments/commitment.testing';
import { StatusSummary } from './status-summary';

describe('StatusSummary', () => {
  it('counts each status, an accepted one past its deadline as overdue', async () => {
    const fixture = TestBed.createComponent(StatusSummary);
    fixture.componentRef.setInput('commitments', [
      makeCommitment({ id: 'a' }),
      makeCommitment({ id: 'b', due: new Date(2020, 0, 1).toISOString() }),
      makeCommitment({ id: 'c', status: 'proposed' }),
    ]);
    await fixture.whenStable();

    const stats = [...fixture.nativeElement.querySelectorAll('.stat')].map((stat: Element) => stat.textContent?.replace(/\s+/g, ' ').trim());
    expect(stats).toEqual(['Open 1', 'To confirm 1', 'Overdue 1', 'Done 0', 'Rejected 0', 'Withdrawn 0']);
  });
});
