import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Regist, passwordMatchValidator, birthdayValidator } from './regist';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';

// ── passwordMatchValidator ────────────────────────────────────────────────────

describe('passwordMatchValidator', () => {
  it('returns null when passwords match', () => {
    const group = new FormGroup({
      password: new FormControl('secret123'),
      confirmPassword: new FormControl('secret123'),
    });
    expect(passwordMatchValidator(group)).toBeNull();
  });

  it('returns passwordMismatch error when passwords differ', () => {
    const group = new FormGroup({
      password: new FormControl('secret123'),
      confirmPassword: new FormControl('different'),
    });
    expect(passwordMatchValidator(group)).toEqual({ passwordMismatch: true });
  });

  it('returns null when both fields are empty', () => {
    const group = new FormGroup({
      password: new FormControl(''),
      confirmPassword: new FormControl(''),
    });
    expect(passwordMatchValidator(group)).toBeNull();
  });
});

// ── birthdayValidator ─────────────────────────────────────────────────────────

describe('birthdayValidator', () => {
  it('returns null for a valid date', () => {
    const group = new FormGroup({
      year: new FormControl('1995'),
      month: new FormControl('6'),
      day: new FormControl('15'),
    });
    expect(birthdayValidator(group)).toBeNull();
  });

  it('returns null when all fields are empty', () => {
    const group = new FormGroup({
      year: new FormControl(''),
      month: new FormControl(''),
      day: new FormControl(''),
    });
    expect(birthdayValidator(group)).toBeNull();
  });

  it('returns invalidYear when year is more than 100 years ago', () => {
    const oldYear = String(new Date().getFullYear() - 110);
    const group = new FormGroup({
      year: new FormControl(oldYear),
      month: new FormControl('6'),
      day: new FormControl('1'),
    });
    expect(birthdayValidator(group)?.['invalidYear']).toBeTruthy();
  });

  it('returns invalidYear when year is in the future', () => {
    const group = new FormGroup({
      year: new FormControl('2099'),
      month: new FormControl('6'),
      day: new FormControl('1'),
    });
    expect(birthdayValidator(group)?.['invalidYear']).toBeTruthy();
  });

  it('returns invalidMonth when month is 13', () => {
    const group = new FormGroup({
      year: new FormControl('1995'),
      month: new FormControl('13'),
      day: new FormControl('1'),
    });
    expect(birthdayValidator(group)?.['invalidMonth']).toBeTruthy();
  });

  it('returns invalidDay when day is 0', () => {
    const group = new FormGroup({
      year: new FormControl('1995'),
      month: new FormControl('6'),
      day: new FormControl('0'),
    });
    expect(birthdayValidator(group)?.['invalidDay']).toBeTruthy();
  });

  it('returns invalidDate for February 30', () => {
    const group = new FormGroup({
      year: new FormControl('2000'),
      month: new FormControl('2'),
      day: new FormControl('30'),
    });
    expect(birthdayValidator(group)?.['invalidDate']).toBeTruthy();
  });
});

// ── Regist component ──────────────────────────────────────────────────────────

describe('Regist', () => {
  let component: Regist;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Regist],
      providers: [
        provideRouter([]),
        { provide: SlowsengerDataService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(Regist);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('calculatePasswordStrength sets 0 for empty string', () => {
    component.calculatePasswordStrength('');
    expect(component.passwordStrength).toBe(0);
  });

  it('calculatePasswordStrength gives 100 for a fully strong password', () => {
    component.calculatePasswordStrength('StrongPass1!');
    expect(component.passwordStrength).toBe(100);
  });

  it('calculatePasswordStrength scores only the digit criterion for very short input', () => {
    // 'ab1': length < 6 (+0), no uppercase (+0), has digit (+20), no special (+0) = 20
    component.calculatePasswordStrength('ab1');
    expect(component.passwordStrength).toBe(20);
  });

  it('calculatePasswordStrength scores base length for a 6-char lowercase password', () => {
    // 'abcdef': length >= 6 (+20), no uppercase, no digit, no special = 20
    component.calculatePasswordStrength('abcdef');
    expect(component.passwordStrength).toBe(20);
  });

  it('getStrengthClass returns "weak" for strength below 40', () => {
    component.passwordStrength = 20;
    expect(component.getStrengthClass()).toBe('weak');
  });

  it('getStrengthClass returns "medium" for strength between 40 and 79', () => {
    component.passwordStrength = 60;
    expect(component.getStrengthClass()).toBe('medium');
  });

  it('getStrengthClass returns "strong" for strength 80 or above', () => {
    component.passwordStrength = 80;
    expect(component.getStrengthClass()).toBe('strong');
  });

  it('nextStep increments currentStep', () => {
    component.currentStep = 2;
    component.nextStep();
    expect(component.currentStep).toBe(3);
  });

  it('nextStep does not exceed totalSteps', () => {
    component.currentStep = component.totalSteps;
    component.nextStep();
    expect(component.currentStep).toBe(component.totalSteps);
  });

  it('prevStep decrements currentStep', () => {
    component.currentStep = 3;
    component.prevStep();
    expect(component.currentStep).toBe(2);
  });

  it('prevStep does not go below 1', () => {
    component.currentStep = 1;
    component.prevStep();
    expect(component.currentStep).toBe(1);
  });

  it('isCurrentStepInvalid returns true for step 1 when personal fields are empty', () => {
    component.currentStep = 1;
    expect(component.isCurrentStepInvalid()).toBe(true);
  });

  it('isCurrentStepInvalid returns false for step 1 when all personal fields are filled', () => {
    component.currentStep = 1;
    component.registForm.get('personal')!.setValue({
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
    });
    expect(component.isCurrentStepInvalid()).toBe(false);
  });

  it('togglePassword flips isPasswordHidden', () => {
    const initial = component.isPasswordHidden;
    component.togglePassword();
    expect(component.isPasswordHidden).toBe(!initial);
    component.togglePassword();
    expect(component.isPasswordHidden).toBe(initial);
  });

  it('submitError is empty on component creation', () => {
    expect(component.submitError).toBe('');
  });

  it('isSubmitting is false on component creation', () => {
    expect(component.isSubmitting).toBe(false);
  });
});
