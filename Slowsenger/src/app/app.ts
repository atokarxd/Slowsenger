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
    // DEBUG: 15 000 ms minimum – $scale: 3 a loader SCSS-ben. Visszaállítani: 0
    const MIN_LOADER_MS = 2000;
    const start = Date.now();
    try {
      await this.supabase.getSession();
    } catch (error) {
      console.error('Supabase session error:', error);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < MIN_LOADER_MS) {
        await new Promise(r => setTimeout(r, MIN_LOADER_MS - elapsed));
      }
      this.isAppLoading = false;
      this.cdr.detectChanges();
    }
  }
}