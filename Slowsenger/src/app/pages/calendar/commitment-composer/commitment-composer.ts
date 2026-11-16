import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { CommitmentService } from '../../../core/commitments/commitment.service';
import { AppUserSummary } from '../../../core/supabase/supabase.types';

/** The chat message a proposal is made from. */
export interface ComposerMessage {
  id: string;
  text: string;
  sentByMe: boolean;
}

/**
 * Makes a commitment proposal out of a chat message, by hand. It is linked to the message and
 * stays a proposal until the person named accepts it.
 */
@Component({
  selector: 'app-commitment-composer',
  templateUrl: './commitment-composer.html',
  styleUrl: './commitment-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-open]': '!!message()' },
})
export class CommitmentComposer {
  private readonly service = inject(CommitmentService);

  /** null: closed. */
  readonly message = input<ComposerMessage | null>(null);
  readonly partner = input<AppUserSummary | null>(null);
  readonly closed = output<void>();

  private readonly titleField = viewChild<ElementRef<HTMLTextAreaElement>>('titleField');

  readonly ownerChoice = signal<'me' | 'partner' | 'none'>('none');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly me = this.service.me;
  readonly ownerName = computed(() => {
    switch (this.ownerChoice()) {
      case 'me': return 'you';
      case 'partner': return this.partner()?.name ?? 'they';
      default: return null;
    }
  });

  constructor() {
    // Load the signed-in user (and the store) once, so "Me" can be offered; signed out, it stays empty
    this.service.load().subscribe({ error: () => undefined });
    afterRenderEffect(() => {
      if (this.message()) this.titleField()?.nativeElement.focus();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.message()) this.close();
  }

  save(title: string, date: string, time: string): void {
    const message = this.message();
    const partner = this.partner();
    if (!message || !partner) return;
    if (!title.trim()) {
      this.error.set('Write down what is to be done.');
      return;
    }
    const owner = { me: this.me(), partner, none: null }[this.ownerChoice()];
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time ? time.split(':').map(Number) : [0, 0];
    const due = date ? new Date(year, month - 1, day, hours, minutes).toISOString() : null;

    this.saving.set(true);
    this.service.create({ title, owner, due, hasTime: !!date && !!time, partner, message }).subscribe({
      next: () => this.close(),
      error: () => {
        this.saving.set(false);
        this.error.set('Could not save it, please try again.');
      },
    });
  }

  close(): void {
    this.saving.set(false);
    this.error.set(null);
    this.ownerChoice.set('none');
    this.closed.emit();
  }
}
