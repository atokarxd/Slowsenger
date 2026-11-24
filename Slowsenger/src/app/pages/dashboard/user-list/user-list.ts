import { Component, DestroyRef, ElementRef, EventEmitter, HostListener, Output, ViewChild, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, forkJoin, map, Observable } from 'rxjs';
import { NicknameService } from '../../../core/nicknames/nickname.service';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { ToastService } from '../../../core/toast/toast.service';
import { AppUserSummary, UnifiedMessageRow, UserLabelRow } from '../../../core/supabase/supabase.types';
import { DEFAULT_AVATAR } from '../../../core/default-avatar';
import { Taskbar } from '../taskbar/taskbar';
import { TaskbarNav } from '../../../shared/taskbar-nav/taskbar-nav';
import { ProgressiveBlur } from '../../../shared/progressive-blur/progressive-blur';
import { GroupAvatar, memberNames } from '../../../shared/group-avatar/group-avatar';

interface ChatListItem {
  id: string | number;
  name: string;
  avatar: string;
  username?: string;
  targetUserId?: string;
  unread?: boolean;
  lastMessageAt?: string | null;
  /** Set: a group conversation, with the others in it. */
  members?: AppUserSummary[];
}

/** How long the list waits after a message comes in before it reloads (a burst comes as one). */
const REFRESH_DELAY_MS = 400;

@Component({
  selector: 'app-user-list',
  imports: [CommonModule, FormsModule, Taskbar, TaskbarNav, ProgressiveBlur, GroupAvatar],
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
})
export class UserList {
  private readonly data = inject(SlowsengerDataService);
  private readonly toast = inject(ToastService);
  private readonly nicknames = inject(NicknameService);
  private readonly supabase = inject(SupabaseService);
  private readonly destroyRef = inject(DestroyRef);

  /** The thread of the conversation open beside the list: what comes into it is read at once. */
  private openThreadId: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  isLoading = signal(false);
  isSearchActive: boolean = false;

  readonly isNewMessageOpen = signal(false);
  readonly memberNames = memberNames;
  readonly isSending = signal(false);
  readonly newChatError = signal('');
  /** Who the new message goes to: one person is a chat, two or more start a group with its first message. */
  readonly recipients = signal<AppUserSummary[]>([]);
  readonly lookingUp = signal(false);
  /** Usernames are looked up one after the other, so a blur and a click on send cannot add one twice. */
  private lookup: Promise<boolean> = Promise.resolve(true);
  @ViewChild('newUsernameInput') private newUsernameInput?: ElementRef<HTMLInputElement>;

  readonly searchTerm = signal('');
  private readonly _chatUsers = signal<ChatListItem[]>([]);
  private storedPinnedIds: (string | number)[] = [];

  readonly pinnedUsers = signal<ChatListItem[]>([]);

  // ─── Label system ───────────────────────────────────────────────────────────
  readonly customLabels = signal<UserLabelRow[]>([]);
  // single label per thread: threadId → labelId
  readonly userLabels = signal<Record<string, string>>({});
  readonly activeLabel = signal<string>('inbox');
  readonly unreadCount = computed(() => this._chatUsers().filter(u => u.unread).length);
  readonly isLabelDropdownOpen = signal(false);
  readonly activeLabelName = computed(() => {
    const id = this.activeLabel();
    if (id === 'inbox') return 'Inbox';
    if (id === 'read') return 'Unread';
    return this.customLabels().find(l => l.id === id)?.name ?? 'Inbox';
  });

  // Label card state
  readonly labelCardUser = signal<ChatListItem | null>(null);
  readonly selectedLabelIdInCard = signal<string | null>(null);
  readonly showNewLabelInput = signal(false);
  newLabelNameValue: string = '';

  // ─── Unread tracking ────────────────────────────────────────────────────────
  private lastReadTimes: Record<string, string> = {};

  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const pinnedIds = new Set(this.pinnedUsers().map(p => p.id));
    const label = this.activeLabel();
    const labelMap = this.userLabels();

    let all = this._chatUsers().filter(u => !pinnedIds.has(u.id));

    if (label === 'read') {
      all = all.filter(u => u.unread);
    } else if (label !== 'inbox') {
      all = all.filter(u => labelMap[String(u.id)] === label);
    }

    if (!term) return all;
    return all.filter(u =>
      this.displayName(u).toLowerCase().includes(term) ||
      u.name.toLowerCase().includes(term) ||
      (u.username ?? '').toLowerCase().includes(term)
    );
  });

  /** The name a chat goes by in the list: a person's nickname in the conversation, if they have one. */
  displayName(user: ChatListItem): string {
    if (user.members || !user.targetUserId) return user.name;
    return this.nicknames.of({ id: user.targetUserId }, user.targetUserId) ?? user.name;
  }

  /** Who else is in a group, by their nickname there or first name (as in the chat's header). */
  groupMembers(user: ChatListItem): string {
    const group = { id: user.targetUserId ?? String(user.id), members: user.members };
    return (user.members ?? []).map((m) => this.nicknames.of(group, m.id) ?? m.name.split(' ')[0]).join(', ');
  }

  confirmDeleteId = signal<string | number | null>(null);

  @ViewChild('searchBox') searchBox!: ElementRef;
  @ViewChild('labelSelectRef') labelSelectRef!: ElementRef;
  @Output() chatSelected = new EventEmitter<AppUserSummary>();
  /**
   * Right before chatSelected: when the conversation was last read before this opening (null: never). Opening
   * marks it read, so only now can the chat be told what is unread in it (for the AI summary).
   */
  @Output() readSince = new EventEmitter<string | null>();
  @Output() settingsClicked = new EventEmitter<void>();

  // ─── Swipe state ────────────────────────────────────────────────────────────
  readonly activeSwipedId = signal<string | number | null>(null);
  readonly activeRightSwipedId = signal<string | number | null>(null);
  readonly swipingId = signal<string | number | null>(null);
  readonly currentSwipeX = signal(0);
  private startX = 0;
  private startY = 0;
  private hasDragged = false;
  private wasSwipeOpenOnStart = false;
  private isVerticalScroll = false;

  constructor() {
    try {
      const stored = localStorage.getItem('pinnedUsers');
      if (stored) this.storedPinnedIds = JSON.parse(stored);
    } catch (_) {}
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
    });
    this.loadAllData();
    void this.listenForMessages();
  }

  // ─── Live updates ───────────────────────────────────────────────────────────

  /**
   * Every new message in the signed-in user's conversations (the database sends only those): the list
   * reloads quietly, so a conversation written in moves up and shows unread, and a new one (a group someone
   * started, say) appears. Only with a session: the list is never shown without one.
   */
  private async listenForMessages(): Promise<void> {
    const { data } = await this.supabase.getSession();
    if (!data.session || this.destroyed) return;
    const client = this.supabase.client;
    const channel = client
      .channel('user-list:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'unified_messages' }, (payload: { new: unknown }) => {
        const message = payload.new as UnifiedMessageRow;
        if (message.thread_id === this.openThreadId) this.markAsRead(message.thread_id);
        this.scheduleRefresh();
      })
      .subscribe();
    this.destroyRef.onDestroy(() => client.removeChannel(channel));
  }

  /** One quiet reload for a burst of messages (a group message, a scheduled batch). */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.destroyed) this.loadAllData(true);
    }, REFRESH_DELAY_MS);
  }

  // ─── Label helpers ──────────────────────────────────────────────────────────

  getLabelNameForThread(threadId: string | number): string | null {
    const labelId = this.userLabels()[String(threadId)];
    if (!labelId) return null;
    return this.customLabels().find(l => l.id === labelId)?.name ?? null;
  }

  // ─── Swipe ──────────────────────────────────────────────────────────────────

  getItemTransform(id: string | number): string {
    if (this.activeSwipedId() === id) return 'translateX(-120px)';
    if (this.activeRightSwipedId() === id) return 'translateX(80px)';
    if (this.swipingId() === id) return `translateX(${this.currentSwipeX()}px)`;
    return 'translateX(0)';
  }

  getItemTransition(id: string | number): string {
    return this.swipingId() === id ? 'none' : 'transform 0.25s ease';
  }

  onSwipeStart(event: TouchEvent | MouseEvent, id: string | number) {
    this.hasDragged = false;
    this.isVerticalScroll = false;
    this.wasSwipeOpenOnStart = this.activeSwipedId() === id || this.activeRightSwipedId() === id;

    const hasOtherOpen =
      (this.activeSwipedId() !== null && this.activeSwipedId() !== id) ||
      (this.activeRightSwipedId() !== null && this.activeRightSwipedId() !== id);

    if (hasOtherOpen) {
      this.activeSwipedId.set(null);
      this.activeRightSwipedId.set(null);
      this.wasSwipeOpenOnStart = true;
      return;
    }

    if ('touches' in event) {
      this.startX = event.touches[0].clientX;
      this.startY = event.touches[0].clientY;
    } else {
      this.startX = event.clientX;
      this.startY = event.clientY;
    }

    this.swipingId.set(id);
    this.currentSwipeX.set(0);
  }

  onSwipeMove(event: TouchEvent | MouseEvent) {
    if (!this.startX || this.swipingId() == null) return;

    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const deltaX = clientX - this.startX;
    const deltaY = clientY - this.startY;

    if (!this.hasDragged && !this.isVerticalScroll) {
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
        this.isVerticalScroll = true;
        this.swipingId.set(null);
        return;
      }
    }

    if (this.isVerticalScroll) return;
    if (Math.abs(deltaX) > 5) this.hasDragged = true;

    if (deltaX < 0) {
      this.currentSwipeX.set(Math.max(deltaX, -120));
    } else {
      this.currentSwipeX.set(Math.min(deltaX, 80));
    }
  }

  onSwipeEnd(id: string | number) {
    if (this.swipingId() !== id) return;

    const x = this.currentSwipeX();
    if (x < -50) {
      this.activeSwipedId.set(id);
      this.activeRightSwipedId.set(null);
    } else if (x > 40) {
      this.activeRightSwipedId.set(id);
      this.activeSwipedId.set(null);
    } else {
      this.activeSwipedId.set(null);
      this.activeRightSwipedId.set(null);
    }

    this.swipingId.set(null);
    this.startX = 0;
    this.startY = 0;
    this.currentSwipeX.set(0);
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent) {
    if (this.swipingId() != null) this.onSwipeMove(event);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp() {
    const id = this.swipingId();
    if (id != null) this.onSwipeEnd(id);
  }

  onItemRowClick(user: ChatListItem) {
    if (this.hasDragged || this.wasSwipeOpenOnStart) {
      this.hasDragged = false;
      this.wasSwipeOpenOnStart = false;
      return;
    }
    this.selectChat(user);
  }

  // ─── Label system ───────────────────────────────────────────────────────────

  toggleLabelDropdown() {
    this.isLabelDropdownOpen.update(v => !v);
  }

  selectLabelAndClose(id: string) {
    this.activeLabel.set(id);
    this.isLabelDropdownOpen.set(false);
  }

  setActiveLabel(id: string) {
    this.activeLabel.set(id);
  }

  openLabelCard(event: Event, user: ChatListItem) {
    event.stopPropagation();
    this.activeSwipedId.set(null);
    this.activeRightSwipedId.set(null);
    this.labelCardUser.set(user);
    // Pre-select current label
    const currentLabelId = this.userLabels()[String(user.id)] ?? null;
    this.selectedLabelIdInCard.set(currentLabelId);
    this.showNewLabelInput.set(false);
    this.newLabelNameValue = '';
  }

  closeLabelCard() {
    this.labelCardUser.set(null);
    this.showNewLabelInput.set(false);
    this.selectedLabelIdInCard.set(null);
    this.newLabelNameValue = '';
  }

  selectLabelInCard(labelId: string) {
    if (labelId === 'new') {
      this.selectedLabelIdInCard.set('new');
      this.showNewLabelInput.set(true);
    } else {
      // Toggle: clicking already selected label deselects it
      if (this.selectedLabelIdInCard() === labelId) {
        this.selectedLabelIdInCard.set(null);
      } else {
        this.selectedLabelIdInCard.set(labelId);
      }
      this.showNewLabelInput.set(false);
    }
  }

  confirmLabelAssignment() {
    const user = this.labelCardUser();
    if (!user) return;

    const threadId = String(user.id);
    const selectedId = this.selectedLabelIdInCard();

    if (selectedId === 'new') {
      const name = this.newLabelNameValue.trim();
      if (!name) return;

      this.data.createLabel(name).subscribe({
        next: (newLabel) => {
          this.customLabels.update(labels => [...labels, newLabel]);
          this.data.assignLabelToThread(threadId, newLabel.id).subscribe({
            next: () => {
              this.userLabels.update(map => ({ ...map, [threadId]: newLabel.id }));
              this.closeLabelCard();
              this.toast.show('Label created and assigned!', 'success');
            },
            error: () => this.toast.show('Error assigning label.', 'error'),
          });
        },
        error: () => this.toast.show('Error creating label.', 'error'),
      });
    } else if (selectedId) {
      this.data.assignLabelToThread(threadId, selectedId).subscribe({
        next: () => {
          this.userLabels.update(map => ({ ...map, [threadId]: selectedId }));
          this.closeLabelCard();
          this.toast.show('Label assigned!', 'success');
        },
        error: () => this.toast.show('Error assigning label.', 'error'),
      });
    }
  }

  removeUserFromCurrentLabel() {
    const user = this.labelCardUser();
    if (!user) return;

    const threadId = String(user.id);
    this.data.removeLabelFromThread(threadId).subscribe({
      next: () => {
        this.userLabels.update(map => {
          const next = { ...map };
          delete next[threadId];
          return next;
        });
        this.closeLabelCard();
        this.toast.show('Label removed.', 'success');
      },
      error: () => this.toast.show('Error removing label.', 'error'),
    });
  }

  deleteLabelItem(event: Event, label: UserLabelRow) {
    event.stopPropagation();
    this.data.deleteLabel(label.id).subscribe({
      next: () => {
        this.customLabels.update(labels => labels.filter(l => l.id !== label.id));
        this.userLabels.update(map => {
          const next = { ...map };
          for (const key of Object.keys(next)) {
            if (next[key] === label.id) delete next[key];
          }
          return next;
        });
        if (this.activeLabel() === label.id) this.activeLabel.set('inbox');
        this.toast.show(`"${label.name}" deleted.`, 'success');
      },
      error: () => this.toast.show('Error deleting label.', 'error'),
    });
  }

  // ─── Unread tracking ────────────────────────────────────────────────────────

  private markAsRead(threadId: string | number) {
    const id = String(threadId);
    this.lastReadTimes[id] = new Date().toISOString();
    this._chatUsers.update(users =>
      users.map(u => u.id === threadId ? { ...u, unread: false } : u)
    );
    this.pinnedUsers.update(users =>
      users.map(u => u.id === threadId ? { ...u, unread: false } : u)
    );
    this.data.markThreadRead(id).subscribe();
  }

  private isThreadUnread(thread: { id: string; last_message_at: string | null }): boolean {
    if (!thread.last_message_at || thread.id === this.openThreadId) return false;
    const lastRead = this.lastReadTimes[thread.id];
    if (!lastRead) return true;
    return new Date(thread.last_message_at) > new Date(lastRead);
  }

  // ─── Core actions ────────────────────────────────────────────────────────────

  togglePin(event: Event, user: ChatListItem) {
    event.stopPropagation();
    const isPinned = this.pinnedUsers().some(p => p.id === user.id);
    if (isPinned) {
      this.pinnedUsers.update(list => list.filter(p => p.id !== user.id));
    } else {
      this.pinnedUsers.update(list => [...list, user]);
    }
    this.activeSwipedId.set(null);
    // Keep the cached ids in sync so a later loadAllData() doesn't restore stale pins.
    this.storedPinnedIds = this.pinnedUsers().map(p => p.id);
    localStorage.setItem('pinnedUsers', JSON.stringify(this.storedPinnedIds));
  }

  openSearch(event: Event) {
    this.isSearchActive = true;
    event.stopPropagation();
  }

  onSearchInput(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  /** Opens the new message, already addressed to these people (the profile card's "+": a group with them). */
  openNewMessageModal(people: AppUserSummary[] = []) {
    this.recipients.set(people.filter((p, i) => people.findIndex((q) => q.id === p.id) === i));
    this.isNewMessageOpen.set(true);
    this.newChatError.set('');
    setTimeout(() => this.newUsernameInput?.nativeElement.focus());
  }

  closeNewMessageModal() {
    this.isNewMessageOpen.set(false);
  }

  /** Enter or a comma adds the username typed; Backspace in the empty field takes the last person off. */
  onToKeydown(event: KeyboardEvent, input: HTMLInputElement) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      void this.addRecipient(input);
    } else if (event.key === 'Backspace' && !input.value && this.recipients().length > 0) {
      this.recipients.update((list) => list.slice(0, -1));
    }
  }

  removeRecipient(person: AppUserSummary) {
    this.recipients.update((list) => list.filter((p) => p.id !== person.id));
    this.newUsernameInput?.nativeElement.focus();
  }

  /** Adds the username in the field to the recipients; false if it cannot be (the error says why). */
  addRecipient(input: HTMLInputElement): Promise<boolean> {
    this.lookup = this.lookup.then(() => this.resolveRecipient(input));
    return this.lookup;
  }

  private async resolveRecipient(input: HTMLInputElement): Promise<boolean> {
    const username = input.value.trim().replace(/^@/, '');
    if (!username) return true;
    this.lookingUp.set(true);
    try {
      const person = await firstValueFrom(this.data.findProfileByUsername(username));
      if (!person) {
        this.newChatError.set('Username not found!');
        return false;
      }
      if (person.id === this.nicknames.myId()) {
        this.newChatError.set('That is you: add someone else.');
        return false;
      }
      if (!this.recipients().some((p) => p.id === person.id)) {
        this.recipients.update((list) => [...list, person]);
      }
      input.value = '';
      this.newChatError.set('');
      return true;
    } catch {
      this.newChatError.set('Error looking up user.');
      return false;
    } finally {
      this.lookingUp.set(false);
    }
  }

  /**
   * One person: the message starts (or continues) the chat with them. Two or more: the message starts the
   * group, which only comes about, and shows up for the others, with it.
   */
  async startNewChat(toInput: HTMLInputElement, content: string) {
    if (this.isSending()) return;
    // A username still in the field counts too
    if (!(await this.addRecipient(toInput))) return;
    const people = this.recipients();
    if (people.length === 0 || !content.trim()) {
      this.newChatError.set('Please enter both a username and a message!');
      return;
    }

    this.isSending.set(true);
    this.newChatError.set('');
    const isGroup = people.length > 1;
    const sent: Observable<AppUserSummary> = isGroup
      ? this.data.createGroup(people, content)
      : this.data.sendDirectMessage(people[0], content).pipe(map(() => people[0]));

    sent.subscribe({
      next: (conversation) => {
        this.closeNewMessageModal();
        this.isSending.set(false);
        this.loadAllData();
        this.readSince.emit(new Date().toISOString()); // just written in: nothing in it is unread
        this.chatSelected.emit(conversation);
        this.toast.show(isGroup ? 'Group created!' : 'Message sent!', 'success');
      },
      error: (error: Error) => {
        this.newChatError.set(isGroup ? error.message || 'Could not create the group.' : 'Error sending message.');
        this.isSending.set(false);
      },
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.isSearchActive && this.searchBox) {
      const clickedInside = this.searchBox.nativeElement.contains(event.target);
      if (!clickedInside) this.isSearchActive = false;
    }
    if (this.isLabelDropdownOpen() && this.labelSelectRef) {
      const clickedInside = this.labelSelectRef.nativeElement.contains(event.target);
      if (!clickedInside) this.isLabelDropdownOpen.set(false);
    }
  }

  selectChat(user: ChatListItem) {
    this.openThreadId = String(user.id);
    this.readSince.emit(this.lastReadTimes[String(user.id)] ?? null);
    this.markAsRead(user.id);
    this.chatSelected.emit({
      id: user.targetUserId ?? String(user.id),
      name: user.name,
      username: user.username ?? '',
      avatarUrl: user.avatar,
      ...(user.members ? { members: user.members } : {}),
    });
  }

  requestDelete(event: Event, userId: string | number) {
    event.stopPropagation();
    this.activeSwipedId.set(null);
    this.confirmDeleteId.set(userId);
  }

  cancelDelete() {
    this.confirmDeleteId.set(null);
  }

  confirmDelete() {
    const id = this.confirmDeleteId();
    if (id == null) return;

    this.data.deleteThread(String(id)).subscribe({
      next: () => {
        this._chatUsers.update(users => users.filter(u => u.id !== id));
        this.pinnedUsers.update(users => users.filter(u => u.id !== id));
        this.confirmDeleteId.set(null);
        this.toast.show('Conversation deleted.', 'success');
      },
      error: () => {
        this.confirmDeleteId.set(null);
        this.toast.show('Error deleting conversation.', 'error');
      },
    });
  }

  openSettings() {
    this.settingsClicked.emit();
  }

  // ─── Data loading ────────────────────────────────────────────────────────────

  /** quiet: a reload in the background (a message came in), without the loading skeleton. */
  loadAllData(quiet = false) {
    if (!quiet) this.isLoading.set(true);
    this.nicknames.load();

    forkJoin({
      threads: this.data.getUnifiedThreads(),
      profiles: this.data.listProfiles(),
      labels: this.data.getLabels(),
      threadLabels: this.data.getThreadLabels(),
      readTimes: this.data.getThreadReadTimes(),
      groups: this.data.getGroups(),
    }).subscribe({
      next: ({ threads, profiles, labels, threadLabels, readTimes, groups }) => {
        this.customLabels.set(labels);
        this.userLabels.set(threadLabels);
        this.lastReadTimes = readTimes;

        const profileMap = new Map(profiles.map(p => [p.id, p]));
        const groupMap = new Map(groups.map(g => [g.id, g]));

        const users: ChatListItem[] = threads.map(thread => {
          // Group threads are keyed as "group:<group id>"
          const group = groupMap.get(thread.external_thread_id.replace(/^group:/, ''));
          if (thread.external_thread_id.startsWith('group:') && group) {
            return {
              id: thread.id,
              name: group.name,
              avatar: group.avatarUrl,
              targetUserId: group.id,
              members: group.members,
              unread: this.isThreadUnread(thread),
              lastMessageAt: thread.last_message_at,
            };
          }
          // Direct threads are keyed as "user:<other user's id>"
          const targetUserId = thread.external_thread_id.replace(/^user:/, '');
          const profile = profileMap.get(targetUserId);
          return {
            id: thread.id,
            name: thread.title ?? profile?.name ?? 'Unknown user',
            avatar: profile?.avatarUrl ?? DEFAULT_AVATAR,
            username: profile?.username ?? '',
            targetUserId,
            unread: this.isThreadUnread(thread),
            lastMessageAt: thread.last_message_at,
          };
        });

        this._chatUsers.set(users);
        this.pinnedUsers.set(users.filter(u => this.storedPinnedIds.includes(u.id)));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this._chatUsers.set([]);
      },
    });
  }
}
