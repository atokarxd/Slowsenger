import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { Commitment, DATE_LOCALE, effectiveStatus } from '../../../core/commitments/commitment';
import { CommitmentActions } from './commitment-actions/commitment-actions';
import { CommitmentHistory } from './commitment-history/commitment-history';
import { CommitmentOwner } from './commitment-owner/commitment-owner';
import { SourceMessage } from './source-message/source-message';
import { StatusPill } from './status-pill/status-pill';

const TIME_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' });
const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

/** One commitment: status, deadline, owner and the message it comes from. */
@Component({
  selector: 'app-commitment-card',
  imports: [StatusPill, CommitmentOwner, SourceMessage, CommitmentActions, CommitmentHistory],
  templateUrl: './commitment-card.html',
  styleUrl: './commitment-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentCard {
  readonly commitment = input.required<Commitment>();
  /** Show the date next to the time, for lists that span several days. */
  readonly showDate = input(false, { transform: booleanAttribute });

  readonly status = computed(() => effectiveStatus(this.commitment()));

  readonly when = computed(() => {
    const { due, hasTime } = this.commitment();
    if (!due) return 'No deadline';
    const date = new Date(due);
    if (this.showDate()) return hasTime ? `${DATE_FORMAT.format(date)}, ${TIME_FORMAT.format(date)}` : DATE_FORMAT.format(date);
    return hasTime ? TIME_FORMAT.format(date) : 'By end of day';
  });

  readonly hint = computed(() => {
    const { owner, ownedByMe } = this.commitment();
    switch (this.status()) {
      case 'proposed':
        if (!owner) return 'Suggested from the chat. Clarify who takes it on before it can be accepted.';
        return ownedByMe ? 'Suggested from the chat. Only you can accept or reject it.' : `Waiting for ${owner.name} to accept it.`;
      case 'overdue':
        return 'Past the deadline. It can still be completed.';
      case 'rejected':
        return 'Rejected, kept for the record.';
      case 'withdrawn':
        return 'Withdrawn by its owner, kept for the record.';
      default:
        return null;
    }
  });
}
