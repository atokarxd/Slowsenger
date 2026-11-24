import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { CommitmentService } from '../../../core/commitments/commitment.service';
import { makeCommitment, makeUser } from '../../../core/commitments/commitment.testing';
import { CommitmentComposer, quickDays } from './commitment-composer';

describe('CommitmentComposer', () => {
  const demo = makeUser('demo', 'Demo');
  const anna = { ...makeUser('anna', 'Anna Kovács'), avatarUrl: 'data:image/svg+xml,anna' };
  const invite = vi.fn(() => of(makeCommitment()));
  let fixture: ComponentFixture<CommitmentComposer>;
  let host: HTMLElement;
  const dialog = () => host.querySelector('.dialog') as HTMLFormElement | null;
  const question = () => host.querySelector('.step:not(.is-leaving) .question')?.textContent?.trim();
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text)!;
  const stable = () => fixture.whenStable();

  // A fixed today (Wednesday 18 November): the quick days are Today, Tomorrow, Fri 20, Sat 21
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    invite.mockClear();
    await TestBed.configureTestingModule({
      imports: [CommitmentComposer],
      providers: [{ provide: CommitmentService, useValue: { me: signal(demo), load: () => of([]), invite } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CommitmentComposer);
    fixture.componentRef.setInput('partner', anna);
    host = fixture.nativeElement;
    await stable();
  });

  const open = async () => {
    fixture.componentRef.setInput('open', true);
    await stable();
  };
  const write = async (text: string) => {
    const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
    field.value = text;
    field.dispatchEvent(new Event('input'));
    await stable();
  };
  const press = async (key: string, init: KeyboardEventInit = {}) => {
    (document.activeElement ?? host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await stable();
  };
  /** Through the first two questions to "By when?", with the partner doing it. */
  const toWhen = async (title = 'Meeting about the draft') => {
    await open();
    await write(title);
    dialog()!.requestSubmit();
    await stable();
    dialog()!.requestSubmit();
    await stable();
  };

  it('stays closed until it is asked for', () => {
    expect(dialog()).toBeNull();
    expect(host.classList.contains('is-open')).toBe(false);
  });

  it('opens on the first question, empty, and focused on it', async () => {
    await open();
    expect(host.querySelector('h2')?.textContent).toBe('Commitment invite');
    expect(question()).toBe('What should happen?');
    expect(host.querySelector('.lead')?.textContent).toContain('Sent to Anna Kovács');
    expect(host.querySelector('.count')?.textContent).toContain('1');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    expect(document.activeElement).toBe(host.querySelector('textarea'));
    expect(button('Cancel')).toBeTruthy();
  });

  it('asks for a title before going on', async () => {
    await open();
    await press('Enter');
    expect(question()).toBe('What should happen?');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Write down what it is about.');
  });

  it('goes on with Enter, but Shift+Enter is a new line', async () => {
    await open();
    await write('Slides');
    await press('Enter', { shiftKey: true });
    expect(question()).toBe('What should happen?');
    await press('Enter');
    expect(question()).toBe('Who does it?');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('asks who does it, the partner picked, and moves on by itself after a tap', async () => {
    await open();
    await write('Slides');
    await press('Enter');
    const picked = () => host.querySelector('.owner[aria-checked="true"]')?.getAttribute('data-owner');
    expect(picked()).toBe('partner');
    expect(document.activeElement).toBe(host.querySelector('.owner[data-owner="partner"]'));

    await press('ArrowDown');
    expect(picked()).toBe('me');
    expect(question()).toBe('Who does it?'); // the arrows only move

    (host.querySelector('.owner[data-owner="none"]') as HTMLButtonElement).click();
    await stable();
    expect(picked()).toBe('none');
    await new Promise((resolve) => setTimeout(resolve, 320));
    await stable();
    expect(question()).toBe('By when?');
    expect(host.textContent).toContain('Nobody is named yet');
  });

  it('shows the ticket as it will arrive, and sends the invite with what was set', async () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    await toWhen();
    const leaf = () => [...host.querySelectorAll('.ticket .band, .ticket .day, .ticket .weekday, .ticket .time')]
      .map((e) => e.textContent!.trim());
    expect(host.querySelector('.ticket-title')?.textContent).toBe('Meeting about the draft');
    expect(host.querySelector('.ticket-owner')?.textContent).toContain('Anna Kovács does it');
    expect(leaf()).toEqual(['Any', '–', 'No date']);
    expect(button('12:00').disabled).toBe(true); // no time without a day
    expect(host.querySelector<HTMLButtonElement>('app-time-picker .trigger')!.disabled).toBe(true);

    expect([...host.querySelectorAll('.pick .chip')].slice(0, 5).map((c) => c.textContent!.trim()))
      .toEqual(['No date', 'Today', 'Tomorrow', 'Fri 20', 'Sat 21']);
    button('Fri 20').click();
    await stable();
    button('12:00').click();
    await stable();
    expect(leaf()).toEqual(['Nov', '20', 'Fri', '12:00']);
    expect(host.textContent).toContain('It becomes a commitment only when Anna Kovács accepts it.');

    button('Send invite').click();
    await stable();
    expect(invite).toHaveBeenCalledWith({
      title: 'Meeting about the draft', owner: anna, due: new Date(2026, 10, 20, 12, 0).toISOString(), hasTime: true, partner: anna,
    });
    expect(closed).toHaveBeenCalled();
  });

  it('takes any other day from the calendar, and any other time from the time field', async () => {
    await toWhen();
    fixture.componentInstance.otherDay.setValue('2026-12-03');
    await stable();
    expect(host.querySelectorAll('.pick .chip.is-on').length).toBe(1); // only "Any time"
    expect(host.querySelector('app-date-picker')?.classList).toContain('is-on');

    // The app's time picker, not the browser's
    expect(host.querySelector('input[type="time"]')).toBeNull();
    const cell = (column: string, text: string) => [...host.querySelectorAll<HTMLButtonElement>(`app-time-picker [data-column="${column}"] .cell`)]
      .find((c) => c.textContent!.trim() === text)!;
    cell('hour', '07').click();
    cell('minute', '45').click();
    await stable();
    expect(host.querySelector('app-time-picker .trigger')?.textContent).toContain('07:45');
    expect(button('Any time').classList).not.toContain('is-on');

    // A quick time after it empties the picker again
    button('12:00').click();
    await stable();
    expect(host.querySelector('app-time-picker .trigger')?.textContent).toContain('--:--');
    cell('hour', '07').click();
    cell('minute', '45').click();
    await stable();

    button('Send invite').click();
    expect(invite).toHaveBeenCalledWith(expect.objectContaining({ due: new Date(2026, 11, 3, 7, 45).toISOString(), hasTime: true }));
  });

  it('sends without a date when none is picked, and forgets the time when the day goes', async () => {
    await toWhen();
    button('Tomorrow').click();
    await stable();
    button('17:00').click();
    await stable();
    button('No date').click();
    await stable();
    expect(button('17:00').classList).not.toContain('is-on');
    expect(button('Any time').classList).toContain('is-on');
    button('Send invite').click();
    expect(invite).toHaveBeenCalledWith(expect.objectContaining({ due: null, hasTime: false }));
  });

  it('goes back without losing the answers', async () => {
    await toWhen('Book the room');
    button('Tomorrow').click();
    await stable();
    button('Back').click();
    await stable();
    expect(question()).toBe('Who does it?');
    button('Back').click();
    await stable();
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Book the room');
    dialog()!.requestSubmit();
    await stable();
    dialog()!.requestSubmit();
    await stable();
    expect(host.querySelector('.chip.is-on')?.textContent?.trim()).toBe('Tomorrow');
  });

  it('keeps the answers on screen while closing, and starts afresh when opened again', async () => {
    fixture.componentInstance.closed.subscribe(() => fixture.componentRef.setInput('open', false));
    await toWhen('Book the room');
    button('Tomorrow').click();
    (host.querySelector('.close') as HTMLButtonElement).click();
    await stable();
    expect(fixture.componentInstance.title()).toBe('Book the room'); // not cleared under the closing dialog

    await open();
    expect(question()).toBe('What should happen?');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    expect(fixture.componentInstance.date()).toBe('');
    expect(fixture.componentInstance.ownerChoice()).toBe('partner');
  });

  it('closes with Escape', async () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('says so when the invite could not be sent, and stays open', async () => {
    invite.mockReturnValueOnce(throwError(() => new Error('offline')));
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    await toWhen();
    button('Send invite').click();
    await stable();
    expect(closed).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not send it');
    expect(button('Send invite').disabled).toBe(false);
  });
});

describe('quickDays', () => {
  it('offers today, tomorrow and the two days after, across a month end', () => {
    expect(quickDays(new Date(2026, 10, 29, 22, 0))).toEqual([
      { key: '2026-11-29', label: 'Today' },
      { key: '2026-11-30', label: 'Tomorrow' },
      { key: '2026-12-01', label: 'Tue 1' },
      { key: '2026-12-02', label: 'Wed 2' },
    ]);
  });
});
