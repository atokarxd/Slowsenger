import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';

/** What can be picked from the attach menu. */
export type AttachAction = 'file' | 'invite' | 'gif' | 'send-later';

/**
 * The "+" button next to the message pill. Pressed, a pill of four actions rises out of it like a drop
 * of liquid glass, and the icons draw themselves in one after the other; the "+" spins into a "×".
 *
 * The drop: the circle and the pill are white shapes in an SVG mask, blurred together and cut sharp again
 * (a goo filter), so while they are close they flow into one. That mask cuts the glass layer to shape.
 */
@Component({
  selector: 'app-attach-menu',
  templateUrl: './attach-menu.html',
  styleUrl: './attach-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-open]': 'open()',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class AttachMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toggleButton = viewChild.required<ElementRef<HTMLButtonElement>>('toggleButton');

  readonly open = signal(false);
  /** In a group: a commitment is between two people, so there is no invite to send (yet). */
  readonly inviteDisabled = input(false);
  readonly picked = output<AttachAction>();

  toggle(): void {
    this.open.update((open) => !open);
  }

  pick(action: AttachAction): void {
    this.open.set(false);
    this.picked.emit(action);
  }

  onDocumentPointerDown(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  onEscape(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.toggleButton().nativeElement.focus();
  }
}
