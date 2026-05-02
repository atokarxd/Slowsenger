import { Injectable, inject } from '@angular/core';
import { firstValueFrom, from, map, Observable } from 'rxjs';
import { DEFAULT_AVATAR } from '../default-avatar';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';
import {
    AppUserSummary,
    ExternalPlatform,
    LinkedAccountRow,
    ProfileRow,
    RegistrationInput,
    SendMessageInput,
    UnifiedMessageRow,
    UnifiedThreadRow,
    UpdateProfileInput,
    UserLabelRow,
} from './supabase.types';

@Injectable({ providedIn: 'root' })
export class SlowsengerDataService {
    private readonly supabaseBase = inject(SupabaseService);
    //private readonly supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);

    private get supabase() {
        return this.supabaseBase.client;
    }

    private normalizeUsername(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '.')
            .replace(/[^a-z0-9._-]/g, '');
    }

    private normalizeEmail(value: string): string {
        return value.trim().toLowerCase();
    }

    private async getLoginEmail(usernameOrEmail: string): Promise<string> {
        const trimmedValue = usernameOrEmail.trim();
        if (trimmedValue.includes('@')) {
            return this.normalizeEmail(trimmedValue);
        }

        const normalizedUsername = this.normalizeUsername(trimmedValue);
        if (!normalizedUsername) {
            throw new Error('Ervenytelen felhasznalonev.');
        }

        const { data, error } = await this.supabase.rpc('get_login_email_for_username', {
            p_username: normalizedUsername,
        });

        if (error) {
            throw error;
        }

        const email = typeof data === 'string' ? data : null;
        if (!email) {
            throw new Error('Nincs ilyen felhasznalonev, vagy nincs hozzarendelt email cim.');
        }

        return this.normalizeEmail(email);
    }

    private async requireUserId(): Promise<string> {
        const { data, error } = await this.supabase.auth.getUser();
        if (error || !data.user) {
            throw error ?? new Error('User session not found');
        }
        return data.user.id;
    }

    signUp(email: string, password: string): Observable<void> {
        return from(this.supabase.auth.signUp({ email, password })).pipe(
            map(({ error }) => {
                if (error) {
                    throw error;
                }
            })
        );
    }

    signIn(email: string, password: string): Observable<void> {
        return from(this.supabase.auth.signInWithPassword({ email, password })).pipe(
            map(({ error }) => {
                if (error) {
                    throw error;
                }
            })
        );
    }

    signInWithUsernameOrEmail(usernameOrEmail: string, password: string): Observable<void> {
        return from((async () => {
            const email = await this.getLoginEmail(usernameOrEmail);

            const { error } = await this.supabase.auth.signInWithPassword({ email, password });
            if (error) {
                throw error;
            }
        })());
    }

    registerWithProfile(input: RegistrationInput): Observable<void> {
        return from((async () => {
            const normalizedUsername = this.normalizeUsername(input.username);
            if (!normalizedUsername) {
                throw new Error('Ervenytelen felhasznalonev formatum.');
            }

            const email = this.normalizeEmail(input.email);
            if (!email.includes('@')) {
                throw new Error('Adj meg ervenyes email cimet.');
            }

            const { data: isUsernameAvailable, error: usernameCheckError } = await this.supabase.rpc('is_username_available', {
                p_username: normalizedUsername,
            });

            if (usernameCheckError) {
                const checkErrorText = `${usernameCheckError.message ?? ''} ${String((usernameCheckError as { details?: unknown }).details ?? '')}`.toLowerCase();
                const isMissingRpc = checkErrorText.includes('is_username_available') || checkErrorText.includes('42883') || checkErrorText.includes('function');

                // If RPC is not deployed yet, continue with signup and rely on DB unique index.
                if (!isMissingRpc) {
                    throw usernameCheckError;
                }
            }

            if (isUsernameAvailable === false) {
                throw new Error('Ez a felhasznalonev mar foglalt.');
            }

            const displayName = `${input.firstName} ${input.lastName}`.trim();

            const { data: signUpData, error: signUpError } = await this.supabase.auth.signUp({
                email,
                password: input.password,
                options: {
                    data: {
                        display_name: displayName,
                        email,
                        phone: input.phone,
                        first_name: input.firstName,
                        last_name: input.lastName,
                        username: normalizedUsername,
                        birthday: input.birthday,
                    },
                },
            });

            if (signUpError) {
                const signUpMessage = `${signUpError.message ?? ''} ${String((signUpError as { details?: unknown }).details ?? '')}`.toLowerCase();
                if (signUpMessage.includes('idx_profiles_username_unique') || signUpMessage.includes('username')) {
                    throw new Error('Ez a felhasznalonev mar foglalt.');
                }
                if (signUpMessage.includes('already registered') || signUpMessage.includes('user already registered')) {
                    throw new Error('Ez az email cim mar regisztralva van.');
                }
                if (signUpMessage.includes('email rate limit exceeded') || signUpMessage.includes('too many requests')) {
                    throw new Error('Tul sok regisztracios probalkozas tortent. Varj 1-2 percet, majd probald ujra.');
                }
                throw signUpError;
            }

            // Supabase may return no error for already-registered emails when user enumeration protection is enabled.
            const identities = signUpData?.user?.identities;
            if (Array.isArray(identities) && identities.length === 0) {
                throw new Error('Ez az email cim mar regisztralva van.');
            }
        })()).pipe(map(() => void 0));
    }

    signOut(): Observable<void> {
        return from(this.supabase.auth.signOut()).pipe(
            map(({ error }) => {
                if (error) {
                    throw error;
                }
            })
        );
    }

    getLinkedAccounts(): Observable<LinkedAccountRow[]> {
        return from(
            this.supabase
                .from('linked_accounts')
                .select('id, user_id, platform, external_user_id, external_username, status, created_at')
                .order('created_at', { ascending: false })
        ).pipe(
            map(({ data, error }) => {
                if (error) {
                    throw error;
                }
                return (data ?? []) as LinkedAccountRow[];
            })
        );
    }

    getUnifiedThreads(): Observable<UnifiedThreadRow[]> {
        return from(
            this.supabase
                .from('unified_threads')
                .select('id, owner_user_id, platform, external_thread_id, title, last_message_at, created_at')
                .order('last_message_at', { ascending: false, nullsFirst: false })
        ).pipe(
            map(({ data, error }) => {
                if (error) {
                    throw error;
                }
                return (data ?? []) as UnifiedThreadRow[];
            })
        );
    }

    getMessages(threadId: string): Observable<UnifiedMessageRow[]> {
        return from(
            this.supabase
                .from('unified_messages')
                .select('id, thread_id, sender_user_id, sender_external_id, content, direction, created_at')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true })
        ).pipe(
            map(({ data, error }) => {
                if (error) {
                    throw error;
                }
                return (data ?? []) as UnifiedMessageRow[];
            })
        );
    }

    sendMessage(input: SendMessageInput): Observable<void> {
        return from(
            this.supabase.from('unified_messages').insert({
                thread_id: input.threadId,
                content: input.content,
                direction: 'outbound',
            })
        ).pipe(
            map(({ error }) => {
                if (error) {
                    throw error;
                }
            })
        );
    }

    requestMetaConnection(platform: ExternalPlatform): Observable<string> {
        const callbackUrl = `${window.location.origin}/auth/meta/callback`;
        const state = btoa(JSON.stringify({ platform }));

        const scopes = platform === 'messenger'
            ? 'pages_messaging,pages_manage_metadata,pages_show_list'
            : 'instagram_basic,instagram_manage_messages,pages_show_list';

        const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
        url.searchParams.set('client_id', environment.metaAppId);
        url.searchParams.set('redirect_uri', callbackUrl);
        url.searchParams.set('scope', scopes);
        url.searchParams.set('state', state);
        url.searchParams.set('response_type', 'code');

        return from(Promise.resolve(url.toString()));
    }

    completeMetaConnection(platform: ExternalPlatform, code: string): Observable<void> {
        const callbackUrl = `${window.location.origin}/auth/meta/callback`;

        return from((async () => {
            const userId = await this.requireUserId();

            const res = await fetch(`${environment.backendUrl}/meta/oauth/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, redirectUri: callbackUrl }),
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const externalUserId = data.pageId ?? data.userId;
            const externalUsername = data.pageName ?? data.name;

            const { error } = await this.supabase.from('linked_accounts').upsert({
                user_id: userId,
                platform,
                external_user_id: externalUserId,
                external_username: externalUsername,
                access_token: data.pageToken ?? null,
                page_id: data.pageId ?? null,
                status: 'connected',
            }, { onConflict: 'user_id,platform,external_user_id' });

            if (error) throw error;
        })()).pipe(map(() => void 0));
    }

    private async getMessengerAccount(): Promise<LinkedAccountRow | null> {
        const userId = await this.requireUserId();
        const { data, error } = await this.supabase
            .from('linked_accounts')
            .select('*')
            .eq('user_id', userId)
            .eq('platform', 'messenger')
            .eq('status', 'connected')
            .maybeSingle();
        if (error) throw error;
        return data as LinkedAccountRow | null;
    }

    syncMessengerConversations(): Observable<void> {
        return from((async () => {
            const account = await this.getMessengerAccount();
            if (!account?.access_token || !account?.page_id) return;

            const userId = await this.requireUserId();
            const pageToken = account.access_token;
            const pageId = account.page_id;

            const convRes = await fetch(
                `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=id,name,participants,updated_time&limit=25&access_token=${pageToken}`
            );
            const convData = await convRes.json();
            if (convData.error) throw new Error(convData.error.message);

            for (const conv of (convData.data ?? [])) {
                const participants: Array<{ id: string; name: string }> = conv.participants?.data ?? [];
                const recipient = participants.find((p) => p.id !== pageId);
                if (!recipient) continue;

                const externalThreadId = `${conv.id}|${recipient.id}`;
                const title = conv.name || recipient.name || 'Messenger user';

                const { data: thread, error: threadError } = await this.supabase
                    .from('unified_threads')
                    .upsert({
                        owner_user_id: userId,
                        platform: 'messenger' as ExternalPlatform,
                        external_thread_id: externalThreadId,
                        title,
                        last_message_at: conv.updated_time ?? null,
                    }, { onConflict: 'owner_user_id,platform,external_thread_id' })
                    .select('id')
                    .single();

                if (threadError || !thread) continue;

                const msgRes = await fetch(
                    `https://graph.facebook.com/v19.0/${conv.id}/messages?fields=id,message,from,created_time&limit=50&access_token=${pageToken}`
                );
                const msgData = await msgRes.json();
                if (msgData.error) continue;

                for (const msg of [...(msgData.data ?? [])].reverse()) {
                    if (!msg.message) continue;
                    const direction = msg.from?.id === pageId ? 'outbound' : 'inbound';

                    await this.supabase.from('unified_messages').upsert({
                        thread_id: thread.id,
                        sender_external_id: msg.from?.id ?? null,
                        content: msg.message,
                        direction,
                        created_at: msg.created_time,
                        external_message_id: msg.id,
                    }, { onConflict: 'external_message_id', ignoreDuplicates: true });
                }
            }
        })()).pipe(map(() => void 0));
    }

    sendMessengerMessage(recipientPsid: string, content: string): Observable<void> {
        return from((async () => {
            const account = await this.getMessengerAccount();
            if (!account?.access_token || !account?.page_id) {
                throw new Error('Messenger nincs kapcsolva');
            }

            const res = await fetch(
                `https://graph.facebook.com/v19.0/${account.page_id}/messages`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recipient: { id: recipientPsid },
                        message: { text: content },
                        access_token: account.access_token,
                    }),
                }
            );

            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
        })()).pipe(map(() => void 0));
    }

    getThreadByExternalId(externalThreadId: string): Observable<UnifiedThreadRow | null> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('unified_threads')
                .select('id, owner_user_id, platform, external_thread_id, title, last_message_at, created_at')
                .eq('owner_user_id', userId)
                .eq('external_thread_id', externalThreadId)
                .maybeSingle();
            if (error) throw error;
            return data as UnifiedThreadRow | null;
        })());
    }

    hasValidProfile(): Observable<boolean> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('profiles')
                .select('id')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                throw error;
            }

            return !!data;
        })());
    }

    listProfiles(): Observable<AppUserSummary[]> {
        return from(
            this.supabase
                .from('profiles')
                .select('id, display_name, email, username, avatar_url')
                .order('created_at', { ascending: false })
        ).pipe(
            map(({ data, error }) => {
                if (error) {
                    throw error;
                }

                return ((data ?? []) as Array<Pick<ProfileRow, 'id' | 'display_name' | 'email' | 'username' | 'avatar_url'>>)
                    .map((profile) => ({
                        id: profile.id,
                        name: profile.display_name ?? 'Unknown user',
                        username: profile.username ?? 'unknown',
                        avatarUrl: profile.avatar_url ?? DEFAULT_AVATAR,
                    }));
            })
        );
    }

    getOrCreateDirectThread(targetUser: AppUserSummary): Observable<UnifiedThreadRow> {
        return from((async () => {
            const ownerUserId = await this.requireUserId();
            const externalThreadId = `user:${targetUser.id}`;

            const { data: existing, error: existingError } = await this.supabase
                .from('unified_threads')
                .select('id, owner_user_id, platform, external_thread_id, title, last_message_at, created_at')
                .eq('owner_user_id', ownerUserId)
                .eq('platform', 'messenger')
                .eq('external_thread_id', externalThreadId)
                .maybeSingle();

            if (existingError) {
                throw existingError;
            }

            if (existing) {
                return existing as UnifiedThreadRow;
            }

            const { data: inserted, error: insertError } = await this.supabase
                .from('unified_threads')
                .insert({
                    owner_user_id: ownerUserId,
                    platform: 'messenger',
                    external_thread_id: externalThreadId,
                    title: targetUser.name,
                    last_message_at: null,
                })
                .select('id, owner_user_id, platform, external_thread_id, title, last_message_at, created_at')
                .single();

            if (insertError) {
                throw insertError;
            }

            return inserted as UnifiedThreadRow;
        })());
    }

    getDirectMessages(targetUser: AppUserSummary): Observable<UnifiedMessageRow[]> {
        return from((async () => {
            const thread = await firstValueFrom(this.getOrCreateDirectThread(targetUser));
            if (!thread) {
                return [] as UnifiedMessageRow[];
            }

            const { data, error } = await this.supabase
                .from('unified_messages')
                .select('id, thread_id, sender_user_id, sender_external_id, content, direction, created_at')
                .eq('thread_id', thread.id)
                .order('created_at', { ascending: true });

            if (error) {
                throw error;
            }

            return (data ?? []) as UnifiedMessageRow[];
        })());
    }

    sendDirectMessage(targetUser: AppUserSummary, content: string): Observable<void> {
        return from(
            this.supabase.rpc('send_direct_message', {
                p_recipient_id: targetUser.id,
                p_content: content,
            })
        ).pipe(
            map(({ error }) => {
                if (error) throw error;
            })
        );
    }

    getProfile(): Observable<ProfileRow | null> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            return data as ProfileRow | null;
        })());
    }

    updateProfile(input: UpdateProfileInput): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();

            const displayName = `${input.firstName} ${input.lastName}`.trim();
            const { error: profileError } = await this.supabase
                .from('profiles')
                .update({
                    first_name: input.firstName,
                    last_name: input.lastName,
                    display_name: displayName,
                    username: input.username,
                    birthday: input.birthday || null,
                    ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
                })
                .eq('id', userId);

            if (profileError) throw profileError;

            if (input.password) {
                const { error: authError } = await this.supabase.auth.updateUser({ password: input.password });
                if (authError) throw authError;
            }
        })()).pipe(map(() => void 0));
    }

    deleteThread(threadId: string): Observable<void> {
        return from(
            this.supabase.from('unified_threads').delete().eq('id', threadId)
        ).pipe(map(({ error }) => { if (error) throw error; }));
    }

    disconnectLinkedAccount(accountId: string): Observable<void> {
        return from(
            this.supabase
                .from('linked_accounts')
                .update({ status: 'revoked' })
                .eq('id', accountId)
        ).pipe(map(({ error }) => { if (error) throw error; }));
    }

    // ─── Label system ────────────────────────────────────────────────────────────

    getLabels(): Observable<UserLabelRow[]> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('user_labels')
                .select('id, name, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return (data ?? []) as UserLabelRow[];
        })());
    }

    createLabel(name: string): Observable<UserLabelRow> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('user_labels')
                .insert({ user_id: userId, name })
                .select('id, name, created_at')
                .single();
            if (error) throw error;
            return data as UserLabelRow;
        })());
    }

    getThreadLabels(): Observable<Record<string, string>> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('thread_labels')
                .select('thread_id, label_id')
                .eq('user_id', userId);
            if (error) throw error;
            const map: Record<string, string> = {};
            for (const row of (data ?? []) as { thread_id: string; label_id: string }[]) {
                map[row.thread_id] = row.label_id;
            }
            return map;
        })());
    }

    assignLabelToThread(threadId: string, labelId: string): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();
            await this.supabase
                .from('thread_labels')
                .delete()
                .eq('user_id', userId)
                .eq('thread_id', threadId);
            const { error } = await this.supabase
                .from('thread_labels')
                .insert({ user_id: userId, thread_id: threadId, label_id: labelId });
            if (error) throw error;
        })()).pipe(map(() => void 0));
    }

    removeLabelFromThread(threadId: string): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { error } = await this.supabase
                .from('thread_labels')
                .delete()
                .eq('user_id', userId)
                .eq('thread_id', threadId);
            if (error) throw error;
        })()).pipe(map(() => void 0));
    }

    deleteLabel(labelId: string): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { error } = await this.supabase
                .from('user_labels')
                .delete()
                .eq('id', labelId)
                .eq('user_id', userId);
            if (error) throw error;
        })()).pipe(map(() => void 0));
    }

    // ─── Unread tracking ─────────────────────────────────────────────────────────

    getThreadReadTimes(): Observable<Record<string, string>> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('thread_read_at')
                .select('thread_id, read_at')
                .eq('user_id', userId);
            if (error) throw error;
            const map: Record<string, string> = {};
            for (const row of (data ?? []) as { thread_id: string; read_at: string }[]) {
                map[row.thread_id] = row.read_at;
            }
            return map;
        })());
    }

    markThreadRead(threadId: string): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { error } = await this.supabase
                .from('thread_read_at')
                .upsert(
                    { user_id: userId, thread_id: threadId, read_at: new Date().toISOString() },
                    { onConflict: 'user_id,thread_id' }
                );
            if (error) throw error;
        })()).pipe(map(() => void 0));
    }

    uploadAvatar(file: File): Observable<string> {
        return from((async () => {
            const userId = await this.requireUserId();
            const ext = file.name.split('.').pop() ?? 'jpg';
            const path = `${userId}/avatar.${ext}`;

            const { error: uploadError } = await this.supabase.storage
                .from('avatars')
                .upload(path, file, { upsert: true, contentType: file.type });

            if (uploadError) throw uploadError;

            const { data } = this.supabase.storage.from('avatars').getPublicUrl(path);
            return data.publicUrl;
        })());
    }
}
