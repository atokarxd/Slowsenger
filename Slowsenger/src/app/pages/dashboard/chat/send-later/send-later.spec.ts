import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SendLater, moveToDay, nextMorning, scheduleDays, scheduleLabel } from './send-later';

describe('send later times', () => {
  const now = new Date(2026, 10, 18, 14, 20); // Wednesday afternoon

  it('starts from the next morning at 9:00', () => {
    expect(nextMorning(now)).toEqual(new Date(2026, 10, 19, 9, 0));
  });

  it('names the day and the time as "Thursday, 9:00 AM", and today as today', () => {
    expect(scheduleLabel(new Date(2026, 10, 19, 9, 0), now)).toBe('Thursday, 9:00 AM');
    expect(scheduleLabel(new Date(2026, 10, 18, 17, 30), now)).toBe('Today, 5:30 PM');
    expect(scheduleLabel(new Date(2026, 10, 25, 21, 5), now)).toBe('Wednesday, 9:05 PM'); // a week on: today's weekday
  });

  it('offers today and the seven days after it', () => {
    const days = scheduleDays(now);
    expect(days).toHaveLength(8);
    expect(days[0]).toEqual(new Date(2026, 10, 18));
    expect(days[7]).toEqual(new Date(2026, 10, 25));
  });

  it('keeps the time when the day changes, but not a time already gone today', () => {
    expect(moveToDay(new Date(2026, 10, 19, 9, 0), new Date(2026, 10, 22), now)).toEqual(new Date(2026, 10, 22, 9, 0));
    expect(moveToDay(new Date(2026, 10, 19, 20, 0), new Date(2026, 10, 18), now)).toEqual(new Date(2026, 10, 18, 20, 0));
    expect(moveToDay(new Date(2026, 10, 19, 9, 0), new Date(2026, 10, 18), now)).toEqual(new Date(2026, 10, 18, 15, 0));
  });
});

describe('SendLater', () => {
  let fixture: ComponentFixture<SendLater>;
  let host: HTMLElement;
  let picked: Date[];
  const closed = vi.fn();
  const at = nextMorning();

  beforeEach(async () => {
    picked = [];
    closed.mockClear();
    await TestBed.configureTestingModule({ imports: [SendLater] }).compileComponents();
    fixture = TestBed.createComponent(SendLater);
    host = fixture.nativeElement;
    fixture.componentInstance.atChange.subscribe((value) => picked.push(value));
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentRef.setInput('at', at);
    fixture.componentRef.setInput('open', true);
    await fixture.whenStable();
  });

  const days = () => [...host.querySelectorAll<HTMLButtonElement>('.day')];

  it('shows the eight days, today first, with the one it is set to picked', () => {
    expect(days()).toHaveLength(8);
    expect(days()[0].textContent).toContain('Today');
    expect(days().map((d) => d.getAttribute('aria-checked'))).toEqual(['false', 'true', ...Array(6).fill('false')]);
    expect(host.querySelector('input[type="time"]')).toBeNull(); // the app's time picker, not the browser's
    expect(host.querySelector('app-time-picker .trigger')?.textContent).toContain('09:00');
    expect(host.querySelector('.when')?.textContent).toContain('9:00 AM');
  });

  it('moves it to another day at the same time, and to another time on that day', () => {
    days()[3].click();
    const day = scheduleDays()[3];
    expect(picked.at(-1)).toEqual(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0));

    // At once, before the chat has handed the new day back: still on the day just picked
    const cell = (column: string, text: string) => [...host.querySelectorAll<HTMLButtonElement>(`app-time-picker [data-column="${column}"] .cell`)]
      .find((c) => c.textContent!.trim() === text)!;
    cell('hour', '18').click();
    cell('minute', '45').click();
    expect(picked.at(-1)).toEqual(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 45));
  });

  it('warns about a time already gone', async () => {
    fixture.componentRef.setInput('at', new Date(Date.now() - 60_000));
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('passed');
  });

  it('closes with Done, Escape or a press elsewhere, but not on its own button', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    fixture.componentRef.setInput('anchor', anchor);
    fixture.detectChanges();

    anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    host.querySelector('.day')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(closed).not.toHaveBeenCalled();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    host.querySelector<HTMLButtonElement>('.done')!.click();
    expect(closed).toHaveBeenCalledTimes(3);
    anchor.remove();
  });
});
