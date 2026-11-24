import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, effect, inject, input, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { GifResult, GiphyError, GiphyService } from '../../../../core/giphy/giphy.service';
import { GifAttachment } from '../../../../core/supabase/supabase.types';
import { ProgressiveBlur } from '../../../../shared/progressive-blur/progressive-blur';

/** Wait this long after the last keystroke before searching, to spare the key's hourly limit (ms). */
const SEARCH_DELAY_MS = 350;

/**
 * GIF search above the message bar: trending GIFs first, search results while typing. Picking one sends it.
 * GIPHY asks for its "Powered by GIPHY" wherever its results are shown.
 */
@Component({
  selector: 'app-gif-picker',
  templateUrl: './gif-picker.html',
  styleUrl: './gif-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ ProgressiveBlur ],
  host: {
    '[class.is-open]': 'open()',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class GifPicker {
  private readonly giphy = inject(GiphyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');
  private readonly searchToggle = viewChild<ElementRef<HTMLButtonElement>>('searchToggle');

  readonly open = input(false);
  readonly picked = output<GifAttachment>();
  readonly closed = output<void>();

  readonly configured = this.giphy.configured;
  /** The search field has popped out of its circle. */
  readonly searchOpen = signal(false);
  readonly query = signal('');
  readonly results = signal<GifResult[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private controller?: AbortController;
  private debounce?: ReturnType<typeof setTimeout>;

  constructor() {
    // Every opening starts with what is trending, the search folded into its circle; closing drops a search
    // still on its way
    effect(() => {
      const open = this.open();
      untracked(() => {
        if (open) {
          this.query.set('');
          this.searchOpen.set(false);
          void this.load('');
        } else {
          this.cancel();
        }
      });
    });
    // The circle takes the focus, so Enter opens the search and Escape still closes the picker
    afterRenderEffect(() => {
      if (this.open()) this.searchToggle()?.nativeElement.focus();
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.load(value), SEARCH_DELAY_MS);
  }

  toggleSearch(): void {
    if (this.searchOpen()) {
      this.closeSearch();
    } else {
      this.searchOpen.set(true);
      this.searchField()?.nativeElement.focus();
    }
  }

  /** Leaving an empty field folds it back into the circle; one with a search in it stays out. */
  onSearchBlur(): void {
    if (!this.query().trim()) this.searchOpen.set(false);
  }

  /** Folds the field away; a search typed into it goes with it, so the trending GIFs are back. */
  private closeSearch(): void {
    this.searchOpen.set(false);
    this.searchToggle()?.nativeElement.focus();
    if (this.query()) {
      this.query.set('');
      void this.load('');
    }
  }

  pick(result: GifResult): void {
    this.picked.emit(result.gif);
  }

  onDocumentPointerDown(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.closed.emit();
  }

  onEscape(): void {
    if (this.open()) this.closed.emit();
  }

  private async load(query: string): Promise<void> {
    if (!this.configured) return;
    this.cancel();
    const controller = (this.controller = new AbortController());
    this.loading.set(true);
    this.error.set(null);
    try {
      const results = await this.giphy.find(query, controller.signal);
      if (!controller.signal.aborted) this.results.set(results);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.results.set([]);
      this.error.set(error instanceof GiphyError ? error.message : 'Could not load the GIFs.');
    } finally {
      if (this.controller === controller) this.loading.set(false);
    }
  }

  private cancel(): void {
    clearTimeout(this.debounce);
    this.controller?.abort();
    this.controller = undefined;
  }
}
