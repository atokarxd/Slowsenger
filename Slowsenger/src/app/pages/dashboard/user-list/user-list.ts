import { Component, ElementRef, EventEmitter, HostListener, Output, ViewChild, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ToastService } from '../../../core/toast/toast.service';
import { AppUserSummary, ExternalPlatform } from '../../../core/supabase/supabase.types';

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
  storedPinnedIds: (string|number)[] = [];
  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return this._chatUsers();
    return this._chatUsers().filter(u =>
      u.name.toLowerCase().includes(term) ||
      (u.username ?? '').toLowerCase().includes(term)
    );
  });

  confirmDeleteId = signal<string | number | null>(null);

  @ViewChild('searchBox') searchBox!: ElementRef;
  @Output() chatSelected = new EventEmitter<AppUserSummary>();
  @Output() settingsClicked = new EventEmitter<void>();

  pinnedUsers: ChatListItem[] = [];
  
  // Swipe logic properties
  activeSwipedId: string | number | null = null;
  private startX = 0;
  currentSwipeX = 0;
  swipingId: string | number | null = null;

  constructor() {
    this.syncAndLoad();
    try {
      const stored = localStorage.getItem('pinnedUsers');
      if (stored) {
         this.storedPinnedIds = JSON.parse(stored);
      }
    } catch(e) {}
  
  }

  // Swipe Handlers
  onTouchStart(event: TouchEvent | MouseEvent, id: string | number) {
    this.startX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    this.swipingId = id;
    this.currentSwipeX = 0;
  }

  onTouchMove(event: TouchEvent | MouseEvent) {
    if (!this.startX || this.swipingId == null) return;
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const deltaX = clientX - this.startX;
    
    // Only allow left swipe (negative delta) up to max -120px (for two buttons)
    if (deltaX < 0) {
      this.currentSwipeX = Math.max(deltaX, -120);
    } else {
      this.currentSwipeX = 0;
    }
  }

  onTouchEnd(id: string | number) {
    if (this.swipingId !== id) return;
    
    if (this.currentSwipeX < -50) {
      this.activeSwipedId = id;
    } else {
      this.activeSwipedId = null;
    }
    this.swipingId = null;
    this.startX = 0;
    this.currentSwipeX = 0;
  }

  closeSwipe() {
    this.activeSwipedId = null;
  }
  
  togglePin(event: Event, user: ChatListItem) {
    event.stopPropagation();
    const isPinned = this.pinnedUsers.some(p => p.id === user.id);
    if (isPinned) {
      this.pinnedUsers = this.pinnedUsers.filter(p => p.id !== user.id);
    } else {
      this.pinnedUsers.push(user);
    }
    this.activeSwipedId = null;
    // Save to local storage for persistence
    localStorage.setItem('pinnedUsers', JSON.stringify(this.pinnedUsers.map(p => p.id)));
  }

  toggleSearch() {
    this.isSearchActive = !this.isSearchActive;
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
          avatarUrl: targetProfile.avatarUrl || 'assets/user.jpg'
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
          }
        });
      },
      error: () => {
        this.newChatError = 'Hiba történt a felhasználó keresésekor.';
        this.isSending = false;
      }
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.isSearchActive && this.searchBox) {
      const clickedInside = this.searchBox.nativeElement.contains(event.target);
      if (!clickedInside) {
        this.isSearchActive = false;
      }
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
        const profileMap = new Map(profiles.map((p) => [p.id, p]));

        const users = threads.map((thread) => {
          const isInternalChat = thread.external_thread_id.startsWith('user:');

          if (isInternalChat) {
            const targetUserId = thread.external_thread_id.slice(5);
            const profile = profileMap.get(targetUserId);
            return {
              id: thread.id,
              name: thread.title ?? profile?.name ?? 'Ismeretlen felhasználó',
              avatar: profile?.avatarUrl ?? 'assets/user.jpg',
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
              avatar: 'assets/user.jpg',
              username: psid,
              platform: thread.platform,
              targetUserId: psid,
              externalThreadId: thread.external_thread_id,
            };
          }
        });

        this._chatUsers.set(users);
        this.pinnedUsers = users.filter(u => this.storedPinnedIds.includes(u.id));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this._chatUsers.set([]);
      },
    });
  }
}
