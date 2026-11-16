import { ComponentFixture, TestBed } from '@angular/core/testing';

import { makeCommitment } from '../../../core/commitments/commitment.testing';
import { MonthGrid } from './month-grid';

describe('MonthGrid', () => {
  let fixture: ComponentFixture<MonthGrid>;
  let component: MonthGrid;

  beforeEach(async () => {
    fixture = TestBed.createComponent(MonthGrid);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('year', 2026);
    fixture.componentRef.setInput('month', 10); // November 2026 starts on a Sunday
    fixture.componentRef.setInput('selected', new Date(2026, 10, 4));
    await fixture.whenStable();
  });

  it('shows six full weeks starting on the Monday before the 1st', () => {
    const days = component.days();
    expect(days.length).toBe(42);
    expect(days[0].key).toBe('2026-10-26');
    expect(days[0].inMonth).toBe(false);
    expect(days[6].key).toBe('2026-11-01');
    expect(component.weekdays[0]).toBe('Mon');
  });

  it('puts each commitment on its day and marks the selected day', async () => {
    const commitment = makeCommitment({ due: new Date(2026, 10, 4).toISOString() });
    fixture.componentRef.setInput('commitmentsByDay', new Map([['2026-11-04', [commitment]]]));
    await fixture.whenStable();

    expect(component.days().find((day) => day.key === '2026-11-04')?.commitments).toEqual([commitment]);
    const selected = fixture.nativeElement.querySelector('.day.is-selected');
    expect(selected?.getAttribute('aria-label')).toBe('Wednesday 4 November, 1 due');
  });

  it('reports the day that was pressed', () => {
    const selected = vi.fn();
    component.daySelected.subscribe(selected);
    fixture.nativeElement.querySelectorAll('.day')[0].click();
    expect(selected).toHaveBeenCalledWith(new Date(2026, 9, 26));
  });

  it('turns the month on a sideways swipe, but not on a short, downward or mouse drag', () => {
    const swiped = vi.fn();
    component.swiped.subscribe(swiped);
    const viewport = fixture.nativeElement.querySelector('.grid-viewport') as HTMLElement;
    const drag = (pointerType: string, dx: number, dy: number) => {
      const at = (x: number, y: number) => ({ pointerType, isPrimary: true, clientX: x, clientY: y, bubbles: true });
      viewport.dispatchEvent(new PointerEvent('pointerdown', at(200, 200)));
      viewport.dispatchEvent(new PointerEvent('pointerup', at(200 + dx, 200 + dy)));
    };

    drag('touch', -80, 10);
    drag('touch', 80, 0);
    drag('touch', 30, 0);
    drag('touch', 60, 50);
    drag('mouse', -80, 0);
    expect(swiped.mock.calls).toEqual([[1], [-1]]);
  });

  const turnTo = async (year: number, month: number) => {
    fixture.componentRef.setInput('year', year);
    fixture.componentRef.setInput('month', month);
    await fixture.whenStable();
    return [...fixture.nativeElement.querySelectorAll('.day-grid')] as HTMLElement[];
  };

  it('slides an earlier month in from the left and pushes the current one out to the right', async () => {
    const [leaving, entering] = await turnTo(2026, 9);
    expect(leaving.classList.contains('leaving')).toBe(true);
    expect(leaving.getAttribute('data-slide')).toBe('-1');
    expect(leaving.hasAttribute('inert')).toBe(true);
    expect(leaving.querySelector('.day-number')?.textContent).toBe('26'); // still November's first cell
    expect(entering.getAttribute('data-slide')).toBe('-1');
    expect(entering.querySelector('.day-number')?.textContent).toBe('28'); // October starts with 28 September
  });

  it('slides a later month in from the right, across the turn of the year too', async () => {
    const [leaving, entering] = await turnTo(2027, 0);
    expect(leaving.getAttribute('data-slide')).toBe('1');
    expect(entering.getAttribute('data-slide')).toBe('1');
  });

  it('removes the outgoing month when its own slide ends, not when a cell animation does', async () => {
    const [leaving] = await turnTo(2026, 11);
    leaving.querySelector('.day')?.dispatchEvent(new Event('animationend', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.day-grid').length).toBe(2);

    leaving.dispatchEvent(new Event('animationend'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.day-grid').length).toBe(1);
    expect(component.pages()).toEqual([expect.objectContaining({ leaving: null, slide: 1 })]);
  });
});
