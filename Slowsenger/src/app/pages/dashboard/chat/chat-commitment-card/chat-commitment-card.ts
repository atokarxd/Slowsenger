import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DATE_LOCALE, effectiveStatus } from '../../../../core/commitments/commitment';
import { CommitmentService } from '../../../../core/commitments/commitment.service';
import { ActionType, CommitmentAction, allowedActions } from '../../../../core/commitments/lifecycle';
import { StatusPill } from '../../../calendar/commitment-card/status-pill/status-pill';

const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const TIME_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' });
const MONTH = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short' });
const DAY_MS = 24 * 60 * 60 * 1000;

/** A card only decides on the proposal; whatever comes after is done in the calendar. The main action goes last. */
const CARD_ACTIONS: ActionType[] = ['reject', 'claim', 'accept'];
const LABELS: Partial<Record<ActionType, string>> = { claim: 'Take it on', reject: 'Reject', accept: 'Accept' };

/** "Today", "Tomorrow", "In 3 days", "2 days ago"…: how far the day is; '' beyond a week (the date says it). */
export function relativeDay(date: Date, now: Date = new Date()): string {
  const days = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY_MS,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return '';
}

/**
 * A commitment shown in the chat as a ticket (an invite now; the recogniser's suggestions later), for
 * both people of the conversation: the calendar leaf of its day on the left, what and who on the right,
 * and under the tear line the decision. The person who is to do it accepts or rejects it right here; the
 * rules decide who sees which button, the others see who it is waiting for. Once decided, the ticket
 * folds into a small row with its outcome, which opens again on a click.
 */
@Component({
  selector: 'app-chat-commitment-card',
  imports: [StatusPill],
  templateUrl: './chat-commitment-card.html',
  styleUrl: './chat-commitment-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-status]': 'status()',
    '[class.is-outgoing]': 'outgoing()',
    '[class.is-compact]': 'decided() && !expanded()',
    '[class.is-live]': 'seenOpen()',
    // The tear line's notches: only while there is a decision bar under it
    '[class.has-bar]': 'actions().length > 0 || !!waiting()',
  },
})
export class ChatCommitmentCard {
  private readonly service = inject(CommitmentService);

  readonly commitmentId = input.required<string>();
  /** Sent by the signed-in user: the card sits on their side of the chat. */
  readonly outgoing = input(false);

  /** null until the commitments are loaded (the chat loads them when a card arrives). */
  readonly commitment = computed(() => this.service.commitments().find((c) => c.id === this.commitmentId()) ?? null);
  readonly status = computed(() => {
    const commitment = this.commitment();
    return commitment ? effectiveStatus(commitment) : null;
  });
  /** Out of the proposal: the outcome is all that is left to show. */
  readonly decided = computed(() => {
    const status = this.status();
    return !!status && status !== 'proposed';
  });

  /** A decided ticket opened again from its small row. */
  readonly expanded = signal(false);
  /**
   * The ticket was seen still open: a decision made now folds it with its stamp animated. A ticket
   * already decided when the chat opens simply shows folded.
   */
  readonly seenOpen = signal(false);

  /** Where it comes from: the full name for screen readers, a short label for the ticket. */
  readonly kind = computed(() => (this.commitment()?.origin === 'detected' ? 'Suggested from the chat' : 'Commitment invite'));
  readonly kindLabel = computed(() => (this.commitment()?.origin === 'detected' ? 'Suggested' : 'Invite'));

  readonly due = computed(() => {
    const due = this.commitment()?.due;
    return due ? new Date(due) : null;
  });

  /** The calendar leaf: month, day, weekday and (if one was agreed) the time. */
  readonly leaf = computed(() => {
    const due = this.due();
    if (!due) return null;
    return {
      month: MONTH.format(due),
      day: due.getDate(),
      weekday: WEEKDAY.format(due),
      time: this.commitment()?.hasTime ? TIME_FORMAT.format(due) : null,
    };
  });

  /** The whole date in words, for screen readers (the leaf is drawn for the eye). */
  readonly when = computed(() => {
    const due = this.due();
    if (!due) return 'No date set';
    return this.commitment()?.hasTime ? `${DATE_FORMAT.format(due)}, ${TIME_FORMAT.format(due)}` : DATE_FORMAT.format(due);
  });

  readonly relative = computed(() => {
    const due = this.due();
    return due ? relativeDay(due) : '';
  });

  readonly ownerLine = computed(() => {
    const commitment = this.commitment();
    if (!commitment?.owner) return 'Nobody named yet';
    return commitment.ownedByMe ? 'You do it' : `${commitment.owner.name} does it`;
  });

  readonly initials = computed(() =>
    (this.commitment()?.owner?.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  );

  readonly actions = computed(() => {
    const commitment = this.commitment();
    const actorId = this.service.myId();
    if (!commitment || !actorId) return [];
    const allowed = allowedActions(commitment, { actorId, now: new Date() });
    return CARD_ACTIONS.filter((action) => allowed.includes(action));
  });

  /** For whoever cannot decide on it: who it is waiting for. */
  readonly waiting = computed(() => {
    const commitment = this.commitment();
    if (this.status() !== 'proposed' || !commitment || this.actions().length) return null;
    return commitment.owner ? `Waiting for ${commitment.owner.name} to accept it.` : 'Waiting for someone to take it on.';
  });

  readonly labels = LABELS;
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.status() === 'proposed') this.seenOpen.set(true);
    });
  }

  press(action: ActionType): void {
    const me = this.service.me();
    const commitment = this.commitment();
    if (!commitment) return;
    const run: CommitmentAction | null = action === 'claim' ? (me ? { type: 'claim', owner: me } : null) : ({ type: action } as CommitmentAction);
    if (!run) return;
    this.error.set(this.service.apply(commitment.id, run));
  }

  /** The small row of a decided ticket opens it, and closes it again. */
  toggle(event?: Event): void {
    if (!this.decided()) return;
    event?.preventDefault();
    this.expanded.update((open) => !open);
  }
}
