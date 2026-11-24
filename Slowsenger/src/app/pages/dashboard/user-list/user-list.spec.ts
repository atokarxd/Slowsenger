import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
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
  /** The list's live channel: calling it is a new message arriving. */
  let realtime: ((payload: { new: unknown }) => void) | null;

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
    realtime = null;
    const channel = {
      on: (_type: string, _filter: unknown, callback: (payload: { new: unknown }) => void) => { realtime = callback; return channel; },
      subscribe: () => channel,
    };
    const supabase = {
      getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }),
      client: { channel: () => channel, removeChannel: vi.fn() },
    };
    await TestBed.configureTestingModule({
      imports: [UserList],
      providers: [{ provide: SlowsengerDataService, useValue: data }, { provide: SupabaseService, useValue: supabase }],
    }).compileComponents();

    fixture = TestBed.createComponent(UserList);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
    component.chatSelected.subscribe(chatSelected);
    await settle();
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('live', () => {
    const wait = async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await settle();
    };

    it('reloads quietly, once for a burst, when messages come into the conversations', async () => {
      expect(realtime).not.toBeNull();
      const loads = data['getUnifiedThreads'].mock.calls.length;
      realtime!({ new: { thread_id: 't9', direction: 'inbound' } });
      realtime!({ new: { thread_id: 't9', direction: 'inbound' } });
      expect(component.isLoading()).toBe(false);
      await wait();
      expect(data['getUnifiedThreads'].mock.calls.length).toBe(loads + 1);
      expect(component.isLoading()).toBe(false); // no skeleton for it
    });

    it('keeps the conversation open beside it read', async () => {
      data['getUnifiedThreads'].mockReturnValue(of([{ ...thread, last_message_at: '2026-11-24T10:00:00.000Z' }]));
      // The server still has the old read time (marking it read is on its way): a new copy every time
      data['getThreadReadTimes'].mockImplementation(() => of({ t1: '2026-11-24T09:00:00.000Z' }));
      data['markThreadRead'] = vi.fn(() => of(undefined));
      component.loadAllData();
      await settle();
      expect(host.querySelector('.user-name.is-unread')).not.toBeNull();

      host.querySelector<HTMLElement>('.item-row')!.click();
      await settle();
      data['markThreadRead'].mockClear();
      realtime!({ new: { thread_id: 't1', direction: 'inbound' } });
      await wait();
      expect(data['markThreadRead']).toHaveBeenCalledWith('t1');
      expect(host.querySelector('.user-name.is-unread')).toBeNull();
    });
  });

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
