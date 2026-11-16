import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Commitment, DATE_LOCALE } from '../../../../core/commitments/commitment';
import { CommitmentService } from '../../../../core/commitments/commitment.service';
import { ActionType, CommitmentAction, allowedActions, changeApprover } from '../../../../core/commitments/lifecycle';

const LABELS: Record<ActionType, string> = {
  accept: 'Accept',
  reject: 'Reject',
  claim: 'Take it on',
  complete: 'Mark done',
  withdraw: 'Withdraw',
  propose_change: 'Change deadline',
  accept_change: 'Accept change',
  reject_change: 'Decline change',
};

/** The main action of each state is shown as the primary button. */
const PRIMARY: ActionType[] = ['accept', 'claim', 'complete', 'accept_change'];

const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

/** What the signed-in user may do with a commitment now, as buttons; the rules decide which. */
@Component({
  selector: 'app-commitment-actions',
  templateUrl: './commitment-actions.html',
  styleUrl: './commitment-actions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentActions {
  private readonly service = inject(CommitmentService);

  readonly commitment = input.required<Commitment>();

  readonly labels = LABELS;
  readonly form = signal<'withdraw' | 'change' | null>(null);
  readonly error = signal<string | null>(null);

  readonly actions = computed(() => {
    const actorId = this.service.myId();
    return actorId ? allowedActions(this.commitment(), { actorId, now: new Date() }) : [];
  });

  /** "deadline: Mon 9 Nov · waiting for Anna" for a change that is not accepted yet. */
  readonly pending = computed(() => {
    const commitment = this.commitment();
    const pending = commitment.pendingChange;
    if (!pending) return null;
    const { due, title, owner } = pending.change;
    const what = [
      due !== undefined && `deadline ${due ? DATE_FORMAT.format(new Date(due)) : 'removed'}`,
      title !== undefined && `task "${title}"`,
      owner !== undefined && `owner ${owner.name}`,
    ].filter(Boolean).join(', ');
    return { what, by: this.service.nameOf(pending.proposedBy), waitingFor: this.service.nameOf(changeApprover(commitment)) };
  });

  /** Current deadline as YYYY-MM-DD, for the date field. */
  readonly currentDate = computed(() => {
    const due = this.commitment().due;
    if (!due) return '';
    const date = new Date(due);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });

  isPrimary(action: ActionType): boolean {
    return PRIMARY.includes(action);
  }

  press(action: ActionType): void {
    if (action === 'withdraw' || action === 'propose_change') {
      this.error.set(null);
      this.form.set(action === 'withdraw' ? 'withdraw' : 'change');
      return;
    }
    const me = this.service.me();
    if (action === 'claim') {
      if (me) this.run({ type: 'claim', owner: me });
      return;
    }
    this.run({ type: action } as CommitmentAction);
  }

  withdraw(reason: string): void {
    this.run({ type: 'withdraw', reason });
  }

  changeDeadline(value: string): void {
    const [year, month, day] = value.split('-').map(Number);
    const due = value ? new Date(year, month - 1, day).toISOString() : null;
    this.run({ type: 'propose_change', change: { due, hasTime: false } });
  }

  private run(action: CommitmentAction): void {
    const error = this.service.apply(this.commitment().id, action);
    this.error.set(error);
    if (!error) this.form.set(null);
  }
}
