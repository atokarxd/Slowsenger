import { TestBed } from '@angular/core/testing';

import { Aurora } from './aurora';

describe('Aurora', () => {
  it('is decoration only', async () => {
    const fixture = TestBed.createComponent(Aurora);
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelectorAll('.orb').length).toBeGreaterThan(0);
  });
});
