import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Slowly drifting blue and violet light, in the colours of the welcome page blobs.
 * Fills its parent behind the content; the parent needs position and isolation: isolate.
 */
@Component({
  selector: 'app-aurora',
  templateUrl: './aurora.html',
  styleUrl: './aurora.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
})
export class Aurora {}
