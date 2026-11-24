import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, effect, inject,
  input, output, signal, untracked, viewChild,
} from '@angular/core';
import { NicknameService } from '../../../../core/nicknames/nickname.service';
import { NICKNAME_MAX_LENGTH } from '../../../../core/supabase/conversation-key';
import { AppUserSummary } from '../../../../core/supabase/supabase.types';
import { ToastService } from '../../../../core/toast/toast.service';
import { GroupAvatar } from '../../../../shared/group-avatar/group-avatar';

/** Where the chat header's user-info sits in the chat, in px: the card's drop comes out of it. */
export interface DetailOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The card under the chat header's user-info: the person's picture, name, username and nickname, or in a
 * group everyone in it with theirs. It drops out of the user-info like the "+" menu's pill (a goo filter
 * over an SVG mask, see attach-menu), over the chat blurred behind it. A nickname is saved when the card
 * is left (a click outside, Escape, Enter in the field): there is no save button. The "+" starts a group
 * with the people shown.
 */
@Component({
  selector: 'app-profile-detail',
  imports: [GroupAvatar],
  templateUrl: './profile-detail.html',
  styleUrl: './profile-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // .is-open and the origin (--ox, --oy, --ow, --oh) are set in the constructor's effect, in order
  host: { '(document:keydown.escape)': 'close()' },
})
export class ProfileDetail {
  private readonly nicknames = inject(NicknameService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  readonly open = input(false);
  /** A person, or a group (with its members). */
  readonly conversation = input<AppUserSummary | null>(null);
  readonly origin = input<DetailOrigin | null>(null);
  /** What the header's user-info shows, so its copy over the blur matches it. */
  readonly title = input('');
  readonly subtitle = input('');
  readonly closed = output<void>();
  readonly startGroup = output<AppUserSummary[]>();
  /** In a group: leave it, deleting the chat for the signed-in user (the chat does it). */
  readonly leave = output<void>();
  /** "Leave group" was pressed once: the card asks before leaving. */
  readonly confirmingLeave = signal(false);

  readonly maxLength = NICKNAME_MAX_LENGTH;
  readonly isGroup = computed(() => !!this.conversation()?.members);
  /** The people on the card: the person, or the group's members (the signed-in user left out). */
  readonly people = computed(() => {
    const conversation = this.conversation();
    return conversation ? conversation.members ?? [conversation] : [];
  });
  /** The nicknames being typed, by person id. */
  readonly drafts = signal<Readonly<Record<string, string>>>({});

  constructor() {
    // Opening: the closed drop is first put in the middle of the user-info without animating it there (from
    // wherever the last origin left it), and only then let out, so it always drops out of the user-info.
    // While open, a new origin (the chat resized) moves everything along at once, without animating.
    // Every opening starts from the saved nicknames.
    effect(() => {
      const open = this.open();
      const origin = this.origin();
      untracked(() => {
        const host = this.host.nativeElement;
        if (!open || !origin) {
          host.classList.remove('is-open');
          return;
        }
        host.classList.add('is-placing');
        host.style.setProperty('--ox', `${origin.x}px`);
        host.style.setProperty('--oy', `${origin.y}px`);
        host.style.setProperty('--ow', `${origin.width}px`);
        host.style.setProperty('--oh', `${origin.height}px`);
        void host.getBoundingClientRect(); // applies the styles above before anything animates
        host.classList.remove('is-placing');
        if (host.classList.contains('is-open')) return;
        host.classList.add('is-open');
        this.confirmingLeave.set(false);

        const conversation = this.conversation();
        this.drafts.set(Object.fromEntries(
          this.people().map((p) => [p.id, (conversation && this.nicknames.of(conversation, p.id)) ?? '']),
        ));
      });
    });
    // The drop grows to the card's height, whatever is on it
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const card = this.card().nativeElement;
      const observer = new ResizeObserver(() => this.host.nativeElement.style.setProperty('--card-h', `${card.offsetHeight}px`));
      observer.observe(card);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    afterRenderEffect(() => {
      if (this.open()) this.card().nativeElement.focus({ preventScroll: true });
    });
  }

  draft(personId: string): string {
    return this.drafts()[personId] ?? '';
  }

  setDraft(personId: string, value: string): void {
    this.drafts.update((drafts) => ({ ...drafts, [personId]: value }));
  }

  /** Leaves the card, saving the nicknames that changed (not when leaving the group itself). */
  close(save = true): void {
    if (!this.open()) return;
    const conversation = this.conversation();
    if (conversation && save) {
      const changes = new Map<string, string>();
      for (const person of this.people()) {
        const nickname = this.draft(person.id).trim();
        if (nickname !== (this.nicknames.of(conversation, person.id) ?? '')) changes.set(person.id, nickname);
      }
      if (changes.size > 0) {
        this.nicknames.save(conversation, changes).subscribe({
          error: () => this.toast.show('Could not save the nickname.', 'error'),
        });
      }
    }
    this.closed.emit();
  }

  /** The confirmed "Leave": the card closes and the chat leaves the group. */
  leaveGroup(): void {
    this.close(false);
    this.leave.emit();
  }

  /** The "+": a new message to the people on the card, to add someone else to and so start a group. */
  addPeople(): void {
    const people = this.people();
    this.close();
    this.startGroup.emit(people);
  }
}
