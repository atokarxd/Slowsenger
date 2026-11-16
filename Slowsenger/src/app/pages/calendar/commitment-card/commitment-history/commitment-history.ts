import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommitmentChange, CommitmentEvent, DATE_LOCALE } from '../../../../core/commitments/commitment';
import { CommitmentService } from '../../../../core/commitments/commitment.service';

const WHEN_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

const VERBS: Record<string, string> = {
  create: 'added it as a proposal',
  accept: 'accepted it',
  reject: 'rejected it',
  claim: 'took it on',
  complete: 'marked it done',
  withdraw: 'withdrew it',
  propose_change: 'asked for a change',
  accept_change: 'accepted the change',
  reject_change: 'declined the change',
};

function describe(change: CommitmentChange | undefined): string {
  if (!change) return '';
  const parts = [];
  if (change.due !== undefined) parts.push(`deadline ${change.due ? DATE_FORMAT.format(new Date(change.due)) : 'none'}`);
  if (change.title !== undefined) parts.push(`task "${change.title}"`);
  if (change.owner !== undefined) parts.push(`owner ${change.owner.name}`);
  return parts.join(', ');
}

/** Everything that happened to a commitment, oldest first. Nothing in it is ever removed. */
@Component({
  selector: 'app-commitment-history',
  templateUrl: './commitment-history.html',
  styleUrl: './commitment-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentHistory {
  private readonly service = inject(CommitmentService);

  readonly events = input.required<CommitmentEvent[]>();

  readonly lines = computed(() => this.events().map((event) => {
    const before = describe(event.before);
    const after = describe(event.after);
    // A change with "before" values was applied: show it as "from → to"
    const change = before ? `${before} → ${after}` : after;
    // The owner of a commitment taken on unasked changes it directly
    const verb = event.action === 'propose_change' && before ? 'changed it' : VERBS[event.action] ?? event.action;
    return {
      when: WHEN_FORMAT.format(new Date(event.at)),
      text: [`${this.service.nameOf(event.actorId)} ${verb}`, change, event.reason && `"${event.reason}"`]
        .filter(Boolean).join(': '),
    };
  }));
}
