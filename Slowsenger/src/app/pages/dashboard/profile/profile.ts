import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, inject, output, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ToastService } from '../../../core/toast/toast.service';
import { DEFAULT_AVATAR } from '../../../core/default-avatar';
import { DatePicker } from '../../../shared/date-picker/date-picker';

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule, DatePicker],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(SlowsengerDataService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  readonly closeRequested = output<void>();

  readonly profileImage = signal(DEFAULT_AVATAR);

  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private pendingAvatarFile: File | null = null;
  private pressedOutside = false;

  readonly profileForm = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(40)]],
    lastName: ['', [Validators.required, Validators.maxLength(40)]],
    username: ['', [Validators.required, Validators.maxLength(40)]],
    password: [''],
    birthday: [''],
  });

  ngOnInit(): void {
    this.loadProfile();
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
      error: () => this.toast.show('Failed to load profile.', 'error'),
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

  // A click outside the card saves and closes the profile. The press must also start outside,
  // so selecting text in a field and releasing the mouse outside the card doesn't close it.
  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    this.pressedOutside = !this.isInsideCard(event);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.pressedOutside && !this.isInsideCard(event)) {
      this.saveAndClose();
    }
  }

  private isInsideCard(event: Event): boolean {
    return this.card().nativeElement.contains(event.target as Node);
  }

  /** Saves pending changes and closes. It closes even if saving fails; a toast reports the failure. */
  saveAndClose(): void {
    this.closeRequested.emit();

    // Nothing edited (or the profile hasn't even loaded yet): don't overwrite anything.
    if (!this.profileForm.dirty && !this.pendingAvatarFile) return;

    if (this.profileForm.invalid) {
      this.toast.show('Not saved: fill in all required fields.', 'error');
      return;
    }

    const { firstName, lastName, username, birthday, password } = this.profileForm.getRawValue();
    if (password && password.length < 6) {
      this.toast.show('Not saved: password needs 6+ characters.', 'error');
      return;
    }

    const save = (avatarUrl?: string) => {
      this.data.updateProfile({ firstName, lastName, username, birthday, password: password || undefined, avatarUrl }).subscribe({
        error: (error: unknown) => {
          const message = String((error as { message?: unknown } | null)?.message ?? '');
          this.toast.show(
            message.includes('idx_profiles_username_unique') ? 'Not saved: username is already taken.' : 'Not saved: something went wrong.',
            'error'
          );
        },
      });
    };

    if (this.pendingAvatarFile) {
      this.data.uploadAvatar(this.pendingAvatarFile).subscribe({
        next: (url) => save(url),
        error: () => this.toast.show('Not saved: profile picture upload failed.', 'error'),
      });
    } else {
      save();
    }
  }

  logout(): void {
    this.data.signOut().subscribe({
      next: () => this.router.navigate(['/auth/login']),
      error: () => this.toast.show('Error signing out.', 'error'),
    });
  }
}
