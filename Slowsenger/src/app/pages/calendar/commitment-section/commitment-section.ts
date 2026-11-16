import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A titled list of commitments ("Due this day", "No deadline", ...). The cards are projected;
 * leave them out while loading, the section shows placeholders instead.
 */
@Component({
  selector: 'app-commitment-section',
  templateUrl: './commitment-section.html',
  styleUrl: './commitment-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentSection {
  readonly heading = input.required<string>();
  readonly count = input(0);
  /** A line under the heading, e.g. why these are not on the calendar. */
  readonly note = input<string | null>(null);
  readonly loading = input(false);
  /** Shown when count is 0. */
  readonly emptyText = input<string | null>(null);
}
