import { Component, ElementRef, EventEmitter, HostListener, Output, ViewChild, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ToastService } from '../../../core/toast/toast.service';
import { AppUserSummary, ExternalPlatform, UserLabelRow } from '../../../core/supabase/supabase.types';
import { DEFAULT_AVATAR } from '../../../core/default-avatar';

interface ChatListItem {
  id: string | number;
  name: string;
  avatar: string;
  username?: string;
  platform?: ExternalPlatform | 'slowsenger';
  targetUserId?: string;
  externalThreadId?: string;
  unread?: boolean;
  lastMessageAt?: string | null;
}

@Component({
  selector: 'app-user-list',
  imports: [CommonModule, FormsModule],
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
})
export class UserList {
  private readonly data = inject(SlowsengerDataService);
  private readonly toast = inject(ToastService);

  isLoading = signal(false);
  isSearchActive: boolean = false;

  isNewMessageOpen: boolean = false;
  isSending: boolean = false;
  newChatError: string = '';

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
    if (id === 'read') return 'Olvasatlan';
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
      u.name.toLowerCase().includes(term) ||
      (u.username ?? '').toLowerCase().includes(term)
    );
  });

  confirmDeleteId = signal<string | number | null>(null);

  @ViewChild('searchBox') searchBox!: ElementRef;
  @ViewChild('labelSelectRef') labelSelectRef!: ElementRef;
  @Output() chatSelected = new EventEmitter<AppUserSummary>();
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
    this.syncAndLoad();
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
              this.toast.show('Label létrehozva és hozzáadva!', 'success');
            },
            error: () => this.toast.show('Hiba a hozzárendelésnél.', 'error'),
          });
        },
        error: () => this.toast.show('Hiba a label létrehozásakor.', 'error'),
      });
    } else if (selectedId) {
      this.data.assignLabelToThread(threadId, selectedId).subscribe({
        next: () => {
          this.userLabels.update(map => ({ ...map, [threadId]: selectedId }));
          this.closeLabelCard();
          this.toast.show('Label beállítva!', 'success');
        },
        error: () => this.toast.show('Hiba a hozzárendelésnél.', 'error'),
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
        this.toast.show('Label eltávolítva.', 'success');
      },
      error: () => this.toast.show('Hiba az eltávolításnál.', 'error'),
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
        this.toast.show(`"${label.name}" törölve.`, 'success');
      },
      error: () => this.toast.show('Hiba a törlés során.', 'error'),
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
    if (!thread.last_message_at) return false;
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
    localStorage.setItem('pinnedUsers', JSON.stringify(this.pinnedUsers().map(p => p.id)));
  }

  openSearch(event: Event) {
    this.isSearchActive = true;
    event.stopPropagation();
  }

  onSearchInput(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  openNewMessageModal() {
    this.isNewMessageOpen = true;
    this.newChatError = '';
  }

  closeNewMessageModal() {
    this.isNewMessageOpen = false;
  }

  startNewChat(username: string, content: string) {
    if (!username.trim() || !content.trim()) {
      this.newChatError = 'Add meg a felhasználónevet és az üzenetet is!';
      return;
    }

    this.isSending = true;
    this.newChatError = '';
    const cleanUsername = username.trim().toLowerCase();

    this.data.listProfiles().subscribe({
      next: (profiles) => {
        const targetProfile = profiles.find(p => p.username?.toLowerCase() === cleanUsername);

        if (!targetProfile) {
          this.newChatError = 'Nem található ilyen felhasználónév!';
          this.isSending = false;
          return;
        }

        const targetAppUser: AppUserSummary = {
          id: String(targetProfile.id),
          name: targetProfile.name || targetProfile.username || 'Ismeretlen',
          username: targetProfile.username,
          avatarUrl: targetProfile.avatarUrl || DEFAULT_AVATAR,
        };

        this.data.sendDirectMessage(targetAppUser, content).subscribe({
          next: () => {
            this.closeNewMessageModal();
            this.isSending = false;
            this.loadAllData();
            this.chatSelected.emit(targetAppUser);
            this.toast.show('Üzenet elküldve!', 'success');
          },
          error: () => {
            this.newChatError = 'Hiba történt az üzenet küldésekor.';
            this.isSending = false;
          },
        });
      },
      error: () => {
        this.newChatError = 'Hiba történt a felhasználó keresésekor.';
        this.isSending = false;
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
    this.markAsRead(user.id);
    this.chatSelected.emit({
      id: user.targetUserId ?? String(user.id),
      name: user.name,
      username: user.username ?? '',
      avatarUrl: user.avatar,
      platform: user.platform,
      externalThreadId: user.externalThreadId,
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
        this.toast.show('Beszélgetés törölve.', 'success');
      },
      error: () => {
        this.confirmDeleteId.set(null);
        this.toast.show('Hiba történt a törlés során.', 'error');
      },
    });
  }

  openSettings() {
    this.settingsClicked.emit();
  }

  // ─── Data loading ────────────────────────────────────────────────────────────

  private syncAndLoad() {
    this.data.syncMessengerConversations().subscribe({
      next: () => this.loadAllData(),
      error: () => this.loadAllData(),
    });
  }

  loadAllData() {
    this.isLoading.set(true);

    forkJoin({
      threads: this.data.getUnifiedThreads(),
      profiles: this.data.listProfiles(),
      labels: this.data.getLabels(),
      threadLabels: this.data.getThreadLabels(),
      readTimes: this.data.getThreadReadTimes(),
    }).subscribe({
      next: ({ threads, profiles, labels, threadLabels, readTimes }) => {
        this.customLabels.set(labels);
        this.userLabels.set(threadLabels);
        this.lastReadTimes = readTimes;

        const profileMap = new Map(profiles.map(p => [p.id, p]));

        const users = threads.map(thread => {
          const isInternalChat = thread.external_thread_id.startsWith('user:');
          const unread = this.isThreadUnread(thread);

          if (isInternalChat) {
            const targetUserId = thread.external_thread_id.slice(5);
            const profile = profileMap.get(targetUserId);
            return {
              id: thread.id,
              name: thread.title ?? profile?.name ?? 'Ismeretlen felhasználó',
              avatar: profile?.avatarUrl ?? DEFAULT_AVATAR,
              username: profile?.username ?? '',
              platform: thread.platform || 'slowsenger',
              targetUserId,
              externalThreadId: undefined,
              unread,
              lastMessageAt: thread.last_message_at,
            };
          } else {
            const psid = thread.external_thread_id.split('|')[1] ?? thread.external_thread_id;
            return {
              id: thread.id,
              name: thread.title ?? (thread.platform === 'instagram' ? 'Instagram felhasználó' : 'Messenger felhasználó'),
              avatar: DEFAULT_AVATAR,
              username: psid,
              platform: thread.platform,
              targetUserId: psid,
              externalThreadId: thread.external_thread_id,
              unread,
              lastMessageAt: thread.last_message_at,
            };
          }
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
