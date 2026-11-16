import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { dayKey, groupByDay } from '../../core/commitments/commitment';
import { CommitmentService } from '../../core/commitments/commitment.service';
import { ProgressiveBlur } from '../../shared/progressive-blur/progressive-blur';
import { TaskbarNav } from '../../shared/taskbar-nav/taskbar-nav';
import { Taskbar } from '../dashboard/taskbar/taskbar';
import { Aurora } from './aurora/aurora';
import { CommitmentStack, StackGroup } from './commitment-stack/commitment-stack';
import { DayHeader } from './day-header/day-header';
import { MonthGrid } from './month-grid/month-grid';
import { MonthHeader } from './month-header/month-header';
import { StatusSummary } from './status-summary/status-summary';

/** How long the load intro runs; everything in it, late-arriving titles included, ends before this. */
const INTRO_MS = 2600;

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Month view of the commitments, with the selected day's list next to it. */
@Component({
  selector: 'app-calendar',
  imports: [Taskbar, TaskbarNav, ProgressiveBlur, Aurora, MonthHeader, StatusSummary, MonthGrid, DayHeader, CommitmentStack],
  templateUrl: './calendar.html',
  styleUrl: './calendar.scss',
  host: { '[class.calendar-intro]': 'intro()' },
})
export class Calendar {
  private readonly commitmentService = inject(CommitmentService);

  private readonly today = new Date(new Date().setHours(0, 0, 0, 0));

  /** The load intro plays once, while this is on (see during-intro in _calendar-theme.scss). */
  readonly intro = signal(!prefersReducedMotion());

  readonly isLoading = signal(true);
  readonly commitments = this.commitmentService.commitments;

  readonly viewYear = signal(this.today.getFullYear());
  readonly viewMonth = signal(this.today.getMonth()); // 0-11
  readonly selected = signal(this.today);

  /** The selected day as a key: picking the day again is no change. */
  readonly selectedDay = computed(() => dayKey(this.selected()));
  readonly byDay = computed(() => groupByDay(this.commitments()));
  readonly selectedCommitments = computed(() => this.byDay().get(dayKey(this.selected())) ?? []);
  /** No deadline was agreed, so these cannot be placed on the calendar. */
  readonly undated = computed(() => this.commitments().filter((commitment) => !commitment.due));

  /** The day panel's list: what is due on the selected day, then what has no deadline. */
  readonly dayGroups = computed<StackGroup[]>(() => {
    const groups: StackGroup[] = [
      { heading: 'Due this day', commitments: this.selectedCommitments(), loading: this.isLoading(), emptyText: 'Nothing is due on this day.' },
    ];
    if (this.undated().length) {
      groups.push({ heading: 'No deadline', commitments: this.undated(), note: 'No date was agreed for these, so they are not on the calendar.' });
    }
    return groups;
  });

  constructor() {
    this.commitmentService.load().subscribe({
      next: () => this.isLoading.set(false),
      error: () => this.isLoading.set(false),
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const timer = setTimeout(() => this.intro.set(false), INTRO_MS);
      destroyRef.onDestroy(() => clearTimeout(timer));
    });
  }

  /** Also turns to that month, for the days shown from the months around it. */
  select(date: Date): void {
    this.selected.set(date);
    this.showMonth(date);
  }

  shiftMonth(delta: number): void {
    this.showMonth(new Date(this.viewYear(), this.viewMonth() + delta, 1));
  }

  goToToday(): void {
    this.select(this.today);
  }

  private showMonth(date: Date): void {
    // Turning the page ends the load intro, so the new days only slide and don't ripple too
    if (date.getFullYear() !== this.viewYear() || date.getMonth() !== this.viewMonth()) this.intro.set(false);
    this.viewYear.set(date.getFullYear());
    this.viewMonth.set(date.getMonth());
  }
}
