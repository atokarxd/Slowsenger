import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommitmentSource } from '../../../../core/commitments/commitment';

/** The chat message a commitment was recognised in, quoted word for word. */
@Component({
  selector: 'app-source-message',
  templateUrl: './source-message.html',
  styleUrl: './source-message.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceMessage {
  /** null: the commitment was added by hand, not recognised in a message. */
  readonly source = input.required<CommitmentSource | null>();
}
