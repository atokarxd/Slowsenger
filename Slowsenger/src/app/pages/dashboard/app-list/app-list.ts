import { Component, inject, OnInit, signal } from '@angular/core';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ExternalPlatform, LinkedAccountRow } from '../../../core/supabase/supabase.types';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-app-list',
  imports: [],
  templateUrl: './app-list.html',
  styleUrl: './app-list.scss',
})
export class AppList implements OnInit {
  private readonly data = inject(SlowsengerDataService);
  private readonly toast = inject(ToastService);

  readonly isAppListVisible = signal(true);
  readonly isAddCardVisible = signal(false);
  readonly connectedApps = signal<LinkedAccountRow[]>([]);
  readonly isConnecting = signal(false);

  ngOnInit() {
    this.loadLinkedAccounts();
  }

  loadLinkedAccounts() {
    this.data.getLinkedAccounts().subscribe({
      next: (accounts) => {
        this.connectedApps.set(accounts.filter(a => a.status === 'connected'));
      },
      error: () => this.toast.show('Failed to load connected accounts.', 'error')
    });
  }

  toggleAppList() {
    this.isAppListVisible.update(v => !v);
    if (!this.isAppListVisible()) {
       this.isAddCardVisible.set(false);
    }
  }

  toggleAddCard() {
    this.isAddCardVisible.update(v => !v);
  }

  connectPlatform(platform: ExternalPlatform) {
    if (this.isConnecting()) return;
    this.isConnecting.set(true);

    this.data.requestMetaConnection(platform).subscribe({
      next: (url) => {
         window.location.href = url;
      },
      error: () => {
         this.toast.show('Failed to connect.', 'error');
         this.isConnecting.set(false);
      },
      complete: () => {
         this.isConnecting.set(false);
      }
    });
  }

  disconnectAccount(accountId: string) {
    this.data.disconnectLinkedAccount(accountId).subscribe({
      next: () => {
         this.connectedApps.update(apps => apps.filter(a => a.id !== accountId));
         this.toast.show('Account disconnected.', 'success');
      },
      error: () => this.toast.show('Error disconnecting account.', 'error')
    });
  }
}
