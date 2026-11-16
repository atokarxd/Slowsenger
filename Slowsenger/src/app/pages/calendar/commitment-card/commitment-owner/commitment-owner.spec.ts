import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommitmentOwner } from './commitment-owner';

describe('CommitmentOwner', () => {
  let fixture: ComponentFixture<CommitmentOwner>;
  let element: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(CommitmentOwner);
    element = fixture.nativeElement;
  });

  it('says so when no owner was stated, instead of guessing one', async () => {
    fixture.componentRef.setInput('owner', null);
    await fixture.whenStable();
    expect(element.querySelector('.missing')?.textContent).toBe('No owner stated');
  });

  it('shows the signed-in user as "You"', async () => {
    fixture.componentRef.setInput('owner', { id: 'u1', name: 'Anna Kovács', username: 'anna', avatarUrl: 'anna.jpg' });
    fixture.componentRef.setInput('isMe', true);
    await fixture.whenStable();
    expect(element.textContent).toContain('You');
    expect(element.querySelector('.missing')).toBeNull();
  });
});
