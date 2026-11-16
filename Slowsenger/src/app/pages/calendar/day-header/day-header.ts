import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DATE_LOCALE, dayKey } from '../../../core/commitments/commitment';

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'long' });
const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });

/** The selected day's weekday and date, with a badge when it is today. */
@Component({
  selector: 'app-day-header',
  templateUrl: './day-header.html',
  styleUrl: './day-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayHeader {
  readonly date = input.required<Date>();

  readonly weekday = computed(() => WEEKDAY_FORMAT.format(this.date()));
  readonly dateLabel = computed(() => DATE_FORMAT.format(this.date()));
  readonly isToday = computed(() => dayKey(this.date()) === dayKey(new Date()));
}
