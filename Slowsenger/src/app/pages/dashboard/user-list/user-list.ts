import { Component, ElementRef, EventEmitter, HostListener, Output, ViewChild, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ToastService } from '../../../core/toast/toast.service';
import { AppUserSummary, ExternalPlatform } from '../../../core/supabase/supabase.types';

const DEFAULT_AVATAR = `data:image/svg+xml,%3Csvg fill='%23202020' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='32' height='32' fill='%23ffffff'/%3E%3Cpath d='M16 15.503A5.041 5.041 0 1 0 16 5.42a5.041 5.041 0 0 0 0 10.083zm0 2.215c-6.703 0-11 3.699-11 5.5v3.363h22v-3.363c0-2.178-4.068-5.5-11-5.5z'/%3E%3C/svg%3E`;

interface ChatListItem {
  id: string | number;
  name: string;
  avatar: string;
  username?: string;
  platform?: ExternalPlatform | 'slowsenger';
  targetUserId?: string;
  externalThreadId?: string;
}

@Component({
  selector: 'app-user-list',
  imports: [CommonModule],
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
})
export class UserList {
  private readonly data = inject(SlowsengerDataService);
  private readonly toast = inject(ToastService);

  isLoading = signal(false);
  currentLabel: string = 'Inbox';
  isSearchActive: boolean = false;

  isNewMessageOpen: boolean = false;
  isSending: boolean = false;
  newChatError: string = '';

  readonly searchTerm = signal('');
  private readonly _chatUsers = signal<ChatListItem[]>([]);
  private storedPinnedIds: (string | number)[] = [];

  readonly pinnedUsers = signal<ChatListItem[]>([]);

  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const pinnedIds = new Set(this.pinnedUsers().map(p => p.id));
    const all = this._chatUsers().filter(u => !pinnedIds.has(u.id));
    if (!term) return all;
    return all.filter(u =>
      u.name.toLowerCase().includes(term) ||
      (u.username ?? '').toLowerCase().includes(term)
    );
  });

  confirmDeleteId = signal<string | number | null>(null);

  @ViewChild('searchBox') searchBox!: ElementRef;
  @Output() chatSelected = new EventEmitter<AppUserSummary>();
  @Output() settingsClicked = new EventEmitter<void>();

  // Swipe state
  readonly activeSwipedId = signal<string | number | null>(null);
  readonly swipingId = signal<string | number | null>(null);
  readonly currentSwipeX = signal(0);
  private startX = 0;
  private startY = 0;
  private hasDragged = false;
  private wasSwipeOpenOnStart = false;
  private isVerticalScroll = false;

  constructor() {
    this.syncAndLoad();
    try {
      const stored = localStorage.getItem('pinnedUsers');
      if (stored) this.storedPinnedIds = JSON.parse(stored);
    } catch (_) {}
  }

  getItemTransform(id: string | number): string {
    if (this.activeSwipedId() === id) return 'translateX(-120px)';
    if (this.swipingId() === id) return `translateX(${this.currentSwipeX()}px)`;
    return 'translateX(0)';
  }

  getItemTransition(id: string | number): string {
    return this.swipingId() === id ? 'none' : 'transform 0.25s ease';
  }

  onSwipeStart(event: TouchEvent | MouseEvent, id: string | number) {
    this.hasDragged = false;
    this.isVerticalScroll = false;
    this.wasSwipeOpenOnStart = this.activeSwipedId() === id;

    if (this.activeSwipedId() !== null && this.activeSwipedId() !== id) {
      this.activeSwipedId.set(null);
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

    // On first significant movement, decide direction
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
      this.currentSwipeX.set(0);
    }
  }

  onSwipeEnd(id: string | number) {
    if (this.swipingId() !== id) return;

    if (this.currentSwipeX() < -50) {
      this.activeSwipedId.set(id);
    } else {
      this.activeSwipedId.set(null);
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
            this.loadUnifiedThreads();
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
  }

  selectChat(user: ChatListItem) {
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

  private syncAndLoad() {
    this.data.syncMessengerConversations().subscribe({
      next: () => this.loadUnifiedThreads(),
      error: () => this.loadUnifiedThreads(),
    });
  }

  private loadUnifiedThreads() {
    this.isLoading.set(true);

    forkJoin({
      threads: this.data.getUnifiedThreads(),
      profiles: this.data.listProfiles(),
    }).subscribe({
      next: ({ threads, profiles }) => {
        const profileMap = new Map(profiles.map(p => [p.id, p]));

        const users = threads.map(thread => {
          const isInternalChat = thread.external_thread_id.startsWith('user:');

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
