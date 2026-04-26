import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chat } from './chat/chat';
import { UserList } from './user-list/user-list';
import { AppList } from './app-list/app-list';
import { App } from '../../app';
import { Profile } from './profile/profile';
import { AppUserSummary } from '../../core/supabase/supabase.types';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, Chat, UserList, AppList, Profile],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  // Alapértelmezetten a listát mutatjuk mobilon
  activeMobileView: 'list' | 'chat' = 'list';
  isProfileOpen = false;
  selectedUser: AppUserSummary | null = null;

  openChat(user: AppUserSummary) {
    this.selectedUser = user;
    this.activeMobileView = 'chat';
  }

  showList() {
    this.activeMobileView = 'list';
  }

  openProfile() {
    this.isProfileOpen = true;
  }

  closeProfile() {
    this.isProfileOpen = false;
  }
}