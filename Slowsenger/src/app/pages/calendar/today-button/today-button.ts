import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Calendar icon button that opens today's commitments. The parent places it. */
@Component({
  selector: 'app-today-button',
  templateUrl: './today-button.html',
  styleUrl: './today-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-expanded]': 'expanded()' },
})
export class TodayButton {
  /** Whether the panel it opens is open. */
  readonly expanded = input(false);
  readonly openRequested = output<void>();
}
