import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chat } from './chat/chat';
import { UserList } from './user-list/user-list';
import { Profile } from './profile/profile';
import { AppUserSummary } from '../../core/supabase/supabase.types';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, Chat, UserList, Profile],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  activeMobileView: 'list' | 'chat' = 'list';
  isProfileOpen = false;
  selectedUser: AppUserSummary | null = null;
  /** When the opened conversation was last read before (from the list): the chat counts what is unread. */
  unreadSince: string | null = null;

  openChat(user: AppUserSummary) {
    this.selectedUser = user;
    this.activeMobileView = 'chat';
  }

  showList() {
    this.activeMobileView = 'list';
  }

  /** A group was left: its chat closes and it is gone from the list. */
  onConversationLeft(userList: UserList) {
    this.selectedUser = null;
    this.showList();
    userList.loadAllData();
  }

  /**
   * The profile card's "+": the new message, already to these people, over the chat. On a phone the chat
   * stays: closing the window leaves you where you were, and sending opens the new chat.
   */
  startGroup(userList: UserList, people: AppUserSummary[]) {
    userList.openNewMessageModal(people);
  }

  openProfile() {
    this.isProfileOpen = true;
  }

  closeProfile() {
    this.isProfileOpen = false;
  }
}