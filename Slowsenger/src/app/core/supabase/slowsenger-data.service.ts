import { Injectable, inject } from '@angular/core';
import { firstValueFrom, from, map, Observable } from 'rxjs';
import { DEFAULT_AVATAR } from '../default-avatar';
import { SupabaseService } from './supabase.service';
import {
    AppUserSummary,
    ProfileRow,
    RegistrationInput,
    UnifiedMessageRow,
    UnifiedThreadRow,
    UpdateProfileInput,
    UserLabelRow,
} from './supabase.types';

const THREAD_COLUMNS = 'id, owner_user_id, external_thread_id, title, last_message_at, created_at';
const MESSAGE_COLUMNS = 'id, thread_id, sender_user_id, content, direction, created_at';
// Only these profile columns are readable for other users (see column grants in schema.sql).
const PUBLIC_PROFILE_COLUMNS = 'id, display_name, username, avatar_url';

type PublicProfile = Pick<ProfileRow, 'id' | 'display_name' | 'username' | 'avatar_url'>;

@Injectable({ providedIn: 'root' })
export class SlowsengerDataService {
    private readonly supabaseBase = inject(SupabaseService);

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

    private toUserSummary(profile: PublicProfile): AppUserSummary {
        return {
            id: profile.id,
            name: profile.display_name ?? 'Unknown user',
            username: profile.username ?? 'unknown',
            avatarUrl: profile.avatar_url ?? DEFAULT_AVATAR,
        };
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
        return from(this.supabase.auth.signInWithPassword({ email: this.normalizeEmail(email), password })).pipe(
            map(({ error }) => {
                if (error) {
                    throw error;
                }
            })
        );
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

    getUnifiedThreads(): Observable<UnifiedThreadRow[]> {
        return from(
            this.supabase
                .from('unified_threads')
                .select(THREAD_COLUMNS)
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
                .select(MESSAGE_COLUMNS)
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
                .select(PUBLIC_PROFILE_COLUMNS)
                .order('created_at', { ascending: false })
        ).pipe(
            map(({ data, error }) => {
                if (error) {
                    throw error;
                }

                return ((data ?? []) as PublicProfile[]).map((profile) => this.toUserSummary(profile));
            })
        );
    }

    findProfileByUsername(username: string): Observable<AppUserSummary | null> {
        return from((async () => {
            const normalizedUsername = this.normalizeUsername(username);
            if (!normalizedUsername) {
                return null;
            }

            const { data, error } = await this.supabase
                .from('profiles')
                .select(PUBLIC_PROFILE_COLUMNS)
                .eq('username', normalizedUsername)
                .maybeSingle();

            if (error) {
                throw error;
            }

            return data ? this.toUserSummary(data as PublicProfile) : null;
        })());
    }

    getOrCreateDirectThread(targetUser: AppUserSummary): Observable<UnifiedThreadRow> {
        return from((async () => {
            const ownerUserId = await this.requireUserId();
            const externalThreadId = `user:${targetUser.id}`;

            const { data: existing, error: existingError } = await this.supabase
                .from('unified_threads')
                .select(THREAD_COLUMNS)
                .eq('owner_user_id', ownerUserId)
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
                    external_thread_id: externalThreadId,
                    title: targetUser.name,
                    last_message_at: null,
                })
                .select(THREAD_COLUMNS)
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
                .select(MESSAGE_COLUMNS)
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

    // Private columns (birthday, phone, ...) are not readable via the table; this RPC returns only the caller's own row.
    getProfile(): Observable<ProfileRow | null> {
        return from(this.supabase.rpc('get_my_profile').maybeSingle()).pipe(
            map(({ data, error }) => {
                if (error) throw error;
                return data as ProfileRow | null;
            })
        );
    }

    updateProfile(input: UpdateProfileInput): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();

            // Must match registration, otherwise the username can't be found when starting a chat.
            const normalizedUsername = this.normalizeUsername(input.username);
            if (!normalizedUsername) {
                throw new Error('Ervenytelen felhasznalonev formatum.');
            }

            const displayName = `${input.firstName} ${input.lastName}`.trim();
            const { error: profileError } = await this.supabase
                .from('profiles')
                .update({
                    first_name: input.firstName,
                    last_name: input.lastName,
                    display_name: displayName,
                    username: normalizedUsername,
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

    // A conversation has at most one label: (user_id, thread_id) is the primary key, so this replaces any previous one.
    assignLabelToThread(threadId: string, labelId: string): Observable<void> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { error } = await this.supabase
                .from('thread_labels')
                .upsert(
                    { user_id: userId, thread_id: threadId, label_id: labelId },
                    { onConflict: 'user_id,thread_id' }
                );
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
