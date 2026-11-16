import { ComponentFixture, TestBed } from '@angular/core/testing';

import { makeCommitment } from '../../../../core/commitments/commitment.testing';
import { CommitmentTimeline } from './commitment-timeline';

describe('CommitmentTimeline', () => {
  let fixture: ComponentFixture<CommitmentTimeline>;
  let element: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(CommitmentTimeline);
    element = fixture.nativeElement;
  });

  it('marks each commitment with its status, in the given order', async () => {
    fixture.componentRef.setInput('commitments', [
      makeCommitment({ id: 'a', status: 'completed' }),
      makeCommitment({ id: 'b', status: 'proposed' }),
    ]);
    await fixture.whenStable();

    const markers = [...element.querySelectorAll('.marker')].map((marker) => marker.getAttribute('data-status'));
    expect(markers).toEqual(['completed', 'proposed']);
    expect(element.querySelectorAll('app-commitment-card').length).toBe(2);
  });

  it('draws nothing, not even the line, without commitments', async () => {
    fixture.componentRef.setInput('commitments', []);
    await fixture.whenStable();
    expect(element.querySelector('.timeline')).toBeNull();
  });
});
