import { TestBed } from '@angular/core/testing';

import { TodayButton } from './today-button';

describe('TodayButton', () => {
  it('asks to open the panel and tells whether it is open', async () => {
    const fixture = TestBed.createComponent(TodayButton);
    const requested = vi.fn();
    fixture.componentInstance.openRequested.subscribe(requested);
    await fixture.whenStable();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(requested).toHaveBeenCalled();

    fixture.componentRef.setInput('expanded', true);
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
