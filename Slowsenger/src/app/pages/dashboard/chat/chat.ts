import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { switchMap } from 'rxjs';
import { AppUserSummary, UnifiedMessageRow } from '../../../core/supabase/supabase.types';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { DEFAULT_AVATAR } from '../../../core/default-avatar';
import { CommitmentComposer, ComposerMessage } from '../../calendar/commitment-composer/commitment-composer';
import { ProgressiveBlur } from '../../../shared/progressive-blur/progressive-blur';
import { TodayButton } from '../../calendar/today-button/today-button';
import { TodayPanel } from '../../calendar/today-panel/today-panel';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface ChatMessage {
  id: string;
  text: string;
  time: string;
  type: 'incoming' | 'outgoing';
  avatar?: string;
  offsetX: number;
  isDragging: boolean;
}

@Component({
  selector: 'app-chat',
  imports: [CommonModule, TodayButton, TodayPanel, CommitmentComposer, ProgressiveBlur],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  host: { '[class.today-open]': 'isTodayOpen()' },
})
export class Chat {
  readonly defaultAvatar = DEFAULT_AVATAR;
  private readonly data = inject(SlowsengerDataService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);

  selectedUser = input<AppUserSummary | null>(null);
  /** Changes only when another user is picked, not when the same one arrives as a new object. */
  private readonly partnerId = computed(() => this.selectedUser()?.id ?? null);
  isLoading = signal(false);
  private readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollMe');
  @Output() backClicked = new EventEmitter<void>();

  readonly messages = signal<ChatMessage[]>([]);
  /** Today's commitments panel (calendar feature). */
  readonly isTodayOpen = signal(false);
  /** The message a commitment is being made from (calendar feature). */
  readonly composing = signal<ComposerMessage | null>(null);
  globalOffsetX = 0;
  isDraggingAll = false;

  private touchStartX = 0;
  private realtimeChannel: RealtimeChannel | null = null;
  private messagesSubscription?: { unsubscribe(): void };

  constructor() {
    // Picking another user closes the today panel, so its button is back in the new conversation
    effect(() => {
      this.partnerId();
      this.isTodayOpen.set(false);
    });

    effect(() => {
      const user = this.selectedUser();

      this.cleanupRealtime();
      this.messagesSubscription?.unsubscribe();

      if (!user) {
        this.messages.set([]);
        return;
      }

      this.isLoading.set(true);

      this.messagesSubscription = this.data.getOrCreateDirectThread(user)
        .pipe(
          switchMap((thread) => {
            this.subscribeToThread(thread.id, user);
            return this.data.getMessages(thread.id);
          })
        )
        .subscribe({
          next: (items) => {
            this.messages.set(this.mapMessages(items, user));
            this.isLoading.set(false);
          },
          error: () => {
            this.messages.set([]);
            this.isLoading.set(false);
          },
          complete: () => {
            this.isLoading.set(false);
          },
        });
    });

    // Jump to the newest message when the list changes or the message area appears after loading.
    // Not on every change detection, so the user can scroll up to read history.
    afterRenderEffect(() => {
      this.messages();
      const container = this.scrollContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });

    this.destroyRef.onDestroy(() => {
      this.cleanupRealtime();
      this.messagesSubscription?.unsubscribe();
    });
  }

  private mapMessages(items: UnifiedMessageRow[], user: AppUserSummary): ChatMessage[] {
    return items.map((item) => ({
      id: item.id,
      text: item.content,
      time: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: item.direction === 'outbound' ? 'outgoing' : 'incoming',
      avatar: item.direction === 'inbound' ? user.avatarUrl : undefined,
      offsetX: 0,
      isDragging: false,
    }));
  }

  private subscribeToThread(threadId: string, user: AppUserSummary): void {
    this.cleanupRealtime();

    this.realtimeChannel = this.supabaseService.client
      .channel(`messages:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'unified_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const msg = payload.new as UnifiedMessageRow;
          if (this.messages().some((m) => m.id === msg.id)) return;
          this.messages.update((list) => [...list, ...this.mapMessages([msg], user)]);
        }
      )
      .subscribe();
  }

  private cleanupRealtime(): void {
    if (this.realtimeChannel) {
      this.supabaseService.client.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
  }

  onTouchStart(event: TouchEvent | MouseEvent) {
    this.isDraggingAll = true;
    this.touchStartX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  }

  onTouchMove(event: TouchEvent | MouseEvent) {
    if (!this.isDraggingAll) return;
    const currentX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const diffX = currentX - this.touchStartX;
    const maxSwipe = 60;
    if (diffX < 0 && diffX >= -maxSwipe) {
      this.globalOffsetX = diffX;
    }
  }

  onTouchEnd() {
    this.isDraggingAll = false;
    this.globalOffsetX = 0;
  }

  getRevealOpacity(): number {
    return Math.abs(this.globalOffsetX) / 60;
  }

  isLastInGroup(index: number): boolean {
    const messages = this.messages();
    if (index === messages.length - 1) return true;
    return messages[index].type !== messages[index + 1].type;
  }

  goBack() {
    this.backClicked.emit();
  }

  composeFrom(msg: ChatMessage): void {
    this.composing.set({ id: msg.id, text: msg.text, sentByMe: msg.type === 'outgoing' });
  }

  onSendMessage(messageInput: HTMLInputElement): void {
    const user = this.selectedUser();
    const content = messageInput.value.trim();
    if (!user || !content) return;

    messageInput.value = '';

    this.data.sendDirectMessage(user, content).subscribe({ error: () => { messageInput.value = content; } });
  }
}
