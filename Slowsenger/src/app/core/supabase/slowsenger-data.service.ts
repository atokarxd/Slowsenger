import { DestroyRef, Injectable, inject } from '@angular/core';
import { firstValueFrom, from, map, Observable } from 'rxjs';
import { DEFAULT_AVATAR } from '../default-avatar';
import { conversationKey, NICKNAME_MAX_LENGTH } from './conversation-key';
import { SupabaseService } from './supabase.service';
import {
    AppUserSummary,
    MessageAttachment,
    NicknameRow,
    ProfileRow,
    REPLY_PREVIEW_LENGTH,
    RegistrationInput,
    ReplyRef,
    ScheduledMessageRow,
    UnifiedMessageRow,
    UnifiedThreadRow,
    UpdateProfileInput,
    UserLabelRow,
} from './supabase.types';

const THREAD_COLUMNS = 'id, owner_user_id, external_thread_id, title, last_message_at, created_at';
const MESSAGE_COLUMNS = 'id, thread_id, sender_user_id, content, direction, created_at, commitment_id, attachment, reply_to';
const SCHEDULED_COLUMNS = 'id, sender_user_id, recipient_user_id, content, send_at, created_at';
// Only these profile columns are readable for other users (see column grants in schema.sql).
const PUBLIC_PROFILE_COLUMNS = 'id, display_name, username, avatar_url';
// How often an open app has the server send its user's messages that fell due (send later). The database
// does it every minute on its own (pg_cron); this keeps them going where that is not switched on.
const DUE_CHECK_MS = 60_000;

type PublicProfile = Pick<ProfileRow, 'id' | 'display_name' | 'username' | 'avatar_url'>;

/** A row of the my_groups database function. */
interface GroupListRow {
    group_id: string;
    group_name: string;
    member_ids: string[];
}

@Injectable({ providedIn: 'root' })
export class SlowsengerDataService {
    private readonly supabaseBase = inject(SupabaseService);

    constructor() {
        const deliver = () => void this.deliverMyDueMessages();
        const first = setTimeout(deliver, 2000);
        const timer = setInterval(deliver, DUE_CHECK_MS);
        inject(DestroyRef).onDestroy(() => {
            clearTimeout(first);
            clearInterval(timer);
        });
    }

    private get supabase() {
        return this.supabaseBase.client;
    }

    /** Sends the signed-in user's scheduled messages whose time has come (deliver_my_due_messages). */
    private async deliverMyDueMessages(): Promise<void> {
        try {
            const { data } = await this.supabase.auth.getSession();
            if (data.session) await this.supabase.rpc('deliver_my_due_messages');
        } catch {
            // Offline for a moment, or the database not migrated yet: the next round tries again
        }
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

    /** The signed-in user's own thread with a person, or of a group they are in (targetUser.members set). */
    getOrCreateDirectThread(targetUser: AppUserSummary): Observable<UnifiedThreadRow> {
        return from((async () => {
            const ownerUserId = await this.requireUserId();
            const externalThreadId = targetUser.members ? `group:${targetUser.id}` : `user:${targetUser.id}`;

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

    /**
     * Sends a message to a person or into a group (the database writes everyone's copy); with replyTo, it
     * answers that one (every copy carries the same reference).
     */
    sendDirectMessage(targetUser: AppUserSummary, content: string, replyTo: ReplyRef | null = null): Observable<void> {
        return this.send(targetUser, content, {
            p_reply_to: replyTo ? { ...replyTo, preview: replyTo.preview.slice(0, REPLY_PREVIEW_LENGTH) } : null,
        });
    }

    /** Sends a GIF or a file (stored in the file store before); content is its plain-text summary, for previews. */
    sendAttachment(targetUser: AppUserSummary, attachment: MessageAttachment, content: string): Observable<void> {
        return this.send(targetUser, content, { p_attachment: attachment });
    }

    private send(targetUser: AppUserSummary, content: string, extra: Record<string, unknown>): Observable<void> {
        return from(
            this.supabase.rpc('send_direct_message', { p_recipient_id: targetUser.id, p_content: content, ...extra })
        ).pipe(
            map(({ error }) => {
                if (error) throw error;
            })
        );
    }

    // ─── Send later ──────────────────────────────────────────────────────────────

    /** The database sends them at their time (pg_cron), whether the app is open or not. */
    readonly sendsLaterOnlyWhileOpen = false;

    /** Sends content to targetUser at sendAt; until then only the sender sees it, among the scheduled ones. */
    scheduleMessage(targetUser: AppUserSummary, content: string, sendAt: Date): Observable<ScheduledMessageRow> {
        return from((async () => {
            const senderId = await this.requireUserId();
            if (senderId === targetUser.id) {
                throw new Error('Cannot send a message to yourself');
            }
            if (!content.trim()) {
                throw new Error('The message is empty.');
            }
            if (!(sendAt.getTime() > Date.now())) {
                throw new Error('Pick a time in the future.');
            }
            const { data, error } = await this.supabase
                .from('scheduled_messages')
                .insert({ sender_user_id: senderId, recipient_user_id: targetUser.id, content, send_at: sendAt.toISOString() })
                .select(SCHEDULED_COLUMNS)
                .single();
            if (error) throw error;
            return data as ScheduledMessageRow;
        })());
    }

    /** The signed-in user's messages to targetUser that wait for their time, earliest first. */
    getScheduledMessages(targetUser: AppUserSummary): Observable<ScheduledMessageRow[]> {
        return from((async () => {
            const senderId = await this.requireUserId();
            const { data, error } = await this.supabase
                .from('scheduled_messages')
                .select(SCHEDULED_COLUMNS)
                .eq('sender_user_id', senderId)
                .eq('recipient_user_id', targetUser.id)
                .order('send_at', { ascending: true });
            if (error) throw error;
            return (data ?? []) as ScheduledMessageRow[];
        })());
    }

    /** Drops a scheduled message of the signed-in user; one already sent is gone from the list anyway. */
    cancelScheduledMessage(id: string): Observable<void> {
        return from((async () => {
            const senderId = await this.requireUserId();
            const { error } = await this.supabase.from('scheduled_messages').delete().eq('id', id).eq('sender_user_id', senderId);
            if (error) throw error;
        })());
    }

    // ─── Groups ──────────────────────────────────────────────────────────────────

    /** The groups the signed-in user is in, as conversations (see AppUserSummary.members). */
    getGroups(): Observable<AppUserSummary[]> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase.rpc('my_groups');
            if (error) throw error;
            const rows = (data ?? []) as GroupListRow[];
            if (rows.length === 0) return [];
            const profiles = await firstValueFrom(this.listProfiles());
            return rows.map((row) => this.groupSummary(row.group_id, row.group_name, row.member_ids, userId, profiles));
        })());
    }

    /**
     * Starts a group of the signed-in user and at least two others with its first message: the group only
     * comes about (and shows in the others' lists, unread) once something has been written in it. It is
     * called after the others' first names. If these people already have a group, the message goes there.
     */
    createGroup(people: AppUserSummary[], firstMessage: string): Observable<AppUserSummary> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase.rpc('create_group_with_message', {
                p_member_ids: people.map((person) => person.id),
                p_content: firstMessage,
            });
            if (error) throw error;
            const group = data as { id: string; name: string; member_ids: string[] };
            const profiles = await firstValueFrom(this.listProfiles());
            return this.groupSummary(group.id, group.name, group.member_ids, userId, profiles);
        })());
    }

    /**
     * Leaves a group: the signed-in user is no longer in it, and their own copy of it (its messages, label,
     * read mark, messages waiting to be sent to it, their nickname there) is deleted. The others keep the
     * group and its messages; the last one to leave deletes it.
     */
    leaveGroup(group: AppUserSummary): Observable<void> {
        return from(this.supabase.rpc('leave_group', { p_group_id: group.id })).pipe(
            map(({ error }) => {
                if (error) throw error;
            })
        );
    }

    /** A group as a conversation for the viewer: the others in it, the ones with an avatar first. */
    private groupSummary(
        id: string, name: string, memberIds: string[], viewerId: string, profiles: AppUserSummary[],
    ): AppUserSummary {
        const members = memberIds
            .filter((memberId) => memberId !== viewerId)
            .map((memberId) => profiles.find((p) => p.id === memberId))
            .filter((person): person is AppUserSummary => !!person)
            .sort((a, b) => Number(a.avatarUrl === DEFAULT_AVATAR) - Number(b.avatarUrl === DEFAULT_AVATAR));
        return { id, name, username: '', avatarUrl: members[0]?.avatarUrl ?? DEFAULT_AVATAR, members };
    }

    // ─── Nicknames ───────────────────────────────────────────────────────────────

    /** Every nickname in the conversations the signed-in user takes part in (the database lets only those through). */
    getNicknames(): Observable<NicknameRow[]> {
        return from(
            this.supabase.from('conversation_nicknames').select('conversation, user_id, nickname, set_by, updated_at')
        ).pipe(
            map(({ data, error }) => {
                if (error) throw error;
                return (data ?? []) as NicknameRow[];
            })
        );
    }

    /**
     * Gives someone in a conversation a nickname, which everyone in it sees; an empty one takes it away
     * (and resolves to null).
     */
    setNickname(conversation: AppUserSummary, personId: string, nickname: string): Observable<NicknameRow | null> {
        return from((async () => {
            const userId = await this.requireUserId();
            const { data, error } = await this.supabase.rpc('set_nickname', {
                p_conversation: conversationKey(userId, conversation),
                p_user_id: personId,
                p_nickname: nickname.trim().slice(0, NICKNAME_MAX_LENGTH),
            });
            if (error) throw error;
            const row = data as NicknameRow | null;
            return row?.conversation ? row : null;
        })());
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
