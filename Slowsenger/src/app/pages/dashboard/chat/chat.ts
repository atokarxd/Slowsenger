import {
  AfterViewChecked,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { switchMap } from 'rxjs';
import { AppUserSummary, UnifiedMessageRow } from '../../../core/supabase/supabase.types';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { DEFAULT_AVATAR } from '../../../core/default-avatar';
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
  imports: [CommonModule],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat implements AfterViewChecked {
  readonly defaultAvatar = DEFAULT_AVATAR;
  private readonly data = inject(SlowsengerDataService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);

  selectedUser = input<AppUserSummary | null>(null);
  isLoading = signal(false);
  @ViewChild('scrollMe') private myScrollContainer?: ElementRef;
  @Output() backClicked = new EventEmitter<void>();

  readonly messages = signal<ChatMessage[]>([]);
  globalOffsetX = 0;
  isDraggingAll = false;

  private touchStartX = 0;
  private shouldScrollToBottom = false;
  private realtimeChannel: RealtimeChannel | null = null;
  private messagesSubscription?: { unsubscribe(): void };

  constructor() {
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
            this.shouldScrollToBottom = true;
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
          this.shouldScrollToBottom = true;
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

  // Only jump to the bottom when new messages arrive, so the user can scroll up to read history.
  ngAfterViewChecked() {
    if (this.shouldScrollToBottom && this.myScrollContainer) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  scrollToBottom(): void {
    const container = this.myScrollContainer?.nativeElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  goBack() {
    this.backClicked.emit();
  }

  onSendMessage(messageInput: HTMLInputElement): void {
    const user = this.selectedUser();
    const content = messageInput.value.trim();
    if (!user || !content) return;

    messageInput.value = '';

    this.data.sendDirectMessage(user, content).subscribe({ error: () => { messageInput.value = content; } });
  }
}
