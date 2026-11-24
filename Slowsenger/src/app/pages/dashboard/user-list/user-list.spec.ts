import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { AppUserSummary, NicknameRow, UnifiedThreadRow } from '../../../core/supabase/supabase.types';
import { MemoryStorage } from '../../../core/testing/memory-storage';
import { UserList } from './user-list';

describe('UserList', () => {
  const anna: AppUserSummary = { id: 'anna', name: 'Anna Kovács', username: 'anna.kovacs', avatarUrl: 'anna.png' };
  const lili: AppUserSummary = { id: 'lili', name: 'Lili Szabó', username: 'lili.szabo', avatarUrl: 'lili.png' };
  const me: AppUserSummary = { id: 'me', name: 'Demo User', username: 'demo', avatarUrl: 'me.png' };
  const thread: UnifiedThreadRow = {
    id: 't1', owner_user_id: 'me', external_thread_id: 'user:anna', title: 'Anna Kovács', last_message_at: null, created_at: '',
  };

  let component: UserList;
  let fixture: ComponentFixture<UserList>;
  let host: HTMLElement;
  let nicknames: NicknameRow[];
  let data: Record<string, ReturnType<typeof vi.fn>>;
  const chatSelected = vi.fn();

  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const toField = () => host.querySelector<HTMLInputElement>('#new-message-to')!;
  const chips = () => [...host.querySelectorAll('.to-chip span')].map((e) => e.textContent);
  const addTo = async (username: string) => {
    toField().value = username;
    toField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
  };
  const send = async (message: string) => {
    host.querySelector<HTMLInputElement>('.message-group .custom-input')!.value = message;
    host.querySelector<HTMLButtonElement>('.send-btn')!.click();
    await settle();
  };

  beforeEach(async () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    nicknames = [];
    chatSelected.mockClear();
    const people: Record<string, AppUserSummary> = { 'anna.kovacs': anna, 'lili.szabo': lili, demo: me };
    data = {
      getUnifiedThreads: vi.fn(() => of([thread])),
      listProfiles: vi.fn(() => of([anna, lili])),
      getLabels: vi.fn(() => of([])),
      getThreadLabels: vi.fn(() => of({})),
      getThreadReadTimes: vi.fn(() => of({})),
      getGroups: vi.fn(() => of([])),
      getProfile: vi.fn(() => of({ id: 'me' })),
      getNicknames: vi.fn(() => of(nicknames)),
      findProfileByUsername: vi.fn((username: string) => of(people[username] ?? null)),
      sendDirectMessage: vi.fn(() => of(undefined)),
      createGroup: vi.fn((members: AppUserSummary[]) => of({ id: 'g1', name: 'Anna, Lili', username: '', avatarUrl: '', members })),
    };
    await TestBed.configureTestingModule({
      imports: [UserList],
      providers: [{ provide: SlowsengerDataService, useValue: data }],
    }).compileComponents();

    fixture = TestBed.createComponent(UserList);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
    component.chatSelected.subscribe(chatSelected);
    await settle();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('tells when a chat was last read, right before opening it (opening marks it read)', async () => {
    data['getThreadReadTimes'].mockReturnValue(of({ t1: '2026-11-23T10:00:00.000Z' }));
    data['markThreadRead'] = vi.fn(() => of(undefined));
    component.loadAllData();
    await settle();
    const order: string[] = [];
    component.readSince.subscribe((since) => order.push(`since ${since}`));
    component.chatSelected.subscribe(() => order.push('opened'));

    host.querySelector<HTMLElement>('.item-row')!.click();
    await settle();
    expect(order).toEqual(['since 2026-11-23T10:00:00.000Z', 'opened']);
    expect(data['markThreadRead']).toHaveBeenCalledWith('t1');

    order.length = 0;
    host.querySelector<HTMLElement>('.item-row')!.click(); // again: read just now
    await settle();
    expect(new Date(order[0].replace('since ', '')).getTime()).toBeGreaterThan(Date.parse('2026-11-23T10:00:00.000Z'));
  });

  it('has no separate group button any more: groups start from the new message', () => {
    expect(host.querySelector('[aria-label="New group"]')).toBeNull();
    expect(host.querySelector('[aria-label="New message"]')).not.toBeNull();
  });

  it('shows a person under their nickname in the conversation', async () => {
    nicknames = [{ conversation: 'dm:anna:me', user_id: 'anna', nickname: 'Panni', set_by: 'me', updated_at: '' }];
    component.loadAllData();
    await settle();
    expect(host.querySelector('.user-name')?.textContent).toBe('Panni');
  });

  describe('new message', () => {
    beforeEach(async () => {
      component.openNewMessageModal();
      await settle();
    });

    it('sends to the one person in To', async () => {
      await addTo('anna.kovacs');
      expect(chips()).toEqual(['Anna Kovács']);
      expect(host.querySelector('.group-hint')).toBeNull();

      await send('Szia!');
      expect(data['sendDirectMessage']).toHaveBeenCalledWith(anna, 'Szia!');
      expect(data['createGroup']).not.toHaveBeenCalled();
      expect(chatSelected).toHaveBeenCalledWith(anna);
    });

    it('takes a username still in the field when sending', async () => {
      toField().value = 'anna.kovacs';
      await send('Szia!');
      expect(data['sendDirectMessage']).toHaveBeenCalledWith(anna, 'Szia!');
    });

    it('starts a group with its first message once a second person is in To', async () => {
      await addTo('anna.kovacs');
      await addTo('lili.szabo');
      expect(chips()).toEqual(['Anna Kovács', 'Lili Szabó']);
      expect(host.querySelector('.group-hint')?.textContent).toContain('Anna, Lili & you');

      await send('Hétvégén?');
      expect(data['createGroup']).toHaveBeenCalledWith([anna, lili], 'Hétvégén?');
      expect(data['sendDirectMessage']).not.toHaveBeenCalled();
      expect(chatSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', members: [anna, lili] }));
    });

    it('starts nothing without a message', async () => {
      await addTo('anna.kovacs');
      await addTo('lili.szabo');
      await send('  ');
      expect(data['createGroup']).not.toHaveBeenCalled();
      expect(host.querySelector('.error-text')?.textContent).toContain('message');
    });

    it('refuses unknown usernames and the signed-in user', async () => {
      await addTo('nobody');
      expect(host.querySelector('.error-text')?.textContent).toBe('Username not found!');
      await addTo('demo');
      expect(host.querySelector('.error-text')?.textContent).toContain('That is you');
      expect(chips()).toEqual([]);
    });

    it('takes people off with their ×, or the last one with Backspace', async () => {
      await addTo('anna.kovacs');
      await addTo('lili.szabo');
      host.querySelector<HTMLButtonElement>('.to-chip button')!.click();
      await settle();
      expect(chips()).toEqual(['Lili Szabó']);
      toField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
      await settle();
      expect(chips()).toEqual([]);
    });
  });

  it('opens already addressed, as the profile card’s "+" does', async () => {
    component.openNewMessageModal([anna]);
    await settle();
    expect(chips()).toEqual(['Anna Kovács']);
  });
});
