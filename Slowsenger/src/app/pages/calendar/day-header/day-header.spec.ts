import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DayHeader } from './day-header';

describe('DayHeader', () => {
  let fixture: ComponentFixture<DayHeader>;
  let element: HTMLElement;

  const render = async (date: Date) => {
    fixture.componentRef.setInput('date', date);
    await fixture.whenStable();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(DayHeader);
    element = fixture.nativeElement;
  });

  it('shows the weekday and the date', async () => {
    await render(new Date(2026, 0, 5));
    expect(element.querySelector('.weekday')?.textContent?.trim()).toBe('Monday');
    expect(element.querySelector('h2')?.textContent).toBe('5 January 2026');
  });

  it('marks today', async () => {
    await render(new Date());
    expect(element.querySelector('.today-badge')).not.toBeNull();
    await render(new Date(2000, 0, 1));
    expect(element.querySelector('.today-badge')).toBeNull();
  });
});
