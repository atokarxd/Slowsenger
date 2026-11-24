import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { NicknameService } from '../../../../core/nicknames/nickname.service';
import { AppUserSummary } from '../../../../core/supabase/supabase.types';
import { ProfileDetail } from './profile-detail';

describe('ProfileDetail', () => {
  const anna: AppUserSummary = { id: 'anna', name: 'Anna Kovács', username: 'anna.kovacs', avatarUrl: 'anna.png' };
  const lili: AppUserSummary = { id: 'lili', name: 'Lili Szabó', username: 'lili.szabo', avatarUrl: 'lili.png' };
  const group: AppUserSummary = { id: 'g1', name: 'Anna, Lili', username: '', avatarUrl: 'anna.png', members: [anna, lili] };

  let fixture: ComponentFixture<ProfileDetail>;
  let host: HTMLElement;
  let saved: Record<string, string>;
  let save: ReturnType<typeof vi.fn>;
  const closed = vi.fn();
  const startGroup = vi.fn();
  const fields = () => [...host.querySelectorAll<HTMLInputElement>('.nickname-input')];
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  const create = async (conversation: AppUserSummary) => {
    save = vi.fn(() => of(undefined));
    await TestBed.configureTestingModule({
      imports: [ProfileDetail],
      providers: [{
        provide: NicknameService,
        useValue: { myId: signal('me'), of: (_: unknown, id: string) => saved[id] ?? null, save },
      }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileDetail);
    host = fixture.nativeElement;
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.startGroup.subscribe(startGroup);
    fixture.componentRef.setInput('conversation', conversation);
    fixture.componentRef.setInput('origin', { x: 10, y: 5, width: 150, height: 64 });
    fixture.componentRef.setInput('title', conversation.name);
    fixture.componentRef.setInput('open', true);
    await fixture.whenStable();
  };

  beforeEach(() => {
    saved = {};
    closed.mockClear();
    startGroup.mockClear();
  });

  it('drops out of the user-info with the picture, name, username and saved nickname', async () => {
    saved = { anna: 'Panni' };
    await create(anna);
    expect(host.classList.contains('is-open')).toBe(true);
    expect(host.style.getPropertyValue('--ox')).toBe('10px');
    expect(host.style.getPropertyValue('--oh')).toBe('64px');
    const card = host.querySelector('.card')!;
    expect(card.querySelector<HTMLImageElement>('.photo')!.src).toContain('anna.png');
    expect(card.textContent).toContain('Anna Kovács');
    expect(card.textContent).toContain('@anna.kovacs');
    expect(fields()[0].value).toBe('Panni');
  });

  it('saves the nickname when the card is left by a click outside it', async () => {
    await create(anna);
    type(fields()[0], '  Panni ');
    host.querySelector<HTMLElement>('.scrim')!.click();
    expect(save).toHaveBeenCalledWith(anna, new Map([['anna', 'Panni']]));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('leaves on Enter and on Escape too, and saves nothing that did not change', async () => {
    saved = { anna: 'Panni' };
    await create(anna);
    fields()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(save).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('starts a group with the person from the "+", leaving the card', async () => {
    await create(anna);
    host.querySelector<HTMLButtonElement>('.add')!.click();
    expect(closed).toHaveBeenCalled();
    expect(startGroup).toHaveBeenCalledWith([anna]);
  });

  it('lists a group’s members, each with a nickname; an emptied one is taken away', async () => {
    saved = { lili: 'Lilu' };
    await create(group);
    expect([...host.querySelectorAll('.member-name')].map((e) => e.textContent)).toEqual(['Anna Kovács', 'Lili Szabó']);
    expect(fields().map((f) => f.value)).toEqual(['', 'Lilu']);

    type(fields()[0], 'Panni');
    type(fields()[1], '');
    host.querySelector<HTMLElement>('.pill')!.click();
    expect(save).toHaveBeenCalledWith(group, new Map([['anna', 'Panni'], ['lili', '']]));
  });

  it('leaves a group only once asked twice, without saving nicknames into it', async () => {
    const leave = vi.fn();
    await create(group);
    fixture.componentInstance.leave.subscribe(leave);
    type(fields()[0], 'Panni');

    host.querySelector<HTMLButtonElement>('.leave-btn')!.click();
    await fixture.whenStable();
    expect(leave).not.toHaveBeenCalled();
    expect(host.querySelector('.leave-question')?.textContent).toContain('Leave and delete');

    host.querySelector<HTMLButtonElement>('.leave-cancel')!.click();
    await fixture.whenStable();
    expect(host.querySelector('.leave-btn')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('.leave-btn')!.click();
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('.leave-confirm')!.click();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('has nothing to leave with one person', async () => {
    await create(anna);
    expect(host.querySelector('.leave')).toBeNull();
  });

  it('is out of reach while closed', async () => {
    await create(anna);
    fixture.componentRef.setInput('open', false);
    await fixture.whenStable();
    expect(host.classList.contains('is-open')).toBe(false);
    expect(host.querySelector('.card')!.hasAttribute('inert')).toBe(true);
  });
});
