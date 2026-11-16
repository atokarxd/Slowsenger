import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Commitment } from '../../../core/commitments/commitment';
import { makeCommitment } from '../../../core/commitments/commitment.testing';
import { CommitmentCard } from './commitment-card';

const base = makeCommitment({
  title: 'Unit tesztek bővítése',
  status: 'proposed',
  origin: 'detected',
  source: { threadTitle: 'Péter Nagy', authorName: 'Demo Felhasználó', sentByMe: true, text: 'A unit teszteket még bővíteni kell.',
    messageId: 'm1', threadId: 't1' },
});

describe('CommitmentCard', () => {
  let fixture: ComponentFixture<CommitmentCard>;
  let element: HTMLElement;

  const render = async (commitment: Commitment) => {
    fixture.componentRef.setInput('commitment', commitment);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommitmentCard] }).compileComponents();
    fixture = TestBed.createComponent(CommitmentCard);
    element = fixture.nativeElement;
  });

  it('marks a missing owner and deadline instead of guessing them', async () => {
    await render(base);
    expect(element.querySelector('.missing')?.textContent).toContain('No owner stated');
    expect(element.querySelector('.when')?.textContent).toContain('No deadline');
    expect(element.querySelector('.card')?.getAttribute('data-status')).toBe('proposed');
  });

  it('shows the source message', async () => {
    await render(base);
    expect(element.querySelector('.quote p')?.textContent).toContain('A unit teszteket még bővíteni kell.');
    expect(element.querySelector('.quote footer')?.textContent).toContain('You · chat with Péter Nagy');
  });

  it('shows an accepted commitment past its deadline as overdue', async () => {
    await render({ ...base, status: 'accepted', due: new Date(2020, 0, 1).toISOString() });
    expect(element.querySelector('.card')?.getAttribute('data-status')).toBe('overdue');
    expect(element.querySelector('app-status-pill')?.textContent).toBe('Overdue');
    expect(element.querySelector('.hint')?.textContent).toContain('can still be completed');
  });
});
