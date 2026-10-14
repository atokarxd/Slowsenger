import { Component, signal } from '@angular/core';
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
  readonly isSubmitting = signal(false);
  readonly loginError = signal('');

  constructor(private router: Router, private data: SlowsengerDataService) { }

  togglePassword(): void {
    this.isPasswordHidden = !this.isPasswordHidden;
  }

  onSubmit(event: Event): void {
    event.preventDefault();

    const form = event.target as HTMLFormElement;
    const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]');
    const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]');

    const email = emailInput?.value?.trim() ?? '';
    const password = passwordInput?.value ?? '';

    if (!email || !password) {
      this.loginError.set('Please enter your email and password.');
      return;
    }

    this.loginError.set('');
    this.isSubmitting.set(true);

    this.data.signIn(email, password)
      .pipe(switchMap(() => this.data.hasValidProfile()))
      .subscribe({
        next: (hasValidProfile) => {
          if (!hasValidProfile) {
            this.loginError.set('Login successful but no valid profile found. Please register again.');
            this.isSubmitting.set(false);
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
            this.loginError.set('Invalid email or password.');
          } else if (messageLower.includes('email not confirmed')) {
            this.loginError.set('Email not confirmed. Check your inbox, or disable email confirmation in Supabase Auth settings for development.');
          } else {
            this.loginError.set(rawMessage || 'Login failed.');
          }

          this.isSubmitting.set(false);
        },
        complete: () => {
          this.isSubmitting.set(false);
        },
      });
  }
}
