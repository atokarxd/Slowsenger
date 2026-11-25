import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { SlowsengerDataService } from './slowsenger-data.service';
import { SupabaseService } from './supabase.service';
import { AI_CONSENT_MISSING, AppUserSummary } from './supabase.types';

// The online data service's calls of the database functions of supabase/migrations/20261124_chat_features.sql:
// their names and parameters (tested in SQL on their own) must match these exactly.
describe('SlowsengerDataService (Supabase calls)', () => {
  const me = '11111111-1111-4111-8111-111111111111';
  const anna: AppUserSummary = { id: '22222222-2222-4222-8222-222222222222', name: 'Anna Kovács', username: 'anna', avatarUrl: 'anna.png' };
  const bela: AppUserSummary = { id: '33333333-3333-4333-8333-333333333333', name: 'Béla Nagy', username: 'bela', avatarUrl: 'bela.png' };
  let rpc: ReturnType<typeof vi.fn>;
  let data: SlowsengerDataService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] }); // the send-later round of an open app
    rpc = vi.fn(async (name: string) => ({
      data: name === 'create_group_with_message' ? { id: 'g1', name: 'Anna, Béla', member_ids: [me, anna.id, bela.id] }
        : name === 'my_groups' ? [{ group_id: 'g1', group_name: 'Anna, Béla', member_ids: [me, anna.id, bela.id] }]
          : name === 'set_nickname' ? { conversation: 'x', user_id: anna.id, nickname: 'Panni', set_by: me, updated_at: '' }
            : null,
      error: null,
    }));
    const profiles = { data: [anna, bela].map((p) => ({ id: p.id, display_name: p.name, username: p.username, avatar_url: p.avatarUrl })), error: null };
    const client = {
      rpc,
      auth: { getUser: async () => ({ data: { user: { id: me } }, error: null }), getSession: async () => ({ data: { session: null } }) },
      from: () => ({ select: () => ({ order: async () => profiles }) }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: { client } }] });
    data = TestBed.inject(SlowsengerDataService);
  });

  afterEach(() => vi.useRealTimers());

  it('sends a reply with its reference cut to the preview length, and an attachment', async () => {
    await firstValueFrom(data.sendDirectMessage(anna, 'Szia!', { sender_user_id: anna.id, created_at: 't', preview: 'x'.repeat(300) }));
    expect(rpc).toHaveBeenLastCalledWith('send_direct_message', {
      p_recipient_id: anna.id, p_content: 'Szia!', p_reply_to: { sender_user_id: anna.id, created_at: 't', preview: 'x'.repeat(140) },
    });
    const gif = { kind: 'gif' as const, giphyId: 'a', title: 'hi', url: 'https://media.giphy.com/a.gif', width: 200, height: 150 };
    await firstValueFrom(data.sendAttachment(anna, gif, 'GIF: hi'));
    expect(rpc).toHaveBeenLastCalledWith('send_direct_message', { p_recipient_id: anna.id, p_content: 'GIF: hi', p_attachment: gif });
  });

  it('starts a group and lists it with the others in it', async () => {
    const group = await firstValueFrom(data.createGroup([anna, bela], 'Sziasztok!'));
    expect(rpc).toHaveBeenCalledWith('create_group_with_message', { p_member_ids: [anna.id, bela.id], p_content: 'Sziasztok!' });
    expect(group).toEqual(expect.objectContaining({ id: 'g1', name: 'Anna, Béla' }));
    expect(group.members?.map((m) => m.id)).toEqual([anna.id, bela.id]);

    const [listed] = await firstValueFrom(data.getGroups());
    expect(rpc).toHaveBeenCalledWith('my_groups');
    expect(listed.members?.map((m) => m.name)).toEqual(['Anna Kovács', 'Béla Nagy']);

    await firstValueFrom(data.leaveGroup(group));
    expect(rpc).toHaveBeenLastCalledWith('leave_group', { p_group_id: 'g1' });
  });

  it('gives a nickname under the conversation\'s key, trimmed', async () => {
    const row = await firstValueFrom(data.setNickname(anna, anna.id, '  Panni  '));
    expect(rpc).toHaveBeenLastCalledWith('set_nickname', {
      p_conversation: `dm:${[me, anna.id].sort().join(':')}`, p_user_id: anna.id, p_nickname: 'Panni',
    });
    expect(row?.nickname).toBe('Panni');
  });

  it('does not schedule into the past, and the database sends them on its own', async () => {
    await expect(firstValueFrom(data.scheduleMessage(anna, 'x', new Date(Date.now() - 1000)))).rejects.toThrow('future');
    expect(data.sendsLaterOnlyWhileOpen).toBe(false);
  });
});

// The AI's Edge Functions (supabase/functions/recognize-commitments, summarize-chat) and the consent of
// supabase/migrations/20261125_ai_features.sql: names and bodies must match the functions' own.
describe('SlowsengerDataService (AI)', () => {
  const me = '11111111-1111-4111-8111-111111111111';
  const anna: AppUserSummary = { id: '22222222-2222-4222-8222-222222222222', name: 'Anna Kovács', username: 'anna', avatarUrl: 'anna.png' };
  let invoke: ReturnType<typeof vi.fn>;
  let rpc: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let eq: ReturnType<typeof vi.fn>;
  let data: SlowsengerDataService;
  const httpError = (status: number, body: unknown) =>
    ({ message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status }) });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    invoke = vi.fn(async () => ({ data: { suggested: 2 }, error: null }));
    rpc = vi.fn(async () => ({ data: true, error: null }));
    eq = vi.fn(async () => ({ error: null }));
    update = vi.fn(() => ({ eq }));
    const client = {
      rpc,
      functions: { invoke },
      from: () => ({ update }),
      auth: { getUser: async () => ({ data: { user: { id: me } }, error: null }), getSession: async () => ({ data: { session: null } }) },
    };
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: { client } }] });
    data = TestBed.inject(SlowsengerDataService);
  });

  afterEach(() => vi.useRealTimers());

  it('saves the consent on the user\'s own profile', async () => {
    await firstValueFrom(data.setAiConsent(true));
    expect(update).toHaveBeenCalledWith({ ai_consent: true });
    expect(eq).toHaveBeenCalledWith('id', me);
  });

  it('asks the database whether everyone in a conversation agreed', async () => {
    expect(await firstValueFrom(data.aiAllowed(anna))).toBe(true);
    expect(rpc).toHaveBeenCalledWith('conversation_ai_allowed', { p_key: `dm:${me}:${anna.id}` });
  });

  it('has the recognizer read the newest message to a partner', async () => {
    expect(await firstValueFrom(data.recognizeCommitments(anna))).toBe(2);
    expect(invoke).toHaveBeenCalledWith('recognize-commitments', {
      body: { partner: anna.id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
  });

  it('asks for the summary of a chat or a group since it was read', async () => {
    const result = { summary: ['a'], commitments: [], decisions: [], count: 3 };
    invoke.mockResolvedValue({ data: result, error: null });
    expect(await firstValueFrom(data.summarizeChat(anna, '2026-11-25T08:00:00.000Z'))).toEqual(result);
    expect(invoke).toHaveBeenLastCalledWith('summarize-chat', { body: { thread: `user:${anna.id}`, since: '2026-11-25T08:00:00.000Z' } });
    await firstValueFrom(data.summarizeChat({ ...anna, id: 'g1', members: [anna] }, null));
    expect(invoke).toHaveBeenLastCalledWith('summarize-chat', { body: { thread: 'group:g1', since: null } });
  });

  it('passes on what the function says went wrong, consent above all', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'consent' }) });
    await expect(firstValueFrom(data.summarizeChat(anna, null))).rejects.toThrow(AI_CONSENT_MISSING);
    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'The AI is busy; try again in a minute.' }) });
    await expect(firstValueFrom(data.summarizeChat(anna, null))).rejects.toThrow('The AI is busy; try again in a minute.');
    invoke.mockResolvedValue({ data: null, error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }) });
    await expect(firstValueFrom(data.summarizeChat(anna, null))).rejects.toThrow('not set up on the server yet');
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    await expect(firstValueFrom(data.recognizeCommitments(anna))).rejects.toThrow('Failed to send a request');
  });
});

