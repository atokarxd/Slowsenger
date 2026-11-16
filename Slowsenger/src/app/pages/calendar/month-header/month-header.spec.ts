import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthHeader } from './month-header';

describe('MonthHeader', () => {
  let fixture: ComponentFixture<MonthHeader>;
  let element: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(MonthHeader);
    fixture.componentRef.setInput('year', 2026);
    fixture.componentRef.setInput('month', 10);
    element = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('shows the month and the year', () => {
    expect(element.querySelector('h1')?.textContent).toBe('November');
    expect(element.querySelector('.year')?.textContent).toBe('2026');
  });

  it('reports which button was pressed', () => {
    const component = fixture.componentInstance;
    const pressed: string[] = [];
    component.previousClicked.subscribe(() => pressed.push('previous'));
    component.todayClicked.subscribe(() => pressed.push('today'));
    component.nextClicked.subscribe(() => pressed.push('next'));

    element.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((button) => button.click());
    expect(pressed).toEqual(['previous', 'today', 'next']);
  });

  it('slides the title in from the side the new month comes from', async () => {
    expect(element.querySelector('.title-text')?.hasAttribute('data-slide')).toBe(false); // first render
    fixture.componentRef.setInput('month', 9);
    await fixture.whenStable();
    expect(element.querySelector('.title-text')?.getAttribute('data-slide')).toBe('-1');
    expect(element.querySelector('h1')?.textContent).toBe('October');

    fixture.componentRef.setInput('year', 2027);
    fixture.componentRef.setInput('month', 0);
    await fixture.whenStable();
    expect(element.querySelector('.title-text')?.getAttribute('data-slide')).toBe('1');
  });
});
