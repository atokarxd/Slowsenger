import {
  Component,
  ElementRef,
  HostListener,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DATE_LOCALE, compareByDeadline, dayKey, effectiveStatus, groupByDay } from '../../../core/commitments/commitment';
import { CommitmentService } from '../../../core/commitments/commitment.service';
import { CommitmentCard } from '../commitment-card/commitment-card';
import { CommitmentSection } from '../commitment-section/commitment-section';
import { CommitmentTimeline } from './commitment-timeline/commitment-timeline';

const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

/** Today's commitments, sliding in from the right over the chat. */
@Component({
  selector: 'app-today-panel',
  imports: [RouterLink, CommitmentSection, CommitmentCard, CommitmentTimeline],
  templateUrl: './today-panel.html',
  styleUrl: './today-panel.scss',
  host: { '[class.is-open]': 'open()' },
})
export class TodayPanel {
  private readonly commitmentService = inject(CommitmentService);

  readonly open = input(false);
  readonly closed = output<void>();

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  readonly isLoading = signal(false);
  readonly commitments = this.commitmentService.commitments;
  private readonly now = signal(new Date());

  readonly dateLabel = computed(() => DATE_FORMAT.format(this.now()));

  /** Everything due today, including completed and rejected ones, in deadline order. */
  readonly dueToday = computed(() => groupByDay(this.commitments()).get(dayKey(this.now())) ?? []);

  /** Still open from earlier days. */
  readonly overdue = computed(() => {
    const todayKey = dayKey(this.now());
    return this.commitments()
      .filter((commitment) => effectiveStatus(commitment, this.now()) === 'overdue')
      .filter((commitment) => dayKey(new Date(commitment.due!)) < todayKey)
      .sort(compareByDeadline);
  });

  constructor() {
    // Reload on every opening, so the panel is up to date.
    effect(() => {
      if (this.open()) untracked(() => this.load());
    });

    afterRenderEffect(() => {
      if (this.open()) this.closeButton()?.nativeElement.focus();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.closed.emit();
  }

  private load(): void {
    this.now.set(new Date());
    this.isLoading.set(true);
    this.commitmentService.load().subscribe({
      next: () => this.isLoading.set(false),
      error: () => this.isLoading.set(false),
    });
  }
}
