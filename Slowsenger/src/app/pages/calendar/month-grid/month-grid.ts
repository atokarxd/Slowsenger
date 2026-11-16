import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, untracked } from '@angular/core';
import { Commitment, DATE_LOCALE, dayKey } from '../../../core/commitments/commitment';
import { CalendarDay, DayCell } from './day-cell/day-cell';

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short' });

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How far (px) a finger has to move sideways for a swipe to turn the month. */
const SWIPE_DISTANCE = 50;

/** -1: the new month is earlier and comes in from the left; 1: later, from the right; 0: no slide. */
export type Slide = -1 | 0 | 1;

/** A month on show: the current one, or the one sliding out while the months change. */
export interface GridPage {
  id: number;
  slide: Slide;
  /** The outgoing month's cells, kept as they were; null for the current page. */
  leaving: CalendarDay[] | null;
}

/** Six full weeks around the month, Monday first, under a row of weekday names. */
@Component({
  selector: 'app-month-grid',
  imports: [DayCell],
  templateUrl: './month-grid.html',
  styleUrl: './month-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonthGrid {
  readonly year = input.required<number>();
  readonly month = input.required<number>(); // 0-11
  readonly selected = input.required<Date>();
  /** Commitments by dayKey, as groupByDay returns them. */
  readonly commitmentsByDay = input<ReadonlyMap<string, Commitment[]>>(new Map());
  readonly daySelected = output<Date>();
  /** A sideways swipe on a touch screen: 1 to turn to the next month, -1 to the previous one. */
  readonly swiped = output<1 | -1>();

  /** Where the finger went down, while it is on the grid. */
  private swipeStart: { pointerId: number; x: number; y: number } | null = null;

  private readonly todayKey = dayKey(new Date());
  readonly selectedKey = computed(() => dayKey(this.selected()));

  // 1 January 2024 was a Monday.
  readonly weekdays = Array.from({ length: 7 }, (_, i) => WEEKDAY_FORMAT.format(new Date(2024, 0, 1 + i)));

  /** Months counted from year 0, so two months compare by a single number. */
  private readonly monthIndex = computed(() => this.year() * 12 + this.month());

  readonly days = computed(() => this.daysOf(this.monthIndex()));

  /**
   * The page on show, plus the previous one while it slides out. Like a strip being dragged:
   * an earlier month pushes the current one out to the right, a later one to the left.
   */
  readonly pages = linkedSignal<number, GridPage[]>({
    source: this.monthIndex,
    computation: (index, previous) => {
      if (!previous) return [{ id: 0, slide: 0, leaving: null }];
      const current = previous.value.find((page) => !page.leaving) ?? { id: 0, slide: 0, leaving: null };
      if (prefersReducedMotion()) return [{ id: current.id + 1, slide: 0, leaving: null }];
      const slide = Math.sign(index - previous.source) as Slide;
      return [
        { id: current.id, slide, leaving: untracked(() => this.daysOf(previous.source)) },
        { id: current.id + 1, slide, leaving: null },
      ];
    },
  });

  /** The outgoing page is removed once its own slide (not a cell's animation) has ended. */
  slideEnded(page: GridPage, event: AnimationEvent): void {
    if (event.target !== event.currentTarget || !page.leaving) return;
    this.pages.update((pages) => pages.filter((p) => p.id !== page.id));
  }

  /** Touch and pen only: a mouse clicks the days, it doesn't drag them. */
  swipeStarted(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    this.swipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  /** Far enough and mostly sideways; swiping left brings the next month in from the right. */
  swipeEnded(event: PointerEvent): void {
    const start = this.swipeStart;
    this.swipeStart = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy)) this.swiped.emit(dx < 0 ? 1 : -1);
  }

  /** The browser took the touch over to scroll the page. */
  swipeCancelled(): void {
    this.swipeStart = null;
  }

  private daysOf(monthIndex: number): CalendarDay[] {
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const leading = (new Date(year, month, 1).getDay() + 6) % 7; // days shown from the previous month

    const cells = Array.from({ length: 42 }, (_, i) => {
      const date = new Date(year, month, 1 - leading + i);
      const key = dayKey(date);
      return {
        key,
        date,
        inMonth: date.getMonth() === month,
        isToday: key === this.todayKey,
        commitments: this.commitmentsByDay().get(key) ?? [],
      };
    });

    // Distance from today's cell (or the first one), for the load intro's ripple
    const origin = Math.max(0, cells.findIndex((cell) => cell.isToday));
    return cells.map((cell, i) => ({
      ...cell,
      wave: Math.round(Math.hypot(Math.floor(i / 7) - Math.floor(origin / 7), (i % 7) - (origin % 7)) * 100) / 100,
    }));
  }
}
