import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, linkedSignal, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SlowsengerDataService } from '../../../../core/supabase/slowsenger-data.service';
import { hasOpenPopover } from '../../../../shared/popover';
import { TimePicker } from '../../../../shared/time-picker/time-picker';

/** How far ahead a message can be scheduled: today and the week after it. */
export const SCHEDULE_DAYS = 8;

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const TIME_12H = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const pad = (value: number) => String(value).padStart(2, '0');
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Where "Send later" starts: the next morning at 9:00. */
export function nextMorning(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
}

/** "Monday, 9:00 AM", or "Today, 5:30 PM": when the message goes. */
export function scheduleLabel(at: Date, now: Date = new Date()): string {
  return `${sameDay(at, now) ? 'Today' : WEEKDAY.format(at)}, ${TIME_12H.format(at)}`;
}

/** The days to pick from: today and the next seven. */
export function scheduleDays(now: Date = new Date()): Date[] {
  return Array.from({ length: SCHEDULE_DAYS }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
}

/** The same time of day on another day; for a time already gone today, the next full hour instead. */
export function moveToDay(at: Date, day: Date, now: Date = new Date()): Date {
  const moved = new Date(day.getFullYear(), day.getMonth(), day.getDate(), at.getHours(), at.getMinutes());
  return moved.getTime() > now.getTime()
    ? moved
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
}

/**
 * The small card for when a message goes: a day (today or within the week after it) and a time. It opens
 * from the "Monday, 9:00 AM ›" button above the message input (see the chat), and every change shows on that
 * button at once; "Done", Escape or a click elsewhere closes it.
 */
@Component({
  selector: 'app-send-later',
  imports: [ReactiveFormsModule, TimePicker],
  templateUrl: './send-later.html',
  styleUrl: './send-later.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class SendLater {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = input(false);
  /** When the message goes. */
  readonly at = input<Date | null>(null);
  /** The button that opens the card: a press on it is not "elsewhere" (it opens and closes the card itself). */
  readonly anchor = input<HTMLElement | null>(null);
  readonly atChange = output<Date>();
  readonly closed = output<void>();
  /**
   * The time as picked here, ahead of `at` coming back from the chat: a day picked and the time changed
   * right after it (before the next render) builds on the new day, not the old one.
   */
  private readonly current = linkedSignal(() => this.at());

  /** Offline there is no server: a scheduled message goes out only while the app is open. */
  readonly onlyWhileOpen = inject(SlowsengerDataService).sendsLaterOnlyWhileOpen;
  /** Counted from each opening, so a card left open past midnight starts from the new day next time. */
  readonly days = computed(() => {
    this.open();
    return scheduleDays();
  });
  readonly time = computed(() => {
    const at = this.current();
    return at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '09:00';
  });
  readonly label = computed(() => {
    const at = this.current();
    return at ? scheduleLabel(at) : '';
  });
  readonly isPast = computed(() => (this.current()?.getTime() ?? Infinity) <= Date.now());

  /** The time picker (the app's, not the browser's): shows the time set, and sets the one picked. */
  readonly timeField = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => this.timeField.setValue(this.time(), { emitEvent: false }));
    this.timeField.valueChanges.subscribe((value) => this.setTime(value));
  }

  dayName(day: Date, index: number): string {
    return index === 0 ? 'Today' : WEEKDAY_SHORT.format(day);
  }

  isPicked(day: Date): boolean {
    const at = this.current();
    return !!at && sameDay(at, day);
  }

  pickDay(day: Date): void {
    this.change(moveToDay(this.current() ?? nextMorning(), day));
  }

  setTime(value: string): void {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return;
    const base = this.current() ?? nextMorning();
    this.change(new Date(base.getFullYear(), base.getMonth(), base.getDate(), Number(match[1]), Number(match[2])));
  }

  private change(at: Date): void {
    this.current.set(at);
    this.atChange.emit(at);
  }

  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node;
    if (!this.open() || this.host.nativeElement.contains(target) || this.anchor()?.contains(target)) return;
    this.closed.emit();
  }

  onEscape(): void {
    // Escape in the time picker closes only the time picker
    if (this.open() && !hasOpenPopover(this.host.nativeElement)) this.closed.emit();
  }
}
