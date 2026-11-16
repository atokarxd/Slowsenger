import { TestBed } from '@angular/core/testing';

import { StatusDot } from './status-dot';

describe('StatusDot', () => {
  it('carries its status for the colour and is hidden from screen readers', async () => {
    const fixture = TestBed.createComponent(StatusDot);
    fixture.componentRef.setInput('status', 'overdue');
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.getAttribute('data-status')).toBe('overdue');
    expect(element.getAttribute('aria-hidden')).toBe('true');
  });
});
