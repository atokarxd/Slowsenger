import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * "Send later", above the message input: when the next message goes ("Monday, 9:00 AM ›"), which opens the
 * card to change it (app-send-later), and a × to send at once again. The host is the row; the pill around it
 * (.chat-input-area.is-scheduling in chat.scss) wraps to hold it.
 */
@Component({
  selector: 'app-schedule-chip',
  templateUrl: './schedule-chip.html',
  styleUrl: './schedule-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleChip {
  /** "Monday, 9:00 AM" */
  readonly label = input.required<string>();
  /** The card is open. */
  readonly expanded = input(false);
  readonly toggled = output<void>();
  readonly cancelled = output<void>();
}
