import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ProgressiveBlur } from '../progressive-blur/progressive-blur';

const PANEL_WIDTH = 216;
// Used to place the panel before it is visible (and measurable); corrected right after it opens.
const PANEL_HEIGHT_ESTIMATE = 330;
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 8;

type Column = 'hour' | 'minute';

const pad = (value: number) => String(value).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, hour) => pad(hour));

let nextId = 0;

/**
 * Time field with the app's own popup instead of the browser's: the time in large digits over two
 * columns to pick from, the hours and the minutes (in steps). Works with reactive forms; the value is
 * an 'HH:MM' string like a native <input type="time">, or '' when empty. Every pick shows at once; Done,
 * Enter, Escape or a click outside closes it.
 */
@Component({
  selector: 'app-time-picker',
  imports: [ProgressiveBlur],
  templateUrl: './time-picker.html',
  styleUrl: './time-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TimePicker), multi: true }],
  host: { '[class.is-chip]': "look() === 'chip'" },
})
export class TimePicker implements ControlValueAccessor {
  private readonly injector = inject(Injector);

  readonly placeholder = input('--:--');
  /** field: a full-width input box; chip: a pill among other pills. */
  readonly look = input<'field' | 'chip'>('field');
  /** What the time is for, for screen readers ("Time", "Another time"). */
  readonly label = input('Time');
  readonly minuteStep = input(5);
  /** false: a time is required (no Clear). */
  readonly clearable = input(true);

  readonly panelId = `time-picker-panel-${nextId++}`;
  readonly isOpen = signal(false);
  readonly disabled = signal(false);
  /** 'HH:MM', or '' when no time is set. */
  readonly value = signal('');

  readonly hours = HOURS;
  readonly minutes = computed(() => {
    const step = Math.max(1, Math.min(30, this.minuteStep()));
    return Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step));
  });
  readonly hour = computed(() => this.value().slice(0, 2) || null);
  readonly minute = computed(() => this.value().slice(3, 5) || null);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  // ─── ControlValueAccessor ────────────────────────────────────────────────────

  writeValue(value: string | null): void {
    this.value.set(/^\d{2}:\d{2}$/.test(value ?? '') ? value! : '');
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

  // ─── Picking ─────────────────────────────────────────────────────────────────

  /** An hour keeps the minutes picked (on the hour if none yet). */
  pickHour(hour: string): void {
    this.set(`${hour}:${this.minute() ?? '00'}`);
  }

  /** Minutes before any hour go with the hour it is now. */
  pickMinute(minute: string): void {
    this.set(`${this.hour() ?? pad(new Date().getHours())}:${minute}`);
  }

  clear(): void {
    this.set('');
    this.close();
  }

  close(): void {
    this.panel().nativeElement.hidePopover?.();
    this.trigger().nativeElement.focus();
  }

  /** In a column: up and down pick, left and right go to the other column, Enter is done. */
  onKeydown(event: KeyboardEvent, column: Column): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.focusCell(column === 'hour' ? 'minute' : 'hour');
      return;
    }
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -4, PageDown: 4 };
    const list = column === 'hour' ? this.hours : this.minutes();
    const current = column === 'hour' ? this.hour() : this.minute();
    let index: number;
    if (event.key in moves) {
      const from = current ? list.indexOf(current) : this.startIndex(column);
      index = Math.min(list.length - 1, Math.max(0, (from < 0 ? 0 : from) + (current ? moves[event.key] : 0)));
    } else if (event.key === 'Home' || event.key === 'End') {
      index = event.key === 'Home' ? 0 : list.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    if (column === 'hour') this.pickHour(list[index]);
    else this.pickMinute(list[index]);
    this.focusCell(column, 'nearest');
  }

  /** The cell a column can be tabbed into: the one picked, or where it opens (the hour it is now). */
  isTabStop(column: Column, cell: string): boolean {
    const list = column === 'hour' ? this.hours : this.minutes();
    const current = column === 'hour' ? this.hour() : this.minute();
    return current && list.includes(current) ? cell === current : cell === list[this.startIndex(column)];
  }

  // ─── Popup ───────────────────────────────────────────────────────────────────

  onBeforeToggle(event: Event): void {
    if ((event as ToggleEvent).newState === 'open') this.position(PANEL_HEIGHT_ESTIMATE);
  }

  onToggle(event: Event): void {
    const open = (event as ToggleEvent).newState === 'open';
    this.isOpen.set(open);
    if (open) {
      this.position(this.panel().nativeElement.offsetHeight);
      // Bring what is picked (or the hour it is now) to the middle of each column, and focus the hours
      afterNextRender(() => {
        this.scrollToTabStop('minute', 'center');
        this.focusCell('hour', 'center');
      }, { injector: this.injector });
    } else {
      this.onTouched();
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.isOpen()) this.position(this.panel().nativeElement.offsetHeight);
  }

  // The panel may sit inside a <label>: cancelling the click keeps the label from forwarding it to the
  // trigger button, which would close the panel again
  onPanelClick(event: MouseEvent): void {
    event.preventDefault();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private set(value: string): void {
    this.value.set(value);
    this.onChange(value);
  }

  private startIndex(column: Column): number {
    if (column === 'hour') return new Date().getHours();
    return 0;
  }

  private cellOf(column: Column): HTMLElement | null {
    return this.panel().nativeElement.querySelector<HTMLElement>(`[data-column="${column}"] [tabindex="0"]`);
  }

  private scrollToTabStop(column: Column, block: ScrollLogicalPosition): void {
    this.cellOf(column)?.scrollIntoView?.({ block });
  }

  private focusCell(column: Column, block: ScrollLogicalPosition = 'nearest'): void {
    afterNextRender(() => {
      const cell = this.cellOf(column);
      cell?.scrollIntoView?.({ block });
      cell?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

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
}
