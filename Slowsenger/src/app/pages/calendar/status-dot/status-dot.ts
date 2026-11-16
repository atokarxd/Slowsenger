import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommitmentStatus } from '../../../core/commitments/commitment';

/** A dot in the colour of a status. Size it from the parent with width and height. */
@Component({
  selector: 'app-status-dot',
  template: '',
  styleUrl: './status-dot.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-status]': 'status()', 'aria-hidden': 'true' },
})
export class StatusDot {
  readonly status = input.required<CommitmentStatus>();
}
