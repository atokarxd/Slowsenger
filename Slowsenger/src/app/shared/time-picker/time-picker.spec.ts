import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TimePicker } from './time-picker';

@Component({
  imports: [ReactiveFormsModule, TimePicker],
  template: `<app-time-picker [formControl]="time" [clearable]="clearable" />`,
})
class Host {
  readonly time = new FormControl('', { nonNullable: true });
  clearable = true;
}

describe('TimePicker', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let element: HTMLElement;
  const trigger = () => element.querySelector<HTMLButtonElement>('.trigger')!;
  const column = (name: 'hour' | 'minute') => element.querySelector<HTMLElement>(`[data-column="${name}"]`)!;
  const cell = (name: 'hour' | 'minute', text: string) =>
    [...column(name).querySelectorAll<HTMLButtonElement>('.cell')].find((c) => c.textContent!.trim() === text)!;
  const picked = (name: 'hour' | 'minute') => column(name).querySelector('.is-picked')?.textContent?.trim();
  const stable = () => fixture.whenStable();

  // It is 14:20 (minutes picked before any hour go with 14)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 14, 20));
  });
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
    await stable();
  });

  it('is the app\'s own field, not the browser\'s, and shows --:-- until a time is set', async () => {
    expect(element.querySelector('input[type="time"]')).toBeNull();
    expect(trigger().textContent).toContain('--:--');
    expect(trigger().classList).toContain('is-empty');

    host.time.setValue('07:45');
    await stable();
    expect(trigger().textContent).toContain('07:45');
    expect(picked('hour')).toBe('07');
    expect(picked('minute')).toBe('45');
    expect(element.querySelector('.readout')?.textContent?.replace(/\s/g, '')).toBe('07:45');
  });

  it('offers every hour and the minutes in steps of five', () => {
    expect(column('hour').querySelectorAll('.cell')).toHaveLength(24);
    expect([...column('minute').querySelectorAll('.cell')].map((c) => c.textContent!.trim()).slice(0, 4))
      .toEqual(['00', '05', '10', '15']);
    expect(column('minute').querySelectorAll('.cell')).toHaveLength(12);
  });

  it('sets the hour on the hour, keeps the minutes when the hour changes, and the hour when the minutes do', async () => {
    cell('hour', '18').click();
    expect(host.time.value).toBe('18:00');
    cell('minute', '45').click();
    expect(host.time.value).toBe('18:45');
    cell('hour', '07').click();
    expect(host.time.value).toBe('07:45');
  });

  it('takes the hour it is now for minutes picked first', () => {
    cell('minute', '30').click();
    expect(host.time.value).toBe('14:30');
  });

  it('opens at the hour it is now, and moves along a column with the arrows', async () => {
    expect(column('hour').querySelector('[tabindex="0"]')?.textContent?.trim()).toBe('14');
    column('hour').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await stable();
    expect(host.time.value).toBe('14:00'); // the first arrow picks where it stands
    column('hour').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    column('minute').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await stable();
    expect(host.time.value).toBe('15:55');
  });

  it('clears the time, unless one is required', async () => {
    host.time.setValue('07:45');
    await stable();
    [...element.querySelectorAll<HTMLButtonElement>('.text-btn')].find((b) => b.textContent!.includes('Clear'))!.click();
    expect(host.time.value).toBe('');

    host.clearable = false;
    fixture.changeDetectorRef.markForCheck();
    await stable();
    expect(element.querySelector('.panel-footer')?.textContent).not.toContain('Clear');
  });

  it('cannot be opened while the form has it disabled', async () => {
    host.time.disable();
    await stable();
    expect(trigger().disabled).toBe(true);
  });
});
