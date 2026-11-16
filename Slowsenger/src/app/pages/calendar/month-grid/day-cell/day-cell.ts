import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Commitment, DATE_LOCALE, effectiveStatus } from '../../../../core/commitments/commitment';
import { StatusDot } from '../../status-dot/status-dot';

// Titles shown before "+N more" (wide screens), and dots (narrow screens).
const MAX_CHIPS = 3;
const MAX_DOTS = 4;

const LABEL_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export interface CalendarDay {
  key: string;
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  /** Due this day, earliest deadline first. */
  commitments: Commitment[];
  /** Distance from today's cell in cells; the load intro ripples out from today with it. */
  wave: number;
}

/** One day of the month grid: its number and what is due. */
@Component({
  selector: 'app-day-cell',
  imports: [StatusDot],
  templateUrl: './day-cell.html',
  styleUrl: './day-cell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--wave]': 'day().wave' },
})
export class DayCell {
  readonly day = input.required<CalendarDay>();
  readonly selected = input(false);
  readonly daySelected = output<Date>();

  readonly entries = computed(() =>
    this.day().commitments.map((commitment) => ({ commitment, status: effectiveStatus(commitment) }))
  );
  readonly chips = computed(() => this.entries().slice(0, MAX_CHIPS));
  readonly hiddenCount = computed(() => Math.max(0, this.entries().length - MAX_CHIPS));
  readonly dots = computed(() => this.entries().slice(0, MAX_DOTS));

  readonly label = computed(() => {
    const date = LABEL_FORMAT.format(this.day().date);
    const count = this.entries().length;
    return count ? `${date}, ${count} due` : date;
  });
}
