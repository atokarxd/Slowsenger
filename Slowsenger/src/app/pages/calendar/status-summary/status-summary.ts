import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Commitment, CommitmentStatus, effectiveStatus } from '../../../core/commitments/commitment';
import { StatusDot } from '../status-dot/status-dot';

const STATS: Array<{ status: CommitmentStatus; label: string }> = [
  { status: 'accepted', label: 'Open' },
  { status: 'proposed', label: 'To confirm' },
  { status: 'overdue', label: 'Overdue' },
  { status: 'completed', label: 'Done' },
  { status: 'rejected', label: 'Rejected' },
  { status: 'withdrawn', label: 'Withdrawn' },
];

/** How many commitments there are in each status. */
@Component({
  selector: 'app-status-summary',
  imports: [StatusDot],
  templateUrl: './status-summary.html',
  styleUrl: './status-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusSummary {
  readonly commitments = input.required<Commitment[]>();

  readonly stats = computed(() => {
    const statuses = this.commitments().map((commitment) => effectiveStatus(commitment));
    return STATS.map(({ status, label }) => ({ status, label, count: statuses.filter((s) => s === status).length }));
  });
}
