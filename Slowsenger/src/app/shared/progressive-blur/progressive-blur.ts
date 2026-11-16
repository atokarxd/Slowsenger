import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The edge of the area where the blur is strongest. */
export type ProgressiveBlurEdge = 'top' | 'bottom';

/**
 * Progressive blur (after codepen.io/silas/pen/rNYqZoz) with a colour wash, for behind a bar at the
 * top or bottom of a scrolling area: content passing under it blurs more and more towards the edge
 * and fades into the colour, instead of ending in a line.
 *
 * Fills its positioned parent, behind the parent's own content, so a glass element in the bar still
 * sees (and bends) the blurred content.
 */
@Component({
  selector: 'app-progressive-blur',
  templateUrl: './progressive-blur.html',
  styleUrl: './progressive-blur.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[attr.data-edge]': 'edge()',
    '[style.--progressive-blur-radius]': 'radius()',
    '[style.--progressive-blur-color]': 'color()',
    '[style.--progressive-blur-strength]': 'strength()',
    '[style.--progressive-blur-tint]': 'tint() * 100 + "%"',
  },
})
export class ProgressiveBlur {
  /** One layer per step of $steps in progressive-blur.scss. */
  protected readonly layers = [1, 2, 3, 4, 5, 6];

  readonly edge = input.required<ProgressiveBlurEdge>();
  /** CSS border-radius, so the blur follows the corners of the area it sits in. */
  readonly radius = input('0');
  /** The colour the content fades into at the edge; null keeps the app background (v.$primary-color). */
  readonly color = input<string | null>(null);
  /** Scales every layer's blur: 1 is as in the pen (32px at the edge). */
  readonly strength = input(1);
  /** How much of the colour covers the content at the edge: 0 none, 1 solid. */
  readonly tint = input(0.75);
}
