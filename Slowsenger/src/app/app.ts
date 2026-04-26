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
  private cdr = inject(ChangeDetectorRef); // <-- 2. Injektáld a ChangeDetectorRef-et

  async ngOnInit() {
    console.log('1. Alkalmazás indul, Supabase inicializálása...');
    
    try {
      await this.supabase.getSession();
      console.log('2. Supabase munkamenet ellenőrizve!');
    } catch (error) {
      console.error('3. Hiba a Supabase kapcsolatban:', error);
    } finally {
      console.log('4. Loader kikapcsolása.');
      this.isAppLoading = false;
      
      // <-- 3. Szólunk az Angularnak, hogy rajzolja újra a képernyőt!
      this.cdr.detectChanges(); 
    }
  }
}