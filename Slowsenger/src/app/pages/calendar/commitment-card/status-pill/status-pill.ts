import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommitmentStatus, STATUS_LABELS } from '../../../../core/commitments/commitment';

/** The status of a commitment as a coloured label. */
@Component({
  selector: 'app-status-pill',
  template: '{{ label() }}',
  styleUrl: './status-pill.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-status]': 'status()' },
})
export class StatusPill {
  readonly status = input.required<CommitmentStatus>();
  readonly label = computed(() => STATUS_LABELS[this.status()]);
}
