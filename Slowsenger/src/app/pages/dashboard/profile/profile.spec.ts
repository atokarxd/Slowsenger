import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { Profile } from './profile';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { ToastService } from '../../../core/toast/toast.service';

describe('Profile', () => {
  let component: Profile;
  let fixture: ComponentFixture<Profile>;
  let data: SlowsengerDataService;
  let toast: ToastService;
  let closeCount: number;

  const press = (target: EventTarget) => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  const editFirstName = (value: string) => {
    component.profileForm.controls.firstName.setValue(value);
    component.profileForm.markAsDirty();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Profile],
    }).compileComponents();

    data = TestBed.inject(SlowsengerDataService);
    toast = TestBed.inject(ToastService);
    vi.spyOn(data, 'getProfile').mockReturnValue(of({
      id: 'user-1', display_name: 'Demo User', phone: null, first_name: 'Demo', last_name: 'User',
      username: 'demo', birthday: null, avatar_url: null, created_at: '2026-01-01T00:00:00Z',
    }));

    fixture = TestBed.createComponent(Profile);
    component = fixture.componentInstance;
    closeCount = 0;
    component.closeRequested.subscribe(() => closeCount++);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('has no Save or close button', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    expect(buttons.map((b) => b.textContent?.trim())).not.toContain('Save');
    expect(fixture.nativeElement.querySelector('.profile-close-button')).toBeNull();
  });

  it('closes without saving when nothing changed', () => {
    const update = vi.spyOn(data, 'updateProfile');
    press(document.body);
    expect(closeCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('stays open on a click inside the card', () => {
    press(fixture.nativeElement.querySelector('input[formcontrolname="firstName"]'));
    expect(closeCount).toBe(0);
  });

  it('saves the changes on a click outside the card', () => {
    const update = vi.spyOn(data, 'updateProfile').mockReturnValue(of(undefined));
    editFirstName('Changed');
    press(document.body);
    expect(closeCount).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Changed', lastName: 'User', username: 'demo' }));
  });

  it('closes and shows an error toast when a required field is empty', () => {
    const update = vi.spyOn(data, 'updateProfile');
    const show = vi.spyOn(toast, 'show');
    editFirstName('');
    press(document.body);
    expect(closeCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith('Not saved: fill in all required fields.', 'error');
  });

  it('closes and shows an error toast when saving fails', () => {
    vi.spyOn(data, 'updateProfile').mockReturnValue(throwError(() => new Error('network down')));
    const show = vi.spyOn(toast, 'show');
    editFirstName('Changed');
    press(document.body);
    expect(closeCount).toBe(1);
    expect(show).toHaveBeenCalledWith('Not saved: something went wrong.', 'error');
  });
});
