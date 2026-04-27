export type ExternalPlatform = 'messenger' | 'instagram';

export interface ProfileRow {
    id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    birthday: string | null;
    avatar_url: string | null;
    created_at: string;
}

export interface AppUserSummary {
    id: string;
    name: string;
    username: string;
    avatarUrl: string;
    platform?: ExternalPlatform | 'slowsenger';
    externalThreadId?: string;
}

export interface LinkedAccountRow {
    id: string;
    user_id: string;
    platform: ExternalPlatform;
    external_user_id: string;
    external_username: string | null;
    status: 'connected' | 'revoked';
    created_at: string;
    access_token: string | null;
    page_id: string | null;
}

export interface UnifiedThreadRow {
    id: string;
    owner_user_id: string;
    platform: ExternalPlatform;
    external_thread_id: string;
    title: string | null;
    last_message_at: string | null;
    created_at: string;
}

export interface UnifiedMessageRow {
    id: string;
    thread_id: string;
    sender_user_id: string | null;
    sender_external_id: string | null;
    content: string;
    direction: 'inbound' | 'outbound';
    created_at: string;
}

export interface SendMessageInput {
    threadId: string;
    content: string;
}

export interface RegistrationInput {
    email: string;
    phone: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    birthday: string;
}

export interface UpdateProfileInput {
    firstName: string;
    lastName: string;
    username: string;
    birthday: string;
    avatarUrl?: string;
    password?: string;
}
