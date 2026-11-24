import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterRenderEffect, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DATE_LOCALE, dayKey } from '../../../core/commitments/commitment';
import { CommitmentService } from '../../../core/commitments/commitment.service';
import { AppUserSummary } from '../../../core/supabase/supabase.types';
import { DatePicker } from '../../../shared/date-picker/date-picker';
import { hasOpenPopover } from '../../../shared/popover';
import { TimePicker } from '../../../shared/time-picker/time-picker';

export type OwnerChoice = 'me' | 'partner' | 'none';
type Step = 1 | 2 | 3;

const MONTH = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short' });
/** Times offered with one tap (morning, noon, end of the working day); any other through the time field. */
export const QUICK_TIMES = ['09:00', '12:00', '17:00'];
/** How long a picked person shows as picked before the next question comes. */
const ADVANCE_DELAY_MS = 260;

/** The days offered with one tap: today, tomorrow and the two after, as 'YYYY-MM-DD' with a label. */
export function quickDays(now: Date = new Date()): { key: string; label: string }[] {
  return [0, 1, 2, 3].map((offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `${WEEKDAY.format(day)} ${day.getDate()}`;
    return { key: dayKey(day), label };
  });
}

/**
 * Sets up a commitment invite from scratch and sends it into the chat as a card, one question at a
 * time: what should happen, who does it, by when. The last step shows the ticket as the partner will
 * get it. It stays a proposal until the person named accepts it.
 */
@Component({
  selector: 'app-commitment-composer',
  imports: [ReactiveFormsModule, DatePicker, TimePicker],
  templateUrl: './commitment-composer.html',
  styleUrl: './commitment-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-open]': 'open()' },
})
export class CommitmentComposer {
  private readonly service = inject(CommitmentService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = input(false);
  /** Who the invite goes to. */
  readonly partner = input<AppUserSummary | null>(null);
  readonly closed = output<void>();

  readonly steps: Step[] = [1, 2, 3];
  readonly step = signal<Step>(1);
  /** 1: on to the next question, -1: back to the one before (the questions slide that way). */
  readonly direction = signal<1 | -1>(1);

  readonly title = signal('');
  /** An invite asks the partner, unless chosen otherwise. */
  readonly ownerChoice = signal<OwnerChoice>('partner');
  /** 'YYYY-MM-DD', or '' for no date. */
  readonly date = signal('');
  /** 'HH:MM', or '' for any time that day. */
  readonly time = signal('');
  /** The calendar field for a day not among the quick ones; kept in step with date. */
  readonly otherDay = new FormControl('', { nonNullable: true });
  /** The time field for a time not among the quick ones; empty while a quick one (or none) is picked. */
  readonly otherTime = new FormControl('', { nonNullable: true });

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly me = this.service.me;
  readonly quickTimes = QUICK_TIMES;
  /** Counted from each opening, so a dialog opened after midnight offers the new day. */
  readonly days = computed(() => {
    this.open();
    return quickDays();
  });
  readonly otherDayPicked = computed(() => !!this.date() && !this.days().some((day) => day.key === this.date()));

  readonly ownerName = computed(() => {
    switch (this.ownerChoice()) {
      case 'me': return 'you';
      case 'partner': return this.partner()?.name ?? 'they';
      default: return null;
    }
  });

  /** The three people to choose from, as the second question shows them. */
  readonly owners = computed(() => {
    const partner = this.partner();
    const me = this.me();
    return [
      { choice: 'partner' as const, person: partner, name: partner?.name ?? 'Them', line: `${partner?.name.split(' ')[0] ?? 'They'} has to accept it` },
      { choice: 'me' as const, person: me, name: 'Me', line: 'You take it on yourself' },
      { choice: 'none' as const, person: null, name: 'Not said yet', line: 'Someone takes it on later' },
    ];
  });

  /** The ticket as the partner will get it (last step). */
  readonly preview = computed(() => {
    const date = this.date();
    const owner = { me: this.me(), partner: this.partner(), none: null }[this.ownerChoice()];
    const ownerLine = !owner ? 'Nobody named yet' : this.ownerChoice() === 'me' ? 'You do it' : `${owner.name} does it`;
    if (!date) return { month: 'Any', day: '–', weekday: 'No date', time: null, owner, ownerLine };
    const [year, month, day] = date.split('-').map(Number);
    const at = new Date(year, month - 1, day);
    return { month: MONTH.format(at), day: String(day), weekday: WEEKDAY.format(at), time: this.time() || null, owner, ownerLine };
  });

  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Load the signed-in user (and the store) once, so "Me" can be offered; signed out, it stays empty
    this.service.load().subscribe({ error: () => undefined });

    // Every opening starts afresh (not on closing: the dialog keeps its content while it leaves)
    effect(() => {
      if (this.open()) untracked(() => this.reset());
    });

    this.otherDay.valueChanges.subscribe((value) => this.date.set(value));
    this.otherTime.valueChanges.subscribe((value) => this.time.set(value));
    // A time only goes with a day
    effect(() => {
      if (this.date()) this.otherTime.enable({ emitEvent: false });
      else this.otherTime.disable({ emitEvent: false });
    });

    // Each question takes the focus where it is answered (not the one sliding away, which is still there)
    afterRenderEffect(() => {
      if (!this.open()) return;
      this.host.nativeElement.querySelector<HTMLElement>(`.step[data-step="${this.step()}"] [data-autofocus]`)?.focus();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // Escape in the calendar or the time picker closes only that
    if (this.open() && !hasOpenPopover(this.host.nativeElement)) this.close();
  }

  /** The form's submit (Enter, or the main button): on to the next question, or send on the last. */
  submit(): void {
    if (this.step() === 3) this.save();
    else this.next();
  }

  next(): void {
    this.cancelAdvance();
    if (this.step() === 1 && !this.title().trim()) {
      this.error.set('Write down what it is about.');
      return;
    }
    this.error.set(null);
    this.direction.set(1);
    this.step.update((step) => Math.min(3, step + 1) as Step);
  }

  back(): void {
    this.cancelAdvance();
    this.error.set(null);
    this.direction.set(-1);
    this.step.update((step) => Math.max(1, step - 1) as Step);
  }

  /** Enter goes on; Shift+Enter is a new line in the text. */
  onTitleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.next();
  }

  onTitleInput(value: string): void {
    this.title.set(value);
    if (value.trim()) this.error.set(null);
  }

  /** A person picked with a tap: shown as picked for a moment, then the next question. */
  pickOwner(choice: OwnerChoice): void {
    this.ownerChoice.set(choice);
    this.cancelAdvance();
    this.advanceTimer = setTimeout(() => this.next(), ADVANCE_DELAY_MS);
  }

  /** Arrow keys move along the people (a radio group); Enter goes on with the one picked. */
  onOwnerKeydown(event: KeyboardEvent): void {
    const order: OwnerChoice[] = this.owners().map((owner) => owner.choice);
    const index = order.indexOf(this.ownerChoice());
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!move) return;
    event.preventDefault();
    const choice = order[(index + move + order.length) % order.length];
    this.ownerChoice.set(choice);
    this.host.nativeElement.querySelector<HTMLElement>(`[data-owner="${choice}"]`)?.focus();
  }

  /** A quick day (or none): the calendar field goes back to offering another day. */
  pickDay(key: string): void {
    this.date.set(key);
    this.otherDay.setValue('', { emitEvent: false });
    if (!key) this.pickTime('');
  }

  /** A quick time (or any time): the time field goes back to offering another time. */
  pickTime(value: string): void {
    this.time.set(value);
    this.otherTime.setValue('', { emitEvent: false });
  }

  save(): void {
    const partner = this.partner();
    if (!this.open() || !partner || this.saving()) return;
    const title = this.title().trim();
    if (!title) {
      this.direction.set(-1);
      this.step.set(1);
      this.error.set('Write down what it is about.');
      return;
    }
    const owner = { me: this.me(), partner, none: null }[this.ownerChoice()];
    const date = this.date();
    const time = date ? this.time() : '';
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time ? time.split(':').map(Number) : [0, 0];
    const due = date ? new Date(year, month - 1, day, hours, minutes).toISOString() : null;

    this.saving.set(true);
    this.service.invite({ title, owner, due, hasTime: !!date && !!time, partner }).subscribe({
      next: () => this.close(),
      error: () => {
        this.saving.set(false);
        this.error.set('Could not send it, please try again.');
      },
    });
  }

  close(): void {
    this.cancelAdvance();
    this.closed.emit();
  }

  private reset(): void {
    this.cancelAdvance();
    this.step.set(1);
    this.direction.set(1);
    this.title.set('');
    this.ownerChoice.set('partner');
    this.date.set('');
    this.time.set('');
    this.otherDay.setValue('', { emitEvent: false });
    this.otherTime.setValue('', { emitEvent: false });
    this.saving.set(false);
    this.error.set(null);
  }

  private cancelAdvance(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
  }
}
