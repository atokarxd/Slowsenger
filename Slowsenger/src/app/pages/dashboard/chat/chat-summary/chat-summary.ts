import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, afterRenderEffect, computed, effect, inject, input, model,
  output, signal, untracked, viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { SlowsengerDataService } from '../../../../core/supabase/slowsenger-data.service';
import { AI_CONSENT_MISSING, AppUserSummary, ChatSummaryResult } from '../../../../core/supabase/supabase.types';

/** How many unread messages make a chat worth summing up (in any chat): from here on the summary button shows. */
export const SUMMARY_MIN_UNREAD = 30;
/** How long the button waits for a first click, after the chat is opened. */
export const SUMMARY_WAIT_SECONDS = 30;
/** How long it stays after the summary has been read and closed, a ring around it counting down. */
export const SUMMARY_AFTER_SECONDS = 10;

/** waiting: not opened yet; open: the panel is out; countdown: closed again, the ring running out. */
export type SummaryPhase = 'waiting' | 'open' | 'countdown';

/** The summary itself: not asked for yet, on its way, there, refused for want of consent, or failed. */
export type SummaryState = 'idle' | 'loading' | 'ready' | 'consent' | 'error';

/** The messages that came in after since (every one, if the chat was never read). */
export function unreadCount(items: readonly { direction: string; created_at: string }[], since: string | null): number {
  const from = since ? new Date(since).getTime() : -Infinity;
  return items.filter((item) => item.direction === 'inbound' && new Date(item.created_at).getTime() > from).length;
}

/**
 * The AI summary of a chat with many unread messages: a blue round button at the chat's right edge, just
 * above the input (under the today button), which grows like a bubble (a goo filter over an SVG mask, as
 * the profile card's drop) into a panel nearly the size of the today panel, over the chat blurred and
 * dimmed behind it. The panel has the summary of the unread messages (the AI's, from the Edge Function
 * summarize-chat): a few points, the commitments and the decisions. It is asked for when the panel first
 * opens and kept while the chat is open. A click outside or Escape closes the panel.
 *
 * The button is an offer for a while: SUMMARY_WAIT_SECONDS if it is not used, or, once the summary has been
 * opened and closed, SUMMARY_AFTER_SECONDS with a ring around it counting them down. Then it says it has
 * expired and the chat lets it go. The time stands still while the pointer is on the button. Both times are
 * CSS animations (on a hidden element, and on the ring) whose end ends the offer.
 */
@Component({
  selector: 'app-chat-summary',
  templateUrl: './chat-summary.html',
  styleUrl: './chat-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-open]': 'open()',
    '[class.is-ready]': 'ready()',
    '[attr.data-phase]': 'phase()',
    '[style.--offer-time]': 'offerSeconds() + "s"',
    '(document:keydown.escape)': 'close()',
  },
})
export class ChatSummary {
  readonly open = model(false);
  /** How many unread messages there are to sum up (for the button's label). */
  readonly unread = input(0);
  /** The chat it sums up, and when it was last read before opening it (null: never). */
  readonly conversation = input<AppUserSummary | null>(null);
  readonly since = input<string | null>(null);
  /** The offer ran out: the chat removes the button. */
  readonly expired = output<void>();

  private readonly data = inject(SlowsengerDataService);
  readonly state = signal<SummaryState>('idle');
  readonly result = signal<ChatSummaryResult | null>(null);
  readonly errorText = signal('');
  private request: Subscription | null = null;
  /** Set after the first frame: the button pops out of nothing instead of just being there. */
  readonly ready = signal(false);
  readonly phase = signal<SummaryPhase>('waiting');
  /** How long the running offer lasts. */
  readonly offerSeconds = computed(() => (this.phase() === 'countdown' ? SUMMARY_AFTER_SECONDS : SUMMARY_WAIT_SECONDS));

  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    // Another chat (or the same one read again): its summary is yet to be asked for
    effect(() => {
      this.conversation();
      this.since();
      untracked(() => {
        this.request?.unsubscribe();
        this.state.set('idle');
        this.result.set(null);
      });
    });
    afterNextRender(() => requestAnimationFrame(() => this.ready.set(true)));
    afterRenderEffect(() => {
      if (this.open()) this.panel().nativeElement.focus({ preventScroll: true });
    });
  }

  show(): void {
    this.phase.set('open');
    this.open.set(true);
    if (this.state() === 'idle' || this.state() === 'error') this.load();
  }

  /** Asks for the summary; it stays until the chat changes. */
  load(): void {
    const conversation = this.conversation();
    if (!conversation) return;
    this.request?.unsubscribe();
    this.state.set('loading');
    this.request = this.data.summarizeChat(conversation, this.since()).subscribe({
      next: (result) => {
        this.result.set(result);
        this.state.set('ready');
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        if (message === AI_CONSENT_MISSING) {
          this.state.set('consent');
          return;
        }
        this.errorText.set(message || 'The summary could not be made.');
        this.state.set('error');
      },
    });
  }

  /** The running offer's time is up (its animation ended): unless the panel is out, the button goes. */
  onOfferEnd(): void {
    if (this.phase() !== 'open') this.expired.emit();
  }

  /** Back into the button, which takes the focus again; from now on the ring counts down. */
  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.phase.set('countdown');
    this.button().nativeElement.focus({ preventScroll: true });
  }
}
