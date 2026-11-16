import { ComponentFixture, TestBed } from '@angular/core/testing';

import { makeCommitment } from '../../../../core/commitments/commitment.testing';
import { CalendarDay, DayCell } from './day-cell';

const date = new Date(2026, 10, 4);
const day = (count: number): CalendarDay => ({
  key: '2026-11-04',
  date,
  inMonth: true,
  isToday: false,
  commitments: Array.from({ length: count }, (_, i) => makeCommitment({ id: `c${i}`, title: `Task ${i}`, due: date.toISOString() })),
  wave: 0,
});

describe('DayCell', () => {
  let fixture: ComponentFixture<DayCell>;
  let element: HTMLElement;

  const render = async (calendarDay: CalendarDay) => {
    fixture.componentRef.setInput('day', calendarDay);
    await fixture.whenStable();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(DayCell);
    element = fixture.nativeElement;
  });

  it('shows the day number and nothing else on a free day', async () => {
    await render(day(0));
    expect(element.querySelector('.day-number')?.textContent).toBe('4');
    expect(element.querySelector('.chips')).toBeNull();
    expect(element.querySelector('.day')?.getAttribute('aria-label')).toBe('Wednesday 4 November');
  });

  it('shows three titles, then how many more there are', async () => {
    await render(day(5));
    expect(element.querySelectorAll('.chip').length).toBe(3);
    expect(element.querySelector('.more')?.textContent).toBe('+2 more');
    expect(element.querySelectorAll('app-status-dot').length).toBe(4);
    expect(element.querySelector('.day')?.getAttribute('aria-label')).toBe('Wednesday 4 November, 5 due');
  });

  it('reports its date when pressed', async () => {
    await render(day(0));
    const selected = vi.fn();
    fixture.componentInstance.daySelected.subscribe(selected);
    element.querySelector<HTMLButtonElement>('.day')?.click();
    expect(selected).toHaveBeenCalledWith(date);
  });
});
