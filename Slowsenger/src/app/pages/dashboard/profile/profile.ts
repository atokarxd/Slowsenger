import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ExternalPlatform, LinkedAccountRow } from '../../../core/supabase/supabase.types';

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(SlowsengerDataService);
  private readonly toast = inject(ToastService);
  readonly closeRequested = output<void>();

  readonly profileImage = signal('assets/user.jpg');
  readonly saveMessage = signal('');
  readonly connectionMessage = signal('');
  readonly linkedAccounts = signal<LinkedAccountRow[]>([]);
  readonly isConnecting = signal(false);
  readonly isSaving = signal(false);

  private pendingAvatarFile: File | null = null;

  readonly profileForm = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(40)]],
    lastName: ['', [Validators.required, Validators.maxLength(40)]],
    username: ['', [Validators.required, Validators.maxLength(40)]],
    password: [''],
    birthday: [''],
  });

  ngOnInit(): void {
    this.loadProfile();
    this.loadLinkedAccounts();
  }

  private loadProfile(): void {
    this.data.getProfile().subscribe({
      next: (profile) => {
        if (!profile) return;
        this.profileForm.patchValue({
          firstName: profile.first_name ?? '',
          lastName: profile.last_name ?? '',
          username: profile.username ?? '',
          birthday: profile.birthday ?? '',
        });
        if (profile.avatar_url) {
          this.profileImage.set(profile.avatar_url);
        }
      },
    });
  }

  onImageChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    this.pendingAvatarFile = file;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.profileImage.set(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  openImagePicker(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  saveProfile(): void {
    this.profileForm.markAllAsTouched();
    if (this.profileForm.invalid) {
      this.saveMessage.set('Töltsd ki az összes kötelező mezőt helyesen.');
      return;
    }

    const password = this.profileForm.value.password ?? '';
    if (password && password.length < 6) {
      this.saveMessage.set('A jelszónak legalább 6 karakter hosszúnak kell lennie.');
      return;
    }

    this.isSaving.set(true);
    this.saveMessage.set('');

    const doSave = (avatarUrl?: string) => {
      this.data.updateProfile({
        firstName: this.profileForm.value.firstName ?? '',
        lastName: this.profileForm.value.lastName ?? '',
        username: this.profileForm.value.username ?? '',
        birthday: this.profileForm.value.birthday ?? '',
        password: password || undefined,
        avatarUrl,
      }).subscribe({
        next: () => {
          this.saveMessage.set('Profil sikeresen mentve.');
          this.isSaving.set(false);
          this.pendingAvatarFile = null;
          this.toast.show('Profil sikeresen mentve!', 'success');
        },
        error: () => {
          this.saveMessage.set('Hiba történt a mentés során.');
          this.isSaving.set(false);
          this.toast.show('Hiba történt a mentés során.', 'error');
        },
      });
    };

    if (this.pendingAvatarFile) {
      this.data.uploadAvatar(this.pendingAvatarFile).subscribe({
        next: (url) => doSave(url),
        error: () => {
          this.saveMessage.set('Az avatar feltöltése nem sikerült.');
          this.isSaving.set(false);
        },
      });
    } else {
      doSave();
    }
  }

  connectPlatform(platform: ExternalPlatform): void {
    if (this.isConnecting()) return;
    this.isConnecting.set(true);
    this.connectionMessage.set('Kapcsolódás folyamatban...');

    this.data.requestMetaConnection(platform).subscribe({
      next: (authorizationUrl) => {
        window.location.href = authorizationUrl;
      },
      error: () => {
        this.connectionMessage.set('Nem sikerült kapcsolódni a platformhoz.');
        this.isConnecting.set(false);
      },
      complete: () => {
        this.isConnecting.set(false);
      },
    });
  }

  disconnectAccount(accountId: string): void {
    this.data.disconnectLinkedAccount(accountId).subscribe({
      next: () => {
        this.linkedAccounts.update(accounts =>
          accounts.map(a => a.id === accountId ? { ...a, status: 'revoked' as const } : a)
        );
        this.toast.show('Fiók leválasztva.', 'success');
      },
      error: () => this.toast.show('Hiba történt a leválasztás során.', 'error'),
    });
  }

  private loadLinkedAccounts(): void {
    this.data.getLinkedAccounts().subscribe({
      next: (accounts) => this.linkedAccounts.set(accounts),
      error: () => this.connectionMessage.set('A kapcsolt fiókok listája nem töltődött be.'),
    });
  }

  closeProfile(): void {
    this.closeRequested.emit();
  }
}
