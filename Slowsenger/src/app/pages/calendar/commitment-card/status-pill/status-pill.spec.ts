import { TestBed } from '@angular/core/testing';

import { StatusPill } from './status-pill';

describe('StatusPill', () => {
  it('says that a proposal still needs confirmation', async () => {
    const fixture = TestBed.createComponent(StatusPill);
    fixture.componentRef.setInput('status', 'proposed');
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toBe('Needs confirmation');
    expect(element.getAttribute('data-status')).toBe('proposed');
  });
});
