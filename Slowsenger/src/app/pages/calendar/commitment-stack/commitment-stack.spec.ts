import { ComponentFixture, TestBed } from '@angular/core/testing';

import { makeCommitment } from '../../../core/commitments/commitment.testing';
import { CommitmentStack, StackGroup } from './commitment-stack';

describe('CommitmentStack', () => {
  let fixture: ComponentFixture<CommitmentStack>;
  let element: HTMLElement;

  const render = async (groups: StackGroup[]) => {
    fixture.componentRef.setInput('groups', groups);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommitmentStack] }).compileComponents();
    fixture = TestBed.createComponent(CommitmentStack);
    element = fixture.nativeElement;
  });

  it('puts every heading and card side by side, each card marked with its group', async () => {
    await render([
      { heading: 'Due this day', commitments: [makeCommitment({ id: 'a' }), makeCommitment({ id: 'b' })] },
      { heading: 'No deadline', note: 'No date was agreed.', commitments: [makeCommitment({ id: 'c' })] },
    ]);

    // Each heading and card in a slot of its own, all side by side
    const slots = [...element.children].map((child) => child.firstElementChild?.className.split(' ')[0] ?? child.className);
    expect(slots).toEqual(['heading', 'item', 'item', 'heading', 'item', 'spacer']);

    const headings = element.querySelectorAll('.heading');
    expect(headings[0].querySelector('h3')?.textContent).toContain('Due this day');
    expect(headings[0].querySelector('.count')?.textContent).toBe('2');
    expect(headings[1].querySelector('.note')?.textContent).toBe('No date was agreed.');

    const cards = [...element.querySelectorAll<HTMLElement>('.card-item')];
    expect(cards.map((card) => card.dataset['group'])).toEqual(['0', '0', '1']);
    expect(cards.map((card) => card.classList.contains('first'))).toEqual([true, false, true]);
  });

  it('shows placeholders while loading and the empty text when there is nothing', async () => {
    await render([{ heading: 'Due this day', commitments: [], loading: true, emptyText: 'Nothing is due.' }]);
    expect(element.querySelectorAll('.skeleton-card').length).toBe(2);
    expect(element.querySelector('.count')).toBeNull();
    expect(element.querySelector('.empty')).toBeNull();

    await render([{ heading: 'Due this day', commitments: [], emptyText: 'Nothing is due.' }]);
    expect(element.querySelector('.empty')?.textContent).toBe('Nothing is due.');
    expect(element.querySelector('.empty')?.getAttribute('data-group')).toBe('0');
  });
});
