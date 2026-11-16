import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AppUserSummary } from '../../../../core/supabase/supabase.types';

/** Who took the commitment on, or a warning when the conversation does not say. */
@Component({
  selector: 'app-commitment-owner',
  templateUrl: './commitment-owner.html',
  styleUrl: './commitment-owner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentOwner {
  readonly owner = input.required<AppUserSummary | null>();
  /** The owner is the signed-in user: shown as "You". */
  readonly isMe = input(false);
}
