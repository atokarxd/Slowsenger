import {
  AfterViewChecked,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  NgZone,
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
  private readonly data = inject(SlowsengerDataService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  selectedUser = input<AppUserSummary | null>(null);
  isLoading = signal(false);
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef;
  @Output() backClicked = new EventEmitter<void>();

  messages: ChatMessage[] = [];
  globalOffsetX = 0;
  isDraggingAll = false;

  private touchStartX = 0;
  private realtimeChannel: RealtimeChannel | null = null;
  private messagesSubscription?: { unsubscribe(): void };

  constructor() {
    effect(() => {
      const user = this.selectedUser();

      this.cleanupRealtime();
      this.messagesSubscription?.unsubscribe();

      if (!user) {
        this.messages = [];
        return;
      }

      this.isLoading.set(true);
      const isMessengerThread = user.externalThreadId && !user.externalThreadId.startsWith('user:');
      const thread$ = isMessengerThread
        ? this.data.getThreadByExternalId(user.externalThreadId!)
        : this.data.getOrCreateDirectThread(user);

      this.messagesSubscription = thread$
        .pipe(
          switchMap((thread) => {
            if (!thread) throw new Error('Thread not found');
            this.subscribeToThread(thread.id, user);
            return this.data.getMessages(thread.id);
          })
        )
        .subscribe({
          next: (items) => {
            this.messages = this.mapMessages(items, user);
            this.isLoading.set(false);
          },
          error: () => {
            this.messages = [];
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
          this.ngZone.run(() => {
            if (this.messages.some((m) => m.id === msg.id)) return;
            this.messages = [
              ...this.messages,
              {
                id: msg.id,
                text: msg.content,
                time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: msg.direction === 'outbound' ? 'outgoing' : 'incoming',
                avatar: msg.direction === 'inbound' ? user.avatarUrl : undefined,
                offsetX: 0,
                isDragging: false,
              },
            ];
          });
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
    this.touchStartX = event instanceof TouchEvent ? event.touches[0].clientX : event.clientX;
  }

  onTouchMove(event: TouchEvent | MouseEvent) {
    if (!this.isDraggingAll) return;
    const currentX = event instanceof TouchEvent ? event.touches[0].clientX : event.clientX;
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
    if (index === this.messages.length - 1) return true;
    return this.messages[index].type !== this.messages[index + 1].type;
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      this.myScrollContainer.nativeElement.scrollTop = this.myScrollContainer.nativeElement.scrollHeight;
    } catch {}
  }

  goBack() {
    this.backClicked.emit();
  }

  onSendMessage(messageInput: HTMLInputElement): void {
    const user = this.selectedUser();
    const content = messageInput.value.trim();
    if (!user || !content) return;

    messageInput.value = '';

    const isMessengerThread = user.externalThreadId && !user.externalThreadId.startsWith('user:');
    const send$ = isMessengerThread
      ? this.data.sendMessengerMessage(user.id, content)
      : this.data.sendDirectMessage(user, content);

    send$.subscribe({ error: () => { messageInput.value = content; } });
  }
}
