import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { DatePicker } from './date-picker';

@Component({
  imports: [ReactiveFormsModule, DatePicker],
  template: `<app-date-picker [formControl]="control" disableFuture />`,
})
class Host {
  readonly control = new FormControl('2001-05-14', { nonNullable: true });
}

describe('DatePicker', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let picker: DatePicker;
  let element: HTMLElement;

  const triggerText = () => element.querySelector('.trigger-text')?.textContent?.trim();
  const title = () => element.querySelector('.title-btn')?.textContent?.trim();
  const dayButton = (label: string) => element.querySelector<HTMLButtonElement>(`.day[aria-label="${label}"]`)!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
    await fixture.whenStable();
    picker = fixture.debugElement.children[0].componentInstance;
  });

  it('shows the form value and opens on its month', () => {
    expect(triggerText()).toBe('14 May 2001');
    expect(title()).toBe('May 2001');
    expect(dayButton('14 May 2001').classList).toContain('is-selected');
  });

  it('starts the week on Monday and shows 6 full weeks', () => {
    expect(element.querySelectorAll('.weekdays span')[0].textContent).toBe('Mon');
    expect(element.querySelectorAll('.day').length).toBe(42);
  });

  it('writes the picked day back to the form as YYYY-MM-DD', async () => {
    dayButton('3 May 2001').click();
    await fixture.whenStable();
    expect(host.control.value).toBe('2001-05-03');
    expect(triggerText()).toBe('3 May 2001');
  });

  it('updates when the form value changes', async () => {
    host.control.setValue('1999-12-31');
    await fixture.whenStable();
    expect(triggerText()).toBe('31 December 1999');
    expect(title()).toBe('December 1999');
  });

  it('navigates between months', async () => {
    (element.querySelector('.nav-btn[aria-label="Next"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(title()).toBe('June 2001');
    (element.querySelector('.nav-btn[aria-label="Previous"]') as HTMLButtonElement).click();
    (element.querySelector('.nav-btn[aria-label="Previous"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(title()).toBe('April 2001');
  });

  it('picks a year, then a month, then shows that month', async () => {
    picker.onTitleClick();
    await fixture.whenStable();
    expect(title()).toBe('Select year');

    const year1985 = Array.from(element.querySelectorAll<HTMLButtonElement>('.year-grid .cell')).find((b) => b.textContent?.trim() === '1985')!;
    year1985.click();
    await fixture.whenStable();
    expect(title()).toBe('1985');

    element.querySelectorAll<HTMLButtonElement>('.month-grid .cell')[2].click(); // March
    await fixture.whenStable();
    expect(title()).toBe('March 1985');
  });

  it('does not allow future days with disableFuture', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    host.control.setValue(iso);
    await fixture.whenStable();

    const label = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }).format(tomorrow);
    expect(dayButton(label).disabled).toBe(true);
    expect((element.querySelector('.nav-btn[aria-label="Next"]') as HTMLButtonElement).disabled).toBe(true);

    picker.onTitleClick();
    await fixture.whenStable();
    const years = Array.from(element.querySelectorAll('.year-grid .cell'), (b) => Number(b.textContent));
    expect(Math.max(...years)).toBe(new Date().getFullYear());
  });

  it('clears the value', async () => {
    (element.querySelector('.text-btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.control.value).toBe('');
    expect(triggerText()).toBe('Select a date');
  });

  it('ignores invalid values', async () => {
    host.control.setValue('2001-02-30');
    await fixture.whenStable();
    expect(triggerText()).toBe('Select a date');
  });

  it('follows the disabled state of the form control', async () => {
    host.control.disable();
    await fixture.whenStable();
    expect((element.querySelector('.trigger') as HTMLButtonElement).disabled).toBe(true);
  });
});
