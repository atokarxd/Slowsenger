import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GlobalLoader } from './pages/global-loader/global-loader';
import { ToastComponent } from './core/toast/toast.component';
import { SupabaseService } from './core/supabase/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, GlobalLoader, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  isAppLoading = true;
  private supabase = inject(SupabaseService);
  private cdr = inject(ChangeDetectorRef);

  async ngOnInit() {
    try {
      await this.supabase.getSession();
    } catch (error) {
      console.error('Supabase session error:', error);
    } finally {
      this.isAppLoading = false;
      this.cdr.detectChanges();
    }
  }
}