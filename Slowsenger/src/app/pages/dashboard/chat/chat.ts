import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { switchMap } from 'rxjs';
import {
  AppUserSummary,
  MessageAttachment as Attachment,
  GifAttachment,
  ReplyRef,
  ScheduledMessageRow,
  UnifiedMessageRow,
} from '../../../core/supabase/supabase.types';
import { DATE_LOCALE, dayKey } from '../../../core/commitments/commitment';
import { FileStore, MAX_FILE_BYTES, formatBytes } from '../../../core/files/file-store';
import { ToastService } from '../../../core/toast/toast.service';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { DEFAULT_AVATAR } from '../../../core/default-avatar';
import { CommitmentComposer } from '../../calendar/commitment-composer/commitment-composer';
import { ProgressiveBlur } from '../../../shared/progressive-blur/progressive-blur';
import { TodayButton } from '../../calendar/today-button/today-button';
import { TodayPanel } from '../../calendar/today-panel/today-panel';
import { CommitmentService } from '../../../core/commitments/commitment.service';
import { AttachAction, AttachMenu } from './attach-menu/attach-menu';
import { ChatCommitmentCard } from './chat-commitment-card/chat-commitment-card';
import { GifPicker } from './gif-picker/gif-picker';
import { MessageAttachment } from './message-attachment/message-attachment';
import { SendLater, nextMorning, scheduleLabel } from './send-later/send-later';
import { ScheduleChip } from './schedule-chip/schedule-chip';
import { GroupAvatar, memberColor } from '../../../shared/group-avatar/group-avatar';
import { NicknameService } from '../../../core/nicknames/nickname.service';
import { DetailOrigin, ProfileDetail } from './profile-detail/profile-detail';
import { ChatSummary, SUMMARY_MIN_UNREAD, unreadCount } from './chat-summary/chat-summary';
import type { RealtimeChannel } from '@supabase/supabase-js';

const DAY_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const TIME_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' });

/** "today, 20:00", "tomorrow, 09:00", "Fri 21 Nov, 09:00": when a scheduled message goes out. */
export function sendsAt(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = dayKey(at) === dayKey(now) ? 'today' : dayKey(at) === dayKey(tomorrow) ? 'tomorrow' : DAY_FORMAT.format(at);
  return `${day}, ${TIME_FORMAT.format(at)}`;
}

/**
 * A character that shows as nothing: any kind of space (\s also covers the no-break and ideographic ones),
 * the zero-width ones, and the blank fillers people use to send "empty" messages.
 */
const BLANK = /[\s\u00AD\u180E\u200B-\u200D\u2060\u2800\u115F\u1160\u3164\uFFA0]/;

function leadingBlanks(text: string): number {
  let count = 0;
  while (count < text.length && BLANK.test(text[count])) count++;
  return count;
}

/** Like String.trim(), but for every BLANK character. */
function trimBlanks(text: string): string {
  const start = leadingBlanks(text);
  let end = text.length;
  while (end > start && BLANK.test(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Removes the blanks from the start of the field, keeping the caret where it was in the text. */
function stripLeadingBlanks(field: HTMLInputElement): void {
  const count = leadingBlanks(field.value);
  if (!count) return;
  const start = field.selectionStart ?? count;
  const end = field.selectionEnd ?? start;
  field.value = field.value.slice(count);
  field.setSelectionRange(Math.max(0, start - count), Math.max(0, end - count));
}

/** How far (px) a bubble is swiped toward the middle before letting go answers it. */
const REPLY_SWIPE = 56;
/** How far (px) the messages slide left to show every one's time. */
const TIMES_SWIPE = 60;
/** Movement (px) before a press counts as a swipe one way or the other (or as scrolling). */
const SWIPE_SLOP = 8;

interface ChatMessage {
  id: string;
  text: string;
  time: string;
  /** system: a card from the app itself (a suggestion of the recognizer), in the middle for both people. */
  type: 'incoming' | 'outgoing' | 'system';
  avatar?: string;
  /** When it was sent: the same in every copy, so a reply finds it in any thread. */
  createdAt: string;
  /** Set: the message answers this one. */
  replyTo: ReplyRef | null;
  /** Set: shown as a commitment card instead of the text. */
  commitmentId: string | null;
  /** Set: the GIF or file is shown instead of the text. */
  attachment: Attachment | null;
  /** Who wrote it; in a group, incoming ones also show their first name in their own colour. */
  senderId: string | null;
  senderName: string;
  senderColor: string;
}

@Component({
  selector: 'app-chat',
  imports: [
    CommonModule, TodayButton, TodayPanel, CommitmentComposer, ProgressiveBlur, AttachMenu, ChatCommitmentCard,
    GifPicker, MessageAttachment, SendLater, ScheduleChip, GroupAvatar, ProfileDetail, ChatSummary,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  host: { '[class.today-open]': 'isTodayOpen()' },
})
export class Chat {
  readonly defaultAvatar = DEFAULT_AVATAR;
  private readonly data = inject(SlowsengerDataService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly commitmentService = inject(CommitmentService);
  private readonly files = inject(FileStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly nicknames = inject(NicknameService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  selectedUser = input<AppUserSummary | null>(null);
  /** When this conversation was last read before it was opened now (null: never): what came after is unread. */
  readonly unreadSince = input<string | null>(null);
  /** How many messages were unread when it was opened; from SUMMARY_MIN_UNREAD the AI summary button shows. */
  readonly unreadAtOpen = signal(0);
  /** Its offer ran out unused (the ring around it counted down): gone until the chat is opened again. */
  readonly summaryExpired = signal(false);
  readonly showSummary = computed(() => this.unreadAtOpen() >= SUMMARY_MIN_UNREAD && !this.summaryExpired());
  readonly summaryOpen = signal(false);
  /** Changes only when another user is picked, not when the same one arrives as a new object. */
  private readonly partnerId = computed(() => this.selectedUser()?.id ?? null);
  /** A group conversation rather than one with a person. */
  readonly isGroup = computed(() => !!this.selectedUser()?.members);
  /** The header's name: a person's nickname in this chat if they have one; a group's name. */
  readonly headerTitle = computed(() => {
    const user = this.selectedUser();
    if (!user) return 'Select a user';
    return user.members ? user.name : this.nicknames.of(user, user.id) ?? user.name;
  });
  /** "Anna, Péter, Eszter & you" (or their nicknames here), under a group's name. */
  readonly memberLine = computed(() => {
    const user = this.selectedUser();
    if (!user?.members) return '';
    return `${user.members.map((m) => this.nicknames.of(user, m.id) ?? m.name.split(' ')[0]).join(', ')} & you`;
  });
  /** The profile card under the user-info, and where the user-info was when it opened. */
  readonly detailOpen = signal(false);
  readonly detailOrigin = signal<DetailOrigin | null>(null);
  /** The profile card's "+": a new message to these people, to start a group. */
  readonly startGroup = output<AppUserSummary[]>();
  /** This group was left (and its chat deleted): nothing to show here any more. */
  readonly conversationLeft = output<void>();
  private readonly userInfo = viewChild<ElementRef<HTMLElement>>('userInfo');
  isLoading = signal(false);
  private readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollMe');
  private readonly messageInput = viewChild<ElementRef<HTMLInputElement>>('messageInput');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly inputBar = viewChild<ElementRef<HTMLElement>>('inputBar');
  @Output() backClicked = new EventEmitter<void>();

  readonly messages = signal<ChatMessage[]>([]);
  /** The signed-in user's messages to this partner waiting to be sent later, earliest first. */
  readonly scheduled = signal<ScheduledMessageRow[]>([]);
  /** Today's commitments panel (calendar feature). */
  readonly isTodayOpen = signal(false);
  /** From the attach menu: a commitment invite being set up, the GIF picker. */
  readonly inviting = signal(false);
  readonly gifOpen = signal(false);
  /**
   * "Send later" (from the attach menu): set, the next message is scheduled for then instead of sent. The
   * input shows it as a button above the text ("Monday, 9:00 AM ›"), which opens the card to change it.
   */
  readonly scheduleAt = signal<Date | null>(null);
  readonly schedulePickerOpen = signal(false);
  readonly scheduleText = computed(() => {
    const at = this.scheduleAt();
    return at ? scheduleLabel(at) : '';
  });
  private readonly scheduleChip = viewChild('scheduleChip', { read: ElementRef<HTMLElement> });
  /** The schedule button, which the card does not count as a click elsewhere (it opens and closes it). */
  readonly scheduleAnchor = computed(() => this.scheduleChip()?.nativeElement ?? null);
  readonly sendsAt = sendsAt;
  /** Whether there is something to send; the send button shows only then. */
  readonly hasText = signal(false);
  /** Width the typed text needs; the input grows to it and the pill's max-width caps it (see fitInput). */
  readonly textWidth = signal(0);
  private textCanvas?: CanvasRenderingContext2D | null;
  /** Swiping right to left away from the bubbles: every message slides left and shows its time. */
  globalOffsetX = 0;
  isDraggingAll = false;
  /** A bubble being swiped toward the middle (to answer it), and how far. */
  readonly swipe = signal<{ id: string; offset: number } | null>(null);
  /** The press being followed: on a bubble or beside them, and once it has moved, which swipe it is. */
  private gesture: {
    pointerId: number; x: number; y: number; message: ChatMessage | null; kind: 'undecided' | 'reply' | 'times';
  } | null = null;
  /** The message the next one answers (a swiped bubble), shown above the input. */
  readonly replyingTo = signal<ChatMessage | null>(null);
  /** The answered message just scrolled to from a reply's quote, lit up for a moment. */
  readonly flashedId = signal<string | null>(null);

  private realtimeChannel: RealtimeChannel | null = null;
  private messagesSubscription?: { unsubscribe(): void };

  constructor() {
    // The open profile card follows the user-info when the chat changes size (a turned phone, a resized
    // window, the list appearing beside it)
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        const userInfo = this.userInfo()?.nativeElement;
        if (this.detailOpen() && userInfo) this.placeDetail(userInfo);
      });
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    // Picking another user closes the today panel, so its button is back in the new conversation, and
    // whatever was being set up from the attach menu, which was meant for the previous one
    effect(() => {
      this.partnerId();
      this.isTodayOpen.set(false);
      this.inviting.set(false);
      this.gifOpen.set(false);
      this.scheduleAt.set(null);
      this.schedulePickerOpen.set(false);
      this.detailOpen.set(false);
      this.replyingTo.set(null);
      this.summaryOpen.set(false);
      this.summaryExpired.set(false);
      this.unreadAtOpen.set(0);
    });

    // The message input's height (it grows with the text, the reply bar, "send later"), for what sits
    // just above it at the right edge: the AI summary button
    effect((onCleanup) => {
      const bar = this.inputBar()?.nativeElement;
      if (!bar || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        this.host.nativeElement.style.setProperty('--chat-input-h', `${bar.offsetHeight}px`));
      observer.observe(bar);
      onCleanup(() => observer.disconnect());
    });

    effect(() => {
      const user = this.selectedUser();

      this.cleanupRealtime();
      this.messagesSubscription?.unsubscribe();

      if (!user) {
        this.messages.set([]);
        this.scheduled.set([]);
        return;
      }
      this.scheduled.set([]);
      this.loadScheduled(user);

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
            this.unreadAtOpen.set(unreadCount(items, this.unreadSince()));
            this.isLoading.set(false);
            this.loadCardCommitments(items);
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
    return items.map((item) => {
      // In a group the sender is one of its members; with a person, it is them
      const sender = user.members ? user.members.find((m) => m.id === item.sender_user_id) : user;
      // Nobody sent it: a card from the app itself
      const system = item.sender_user_id === null;
      return {
        id: item.id,
        text: item.content,
        time: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: system ? 'system' : item.direction === 'outbound' ? 'outgoing' : 'incoming',
        avatar: item.direction === 'inbound' && !system ? sender?.avatarUrl ?? DEFAULT_AVATAR : undefined,
        createdAt: item.created_at,
        replyTo: item.reply_to ?? null,
        commitmentId: item.commitment_id ?? null,
        attachment: item.attachment ?? null,
        senderId: item.sender_user_id,
        senderName: sender?.name.split(' ')[0] ?? 'Someone',
        senderColor: memberColor(item.sender_user_id),
      };
    });
  }

  private loadScheduled(user: AppUserSummary): void {
    this.data.getScheduledMessages(user).subscribe({
      // The answer may come after another user was picked
      next: (rows) => { if (this.partnerId() === user.id) this.scheduled.set(rows); },
      error: () => undefined,
    });
  }

  /** Cards show their commitment from the store: load it again when a card's commitment is not there (yet). */
  private loadCardCommitments(items: UnifiedMessageRow[]): void {
    const known = new Set(this.commitmentService.commitments().map((c) => c.id));
    if (items.some((item) => item.commitment_id && !known.has(item.commitment_id))) {
      this.commitmentService.load().subscribe({ error: () => undefined });
    }
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
          this.loadCardCommitments([msg]);
          // One of ours arriving may be a scheduled one that went out: it is not waiting any more
          if (msg.direction === 'outbound' && this.scheduled().length) this.loadScheduled(user);
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

  // ─── Swipes ─────────────────────────────────────────────────────────────────
  // On a bubble, toward the middle answers it: someone else's from left to right, your own from right to
  // left (the other way does nothing). Anywhere else, right to left slides every message over to show its
  // time. Up and down stays scrolling (touch-action: pan-y in chat.scss).

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture) return;
    const target = event.target as Element;
    // Buttons, links and fields inside a bubble keep their own clicks
    if (target.closest('button, a, input, textarea, select, video, audio')) return;
    const area = target.closest<HTMLElement>('.swipeable-area[data-message-id]');
    const message = area ? this.messages().find((m) => m.id === area.dataset['messageId']) ?? null : null;
    this.gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, message, kind: 'undecided' };
  }

  onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (gesture.kind === 'undecided') {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      const towards = gesture.message?.type === 'incoming' ? 1 : -1;
      if (Math.abs(dy) > Math.abs(dx) || Math.sign(dx) !== towards) {
        this.gesture = null;
        return;
      }
      gesture.kind = gesture.message ? 'reply' : 'times';
      this.isDraggingAll = gesture.kind === 'times';
      // Keeps the moves coming when the pointer leaves the bubble (or the chat)
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }

    if (gesture.kind === 'times') {
      this.globalOffsetX = Math.max(-TIMES_SWIPE, Math.min(0, dx));
      return;
    }
    const message = gesture.message!;
    const towards = message.type === 'incoming' ? 1 : -1;
    const distance = Math.max(0, dx * towards);
    // Follows the finger up to where letting go answers, then only reluctantly
    const offset = Math.min(
      distance <= REPLY_SWIPE ? distance : REPLY_SWIPE + (distance - REPLY_SWIPE) * 0.25,
      REPLY_SWIPE + 24,
    );
    const wasArmed = Math.abs(this.swipe()?.offset ?? 0) >= REPLY_SWIPE;
    this.swipe.set({ id: message.id, offset: offset * towards });
    if (!wasArmed && offset >= REPLY_SWIPE) navigator.vibrate?.(8);
  }

  onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.kind === 'reply' && Math.abs(this.swipe()?.offset ?? 0) >= REPLY_SWIPE) this.startReply(gesture.message!);
    this.endSwipe();
  }

  /**
   * Only the list losing the pointer ends a swipe. A finger starts out captured by the bubble it touched,
   * and that capture ending (when the list takes the pointer over) bubbles up here too.
   */
  onLostPointerCapture(event: PointerEvent): void {
    if (event.target === event.currentTarget) this.endSwipe();
  }

  /** The browser took the press over (scrolling), or the pointer was lost: everything slides back. */
  endSwipe(): void {
    this.gesture = null;
    this.swipe.set(null);
    this.isDraggingAll = false;
    this.globalOffsetX = 0;
  }

  getRevealOpacity(): number {
    return Math.abs(this.globalOffsetX) / TIMES_SWIPE;
  }

  /** How far a bubble is swiped (0 unless it is the one). */
  swipeOffset(message: ChatMessage): number {
    const swipe = this.swipe();
    return swipe?.id === message.id ? swipe.offset : 0;
  }

  /** The reply arrow beside a swiped bubble: fades in with the swipe, full once letting go answers. */
  replyHintOpacity(message: ChatMessage): number {
    return Math.min(1, Math.abs(this.swipeOffset(message)) / REPLY_SWIPE);
  }

  isReplyArmed(message: ChatMessage): boolean {
    return Math.abs(this.swipeOffset(message)) >= REPLY_SWIPE;
  }

  // ─── Replies ────────────────────────────────────────────────────────────────

  startReply(message: ChatMessage): void {
    this.replyingTo.set(message);
    this.messageInput()?.nativeElement.focus();
  }

  cancelReply(): void {
    this.replyingTo.set(null);
  }

  /** Who wrote an answered message, as this chat calls them: "You", a nickname, or a first name. */
  replyAuthor(senderId: string | null): string {
    const user = this.selectedUser();
    if (!senderId || !user) return '';
    if (senderId === this.nicknames.myId() || this.messages().some((m) => m.senderId === senderId && m.type === 'outgoing')) {
      return 'You';
    }
    const person = user.members ? user.members.find((m) => m.id === senderId) : user;
    return this.nicknames.of(user, senderId) ?? person?.name.split(' ')[0] ?? 'Someone';
  }

  /** A reply's quote, clicked: the answered message comes into view and lights up for a moment. */
  showOriginal(ref: ReplyRef): void {
    const original = this.messages().find((m) => m.senderId === ref.sender_user_id && m.createdAt === ref.created_at);
    const element = original && this.scrollContainer()?.nativeElement.querySelector(`[data-message-id="${original.id}"]`);
    if (!original || !element) {
      this.toast.show('That message is no longer in this chat.', 'info');
      return;
    }
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.flashedId.set(original.id);
    setTimeout(() => {
      if (this.flashedId() === original.id) this.flashedId.set(null);
    }, 1400);
  }

  /** The last of a run of messages from the same person: it gets the avatar and the bubble's tail. */
  isLastInGroup(index: number): boolean {
    const messages = this.messages();
    if (index === messages.length - 1) return true;
    return !this.sameRun(messages[index], messages[index + 1]);
  }

  /** The first of a run: in a group, an incoming one shows who wrote it. */
  isFirstInRun(index: number): boolean {
    const messages = this.messages();
    return index === 0 || !this.sameRun(messages[index - 1], messages[index]);
  }

  private sameRun(a: ChatMessage, b: ChatMessage): boolean {
    return a.type === b.type && a.senderId === b.senderId;
  }

  goBack() {
    this.backClicked.emit();
  }

  /** The profile card drops out of the user-info, so it opens from where the user-info is in the chat. */
  openDetail(userInfo: HTMLElement): void {
    if (!this.selectedUser() || this.detailOpen()) return;
    this.placeDetail(userInfo);
    this.detailOpen.set(true);
  }

  private placeDetail(userInfo: HTMLElement): void {
    const box = userInfo.getBoundingClientRect();
    const chat = this.host.nativeElement.getBoundingClientRect();
    this.detailOrigin.set({ x: box.left - chat.left, y: box.top - chat.top, width: box.width, height: box.height });
  }

  onDetailClosed(): void {
    this.detailOpen.set(false);
    this.userInfo()?.nativeElement.focus({ preventScroll: true });
  }

  /** The profile card's confirmed "Leave group": out of the group, its chat deleted for the signed-in user. */
  leaveGroup(): void {
    const group = this.selectedUser();
    if (!group?.members) return;
    this.data.leaveGroup(group).subscribe({
      next: () => {
        this.toast.show(`You left ${group.name}.`, 'success');
        this.conversationLeft.emit();
      },
      error: () => this.toast.show('Could not leave the group.', 'error'),
    });
  }

  /** A sender's name over their messages in a group: their nickname here, if they have one. */
  senderLabel(msg: ChatMessage): string {
    const user = this.selectedUser();
    return (user && msg.senderId && this.nicknames.of(user, msg.senderId)) || msg.senderName;
  }

  onAttach(action: AttachAction): void {
    switch (action) {
      case 'invite':
        this.inviting.set(true);
        break;
      case 'gif':
        this.gifOpen.set(true);
        break;
      case 'file':
        this.fileInput()?.nativeElement.click();
        break;
      case 'send-later':
        // The next morning to start with; the button above the input changes it
        this.scheduleAt.set(nextMorning());
        this.messageInput()?.nativeElement.focus();
        break;
    }
  }

  onGifPicked(gif: GifAttachment): void {
    const user = this.selectedUser();
    this.gifOpen.set(false);
    if (!user) return;
    this.data.sendAttachment(user, gif, `GIF: ${gif.title}`).subscribe({
      error: () => this.toast.show('Could not send the GIF.', 'error'),
    });
  }

  /** Stores the picked file, then sends a message that points to it. */
  onFilePicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = ''; // so the same file can be picked again
    const user = this.selectedUser();
    if (!file || !user) return;
    if (file.size > MAX_FILE_BYTES) {
      this.toast.show(`Files up to ${formatBytes(MAX_FILE_BYTES)} can be attached.`, 'error');
      return;
    }
    this.files.save(file, user).pipe(
      switchMap((fileId) => this.data.sendAttachment(user, {
        kind: 'file', fileId, name: file.name, size: file.size, type: file.type || 'application/octet-stream',
      }, `File: ${file.name}`)),
    ).subscribe({
      error: () => this.toast.show('Could not send the file.', 'error'),
    });
  }

  /** Back to sending at once. */
  cancelSchedule(): void {
    this.scheduleAt.set(null);
    this.schedulePickerOpen.set(false);
    this.messageInput()?.nativeElement.focus();
  }

  /** The draft went into the scheduled message, so it leaves the input. */
  onScheduled(row: ScheduledMessageRow): void {
    this.scheduled.update((list) => [...list, row].sort((a, b) => a.send_at.localeCompare(b.send_at)));
    const input = this.messageInput()?.nativeElement;
    if (input) {
      input.value = '';
      this.syncDraft(input);
    }
  }

  cancelScheduled(row: ScheduledMessageRow): void {
    this.data.cancelScheduledMessage(row.id).subscribe({
      next: () => this.scheduled.update((list) => list.filter((item) => item.id !== row.id)),
      error: () => this.toast.show('Could not cancel it.', 'error'),
    });
  }

  onSendMessage(messageInput: HTMLInputElement): void {
    const user = this.selectedUser();
    const content = trimBlanks(messageInput.value);
    if (!user || !content) return;

    // "Send later": scheduled for the time on the button above the input, which then goes away
    const at = this.scheduleAt();
    if (at) {
      if (at.getTime() <= Date.now()) {
        this.toast.show('That time has passed: pick a later one.', 'error');
        this.schedulePickerOpen.set(true);
        return;
      }
      messageInput.value = '';
      this.syncDraft(messageInput);
      this.data.scheduleMessage(user, content, at).subscribe({
        next: (row) => {
          this.onScheduled(row);
          this.scheduleAt.set(null);
          this.schedulePickerOpen.set(false);
        },
        error: (error: Error) => {
          messageInput.value = content;
          this.syncDraft(messageInput);
          this.toast.show(error.message || 'Could not schedule it.', 'error');
        },
      });
      return;
    }

    messageInput.value = '';
    this.syncDraft(messageInput);
    // A swiped bubble: this message answers it
    const answered = this.replyingTo();
    const replyTo: ReplyRef | null = answered?.senderId
      ? { sender_user_id: answered.senderId, created_at: answered.createdAt, preview: answered.text }
      : null;
    this.replyingTo.set(null);

    this.data.sendDirectMessage(user, content, replyTo).subscribe({
      // Then the recognizer reads it (where both have turned on AI suggestions); what it finds comes into
      // the chat as cards. Nothing to wait for or to report: the message is sent either way.
      next: () => this.commitmentService.recognize(user).subscribe({ error: () => undefined }),
      error: () => {
        messageInput.value = content;
        this.syncDraft(messageInput);
        this.replyingTo.set(answered);
      },
    });
  }

  /** Blanks never stay at the start of the text, so a field holding only spaces counts as empty. */
  onInput(messageInput: HTMLInputElement, event: Event): void {
    // Changing the value mid-composition (accents, IME) would break it; the next keystroke catches up
    if (!(event as InputEvent).isComposing) stripLeadingBlanks(messageInput);
    this.syncDraft(messageInput);
  }

  private syncDraft(messageInput: HTMLInputElement): void {
    this.hasText.set(messageInput.value !== '');
    this.fitInput(messageInput);
  }

  /** Measures the typed text, so the input grows with it instead of scrolling it. */
  private fitInput(messageInput: HTMLInputElement): void {
    if (!messageInput.value) {
      this.textWidth.set(0);
      return;
    }
    this.textCanvas ??= document.createElement('canvas').getContext('2d');
    if (!this.textCanvas) return;

    const style = getComputedStyle(messageInput);
    this.textCanvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    
    const needed = this.textCanvas.measureText(messageInput.value).width + padding + 7;
    // The pill stops at 90% of the chat anyway; a much larger width would only make it shrink late after sending
    const chatWidth = messageInput.closest('.chat-input-container')?.clientWidth ?? Infinity;
    this.textWidth.set(Math.ceil(Math.min(needed, chatWidth)));
  }
}
