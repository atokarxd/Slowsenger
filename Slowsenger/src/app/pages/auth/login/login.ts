import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  isPasswordHidden: boolean = true;
  isSubmitting = false;
  loginError = '';

  constructor(private router: Router, private data: SlowsengerDataService) { }

  togglePassword(): void {
    this.isPasswordHidden = !this.isPasswordHidden;
  }

  onSubmit(event: Event): void {
    event.preventDefault();

    const form = event.target as HTMLFormElement;
    const usernameInput = form.querySelector<HTMLInputElement>('input[name="username"]');
    const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]');

    const username = usernameInput?.value?.trim() ?? '';
    const password = passwordInput?.value ?? '';

    if (!username || !password) {
      this.loginError = 'Add meg a felhasznalonevet vagy email cimet, es a jelszot.';
      return;
    }

    this.loginError = '';
    this.isSubmitting = true;

    this.data.signInWithUsernameOrEmail(username, password)
      .pipe(switchMap(() => this.data.hasValidProfile()))
      .subscribe({
        next: (hasValidProfile) => {
          if (!hasValidProfile) {
            this.loginError = 'Sikeres belepes, de nincs ervenyes profil. Lepj be emaillel, vagy regisztralj ujra.';
            this.isSubmitting = false;
            return;
          }

          this.router.navigate(['/dashboard']);
        },
        error: (error: unknown) => {
          const errorObject = (typeof error === 'object' && error !== null)
            ? error as Record<string, unknown>
            : {};

          const rawMessage = String(
            errorObject['message']
            ?? errorObject['error_description']
            ?? errorObject['details']
            ?? ''
          );

          const messageLower = rawMessage.toLowerCase();
          if (messageLower.includes('invalid login credentials')) {
            this.loginError = 'Hibas felhasznalonev/email vagy jelszo.';
          } else if (messageLower.includes('email not confirmed')) {
            this.loginError = 'Az email cim meg nincs megerositve. Nezd meg a postaladat, vagy kapcsold ki email confirmation-t fejleszteshez a Supabase Auth beallitasoknal.';
          } else if (messageLower.includes('bejelentkezeshez email cimet')) {
            this.loginError = rawMessage;
          } else {
            this.loginError = rawMessage || 'Sikertelen bejelentkezes.';
          }

          this.isSubmitting = false;
        },
        complete: () => {
          this.isSubmitting = false;
        },
      });
  }
}
