import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

// Month names, weekday names and the displayed date follow this locale (e.g. 'hu-HU').
const LOCALE = 'en-GB';
const PANEL_WIDTH = 296;
// Used to place the panel before it is visible (and measurable); corrected right after it opens.
const PANEL_HEIGHT_ESTIMATE = 372;
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 8;

type View = 'days' | 'months' | 'years';

interface CalendarDay {
  key: string;
  year: number;
  month: number; // 0-11
  day: number;
  label: string;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
}

interface DateParts {
  year: number;
  month: number; // 0-11
  day: number;
}

let nextId = 0;

/**
 * Date field with a custom calendar popup. Works with reactive forms (formControlName);
 * the value is a 'YYYY-MM-DD' string like a native <input type="date">, or '' when empty.
 */
@Component({
  selector: 'app-date-picker',
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DatePicker), multi: true }],
})
export class DatePicker implements ControlValueAccessor {
  private readonly injector = inject(Injector);

  readonly placeholder = input('Select a date');
  /** Days after today cannot be picked (e.g. for a birthday). */
  readonly disableFuture = input(false, { transform: booleanAttribute });

  readonly panelId = `date-picker-panel-${nextId++}`;
  readonly isOpen = signal(false);
  readonly disabled = signal(false);
  readonly view = signal<View>('days');
  readonly selected = signal<DateParts | null>(null);
  readonly viewYear = signal(new Date().getFullYear());
  readonly viewMonth = signal(new Date().getMonth());

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly yearList = viewChild<ElementRef<HTMLElement>>('yearList');

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  private readonly today = (() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  })();

  readonly weekdays = Array.from({ length: 7 }, (_, i) =>
    // 2024-01-01 was a Monday, so the week starts on Monday.
    new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(new Date(2024, 0, 1 + i))
  );

  readonly months = Array.from({ length: 12 }, (_, month) => ({
    month,
    label: new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(new Date(2024, month, 1)),
  }));

  readonly years = computed(() => {
    const max = this.disableFuture() ? this.today.year : this.today.year + 20;
    return Array.from({ length: max - (this.today.year - 120) + 1 }, (_, i) => this.today.year - 120 + i);
  });

  readonly displayValue = computed(() => {
    const value = this.selected();
    return value
      ? new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' })
          .format(new Date(value.year, value.month, value.day))
      : '';
  });

  readonly title = computed(() => {
    switch (this.view()) {
      case 'days':
        return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' })
          .format(new Date(this.viewYear(), this.viewMonth(), 1));
      case 'months':
        return String(this.viewYear());
      case 'years':
        return 'Select year';
    }
  });

  readonly days = computed<CalendarDay[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const selected = this.selected();
    const leading = (new Date(year, month, 1).getDay() + 6) % 7; // days shown from the previous month
    const formatter = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });

    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(year, month, 1 - leading + i);
      const parts = { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
      return {
        ...parts,
        key: `${parts.year}-${parts.month}-${parts.day}`,
        label: formatter.format(date),
        inMonth: parts.month === month,
        isToday: this.isSameDay(parts, this.today),
        isSelected: selected !== null && this.isSameDay(parts, selected),
        isDisabled: this.isAfterMax(parts),
      };
    });
  });

  readonly canGoNext = computed(() => {
    if (!this.disableFuture()) return true;
    return this.view() === 'months'
      ? this.viewYear() < this.today.year
      : this.viewYear() * 12 + this.viewMonth() < this.today.year * 12 + this.today.month;
  });

  // ─── ControlValueAccessor ────────────────────────────────────────────────────

  writeValue(value: string | null): void {
    const parsed = this.parse(value);
    this.selected.set(parsed);
    this.showMonthOf(parsed);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // ─── Popup ───────────────────────────────────────────────────────────────────

  onBeforeToggle(event: Event): void {
    if ((event as ToggleEvent).newState === 'open') {
      this.view.set('days');
      this.showMonthOf(this.selected());
      this.position(PANEL_HEIGHT_ESTIMATE);
    }
  }

  onToggle(event: Event): void {
    const open = (event as ToggleEvent).newState === 'open';
    this.isOpen.set(open);
    if (open) {
      this.position(this.panel().nativeElement.offsetHeight);
    } else {
      this.onTouched();
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.isOpen()) {
      this.position(this.panel().nativeElement.offsetHeight);
    }
  }

  // The panel sits inside the field's <label>; cancelling the click stops the label from
  // forwarding it to the trigger button, which would close the panel again.
  onPanelClick(event: MouseEvent): void {
    event.preventDefault();
  }

  close(): void {
    this.panel().nativeElement.hidePopover?.();
    this.trigger().nativeElement.focus();
  }

  // ─── Navigation and selection ────────────────────────────────────────────────

  step(direction: 1 | -1): void {
    if (direction === 1 && !this.canGoNext()) return;
    if (this.view() === 'months') {
      this.viewYear.update((year) => year + direction);
      return;
    }
    const target = new Date(this.viewYear(), this.viewMonth() + direction, 1);
    this.viewYear.set(target.getFullYear());
    this.viewMonth.set(target.getMonth());
  }

  onTitleClick(): void {
    if (this.view() === 'years') {
      this.view.set('days');
      return;
    }
    this.view.set('years');
    // Bring the current year into view in the scrollable list.
    afterNextRender(() => {
      this.yearList()?.nativeElement.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
    }, { injector: this.injector });
  }

  selectYear(year: number): void {
    this.viewYear.set(year);
    if (this.disableFuture() && year === this.today.year && this.viewMonth() > this.today.month) {
      this.viewMonth.set(this.today.month);
    }
    this.view.set('months');
  }

  selectMonth(month: number): void {
    this.viewMonth.set(month);
    this.view.set('days');
  }

  isMonthDisabled(month: number): boolean {
    return this.disableFuture() && (this.viewYear() > this.today.year || (this.viewYear() === this.today.year && month > this.today.month));
  }

  selectDay(day: CalendarDay): void {
    if (day.isDisabled) return;
    const value = { year: day.year, month: day.month, day: day.day };
    this.selected.set(value);
    this.showMonthOf(value);
    this.onChange(this.format(value));
    this.close();
  }

  clear(): void {
    this.selected.set(null);
    this.onChange('');
    this.close();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Places the panel under the trigger, or above it when there is not enough room below. */
  private position(panelHeight: number): void {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const style = this.panel().nativeElement.style;
    const spaceBelow = window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
    const top = spaceBelow >= panelHeight || rect.top < panelHeight + TRIGGER_GAP + VIEWPORT_MARGIN
      ? rect.bottom + TRIGGER_GAP
      : rect.top - TRIGGER_GAP - panelHeight;
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
    style.top = `${Math.max(top, VIEWPORT_MARGIN)}px`;
    style.left = `${Math.max(left, VIEWPORT_MARGIN)}px`;
  }

  private showMonthOf(value: DateParts | null): void {
    const target = value ?? this.today;
    this.viewYear.set(target.year);
    this.viewMonth.set(target.month);
  }

  private isAfterMax(parts: DateParts): boolean {
    if (!this.disableFuture()) return false;
    const toNumber = (p: DateParts) => p.year * 10000 + p.month * 100 + p.day;
    return toNumber(parts) > toNumber(this.today);
  }

  private isSameDay(a: DateParts, b: DateParts): boolean {
    return a.year === b.year && a.month === b.month && a.day === b.day;
  }

  private parse(value: string | null): DateParts | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
    const date = new Date(year, month, day);
    return date.getMonth() === month && date.getDate() === day ? { year, month, day } : null;
  }

  private format({ year, month, day }: DateParts): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
}
