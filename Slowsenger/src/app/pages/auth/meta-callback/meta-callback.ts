import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ExternalPlatform } from '../../../core/supabase/supabase.types';

@Component({
  selector: 'app-meta-callback',
  template: `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;flex-direction:column;gap:16px">
      @if (error()) {
        <p style="color:#e74c3c">{{ error() }}</p>
        <a href="/dashboard">Vissza a dashboardra</a>
      } @else {
        <p>Kapcsolódás folyamatban...</p>
      }
    </div>
  `,
})
export class MetaCallback implements OnInit {
  private readonly data = inject(SlowsengerDataService);
  private readonly router = inject(Router);
  readonly error = signal('');

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error_description') ?? params.get('error');

    if (oauthError) {
      this.error.set(oauthError);
      return;
    }

    if (!code || !state) {
      this.error.set('Hiányzó OAuth paraméterek.');
      return;
    }

    let platform: ExternalPlatform = 'messenger';
    try {
      const parsed = JSON.parse(atob(state));
      platform = parsed.platform ?? 'messenger';
    } catch {}

    this.data.completeMetaConnection(platform, code).subscribe({
      next: () => this.router.navigateByUrl('/dashboard'),
      error: (err) => this.error.set(err?.message ?? 'Kapcsolódás sikertelen.'),
    });
  }
}
