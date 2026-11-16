import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Commitment, effectiveStatus } from '../../../../core/commitments/commitment';
import { CommitmentCard } from '../../commitment-card/commitment-card';
import { StatusDot } from '../../status-dot/status-dot';

/** Commitments on a vertical line through the day, each marked with a dot in its status colour. */
@Component({
  selector: 'app-commitment-timeline',
  imports: [CommitmentCard, StatusDot],
  templateUrl: './commitment-timeline.html',
  styleUrl: './commitment-timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentTimeline {
  /** In deadline order. */
  readonly commitments = input.required<Commitment[]>();

  readonly entries = computed(() =>
    this.commitments().map((commitment) => ({ commitment, status: effectiveStatus(commitment) }))
  );
}
