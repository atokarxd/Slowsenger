import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { DATE_LOCALE } from '../../../core/commitments/commitment';

const MONTH_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'long' });

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The month shown, with the buttons that move between months. */
@Component({
  selector: 'app-month-header',
  templateUrl: './month-header.html',
  styleUrl: './month-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonthHeader {
  readonly year = input.required<number>();
  readonly month = input.required<number>(); // 0-11

  readonly previousClicked = output<void>();
  readonly todayClicked = output<void>();
  readonly nextClicked = output<void>();

  /** Months counted from year 0; a new value re-creates the title, so it slides in. */
  private readonly monthIndex = computed(() => this.year() * 12 + this.month());

  readonly monthName = computed(() => MONTH_FORMAT.format(new Date(this.year(), this.month(), 1)));
  readonly title = computed(() => ({ key: this.monthIndex(), name: this.monthName(), year: this.year() }));

  /** Which side the title comes from, the same way as the month grid: -1 left, 1 right, 0 none. */
  readonly slide = linkedSignal<number, number>({
    source: this.monthIndex,
    computation: (index, previous) => (previous && !prefersReducedMotion() ? Math.sign(index - previous.source) : 0),
  });
}
