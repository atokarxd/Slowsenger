import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';

// --- JELSZÓ VALIDÁTOR ---
export const passwordMatchValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;

  if (password && confirmPassword && password !== confirmPassword) {
    return { passwordMismatch: true };
  }
  return null;
};

// --- ÚJ: SZÜLETÉSNAP VALIDÁTOR ---
export const birthdayValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const yearVal = control.get('year')?.value;
  const monthVal = control.get('month')?.value;
  const dayVal = control.get('day')?.value;

  // Ha még üresek a mezők, ne dobjon logikai hibát (arra ott a Validators.required)
  if (!yearVal || !monthVal || !dayVal) return null;

  const year = parseInt(yearVal, 10);
  const month = parseInt(monthVal, 10);
  const day = parseInt(dayVal, 10);

  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 100;

  const errors: any = {};

  // 1. Év ellenőrzése (pl. 1926 és 2026 között)
  if (year < minYear || year > currentYear) {
    errors.invalidYear = true;
  }
  // 2. Hónap ellenőrzése (1-12)
  if (month < 1 || month > 12) {
    errors.invalidMonth = true;
  }
  // 3. Nap ellenőrzése (1-31)
  if (day < 1 || day > 31) {
    errors.invalidDay = true;
  }

  // Bónusz: Valós dátum ellenőrzése (kiszűri pl. a február 30-at vagy 31-et)
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    errors.invalidDate = true;
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

@Component({
  selector: 'app-regist',
  imports: [CommonModule, ReactiveFormsModule],
  standalone: true,
  templateUrl: './regist.html',
  styleUrl: './regist.scss',
})
export class Regist implements OnInit {
  registForm!: FormGroup;
  currentStep: number = 1;
  totalSteps: number = 5;
  isPasswordHidden: boolean = true;
  isPasswordHidden2: boolean = true;
  isSubmitting: boolean = false;
  submitError: string = '';

  togglePassword(): void {
    this.isPasswordHidden = !this.isPasswordHidden;
  }
  togglePassword2(): void {
    this.isPasswordHidden2 = !this.isPasswordHidden2;
  }

  constructor(private fb: FormBuilder, private router: Router, private data: SlowsengerDataService) { }

  passwordStrength: number = 0;

  ngOnInit(): void {
    this.registForm = this.fb.group({
      personal: this.fb.group({
        firstName: ['', Validators.required],
        lastName: ['', Validators.required],
        username: ['', Validators.required]
      }),
      // --- ÚJ: VALIDÁTOR HOZZÁADÁSA A CSOPORTHOZ ---
      birthday: this.fb.group({
        year: ['', [Validators.required, Validators.pattern('^[0-9]{4}$')]],
        month: ['', [Validators.required, Validators.pattern('^[0-9]{1,2}$')]],
        day: ['', [Validators.required, Validators.pattern('^[0-9]{1,2}$')]]
      }, { validators: birthdayValidator }), // <-- Ide került be az új validátor

      contact: this.fb.group({
        phone: ['', [Validators.required, Validators.minLength(14), Validators.maxLength(14)]]
      }),
      account: this.fb.group({
        email: ['', [Validators.required, Validators.email]],
      }),
      security: this.fb.group({
        password: ['', [Validators.required, Validators.minLength(6)]],
        confirmPassword: ['', Validators.required]
      }, { validators: passwordMatchValidator })
    });

    this.registForm.get('security.password')?.valueChanges.subscribe(value => {
    this.calculatePasswordStrength(value || '');
  });
  }

  // ÚJ: Jelszó erősség számoló logika
calculatePasswordStrength(password: string): void {
  let strength = 0;
  if (!password) {
    this.passwordStrength = 0;
    return;
  }
  if (password.length >= 6) strength += 20; // Alap hossz
  if (password.length >= 8) strength += 20; // Kicsit hosszabb
  if (/[A-Z]/.test(password)) strength += 20; // Nagybetű
  if (/[0-9]/.test(password)) strength += 20; // Szám
  if (/[^A-Za-z0-9]/.test(password)) strength += 20; // Speciális karakter
  
  this.passwordStrength = Math.min(100, strength);
}

// ÚJ: Css osztály meghatározása az erősség alapján
getStrengthClass(): string {
  if (this.passwordStrength < 40) return 'weak';
  if (this.passwordStrength < 80) return 'medium';
  return 'strong';
}

  formatPhone(event: Event) {
    const input = event.target as HTMLInputElement;
    let trimmed = input.value.replace(/\D/g, '');

    if (trimmed.length > 11) {
      trimmed = trimmed.substring(0, 11);
    }

    let formatted = trimmed;

    if (trimmed.length > 2) {
      formatted = trimmed.substring(0, 2) + '-' + trimmed.substring(2);
    }
    if (trimmed.length > 4) {
      formatted = formatted.substring(0, 5) + '-' + trimmed.substring(4);
    }
    if (trimmed.length > 7) {
      formatted = formatted.substring(0, 9) + '-' + trimmed.substring(7);
    }

    input.value = formatted;
    this.registForm.get('contact.phone')?.setValue(formatted, { emitEvent: false });
  }

  nextStep() {
    if (this.currentStep < this.totalSteps) this.currentStep++;
  }

  prevStep() {
    if (this.currentStep > 1) this.currentStep--;
  }

  onSubmit() {
    if (!this.registForm.valid) {
      this.registForm.markAllAsTouched();
      return;
    }

    const personal = this.registForm.get('personal')?.value;
    const birthday = this.registForm.get('birthday')?.value;
    const contact = this.registForm.get('contact')?.value;
    const account = this.registForm.get('account')?.value;
    const security = this.registForm.get('security')?.value;

    const birthdayIso = `${birthday.year}-${String(birthday.month).padStart(2, '0')}-${String(birthday.day).padStart(2, '0')}`;

    this.submitError = '';
    this.isSubmitting = true;

    this.data.registerWithProfile({
      email: account.email.trim(),
      phone: contact.phone.trim(),
      username: personal.username.trim(),
      password: security.password.trim(),
      firstName: personal.firstName.trim(),
      lastName: personal.lastName.trim(),
      birthday: birthdayIso,
    }).subscribe({
      next: () => {
        this.router.navigate(['/auth/login']);
      },
      error: (error: unknown) => {
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status: unknown }).status)
          : 0;
        const rawMessage = typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';

        const isRateLimited = status === 429 || rawMessage.toLowerCase().includes('too many requests');
        const isUsernameTaken = rawMessage.toLowerCase().includes('felhasznalonev mar foglalt')
          || rawMessage.toLowerCase().includes('username') && rawMessage.toLowerCase().includes('already');
        const isEmailTaken = rawMessage.toLowerCase().includes('email cim mar regisztralva')
          || rawMessage.toLowerCase().includes('already registered');
        const message = isRateLimited
          ? 'Tul sok regisztracios probalkozas tortent rovid idon belul. Varj 1-2 percet, majd probald ujra.'
          : isUsernameTaken
            ? 'Ez a felhasznalonev mar foglalt. Adj meg masikat.'
            : isEmailTaken
              ? 'Ez az email cim mar regisztralva van.'
              : (rawMessage || 'Sikertelen regisztracio. Ellenorizd az adatokat.');

        this.submitError = message;
        this.isSubmitting = false;
      },
      complete: () => {
        this.isSubmitting = false;
      },
    });
  }

  isCurrentStepInvalid(): boolean {
    switch (this.currentStep) {
      case 1: return !this.registForm.get('personal')?.valid;
      case 2: return !this.registForm.get('birthday')?.valid;
      case 3: return !this.registForm.get('contact')?.valid;
      case 4: return !this.registForm.get('account')?.valid;
      case 5: return !this.registForm.valid;
      default: return true;
    }
  }
}