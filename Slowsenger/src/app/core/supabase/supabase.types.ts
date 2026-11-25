export interface ProfileRow {
    id: string;
    display_name: string | null;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    birthday: string | null;
    avatar_url: string | null;
    created_at: string;
    /**
     * AI suggestions turned on: the AI (Claude) may read the user's conversations, to suggest commitments
     * and sum up unread messages; it does so only where everyone in the conversation has turned it on.
     * Only the user themselves sees it.
     */
    ai_consent?: boolean;
}

export interface AppUserSummary {
    id: string;
    name: string;
    username: string;
    avatarUrl: string;
    /**
     * Set: a group conversation, not a person. id is the group's, and these are the other people in it
     * (the signed-in user is left out), in the order its avatar shows them.
     */
    members?: AppUserSummary[];
}

/** A group conversation: each member has their own thread of it ("group:<id>"), as with direct ones. */
export interface GroupRow {
    id: string;
    name: string;
    member_ids: string[];
    created_by: string;
    created_at: string;
}

/**
 * A nickname someone has in a conversation; everyone in the conversation sees it. conversation is
 * "dm:<id>:<id>" (the two people, ids sorted) or "group:<group id>": see conversationKey.
 */
export interface NicknameRow {
    conversation: string;
    user_id: string;
    nickname: string;
    set_by: string;
    updated_at: string;
}

export interface UnifiedThreadRow {
    id: string;
    owner_user_id: string;
    external_thread_id: string;
    title: string | null;
    last_message_at: string | null;
    created_at: string;
}

export interface UnifiedMessageRow {
    id: string;
    thread_id: string;
    sender_user_id: string | null;
    content: string;
    direction: 'inbound' | 'outbound';
    created_at: string;
    /**
     * Set: the message is a commitment card (an invite, or a suggestion of the recognizer: those come from
     * the app itself, with no sender); content is its plain-text summary.
     */
    commitment_id?: string | null;
    /** Set: a GIF or a file goes with the message; content is its plain-text summary. */
    attachment?: MessageAttachment | null;
    /** Set: the message answers this one. */
    reply_to?: ReplyRef | null;
}

/**
 * The message a reply answers, as it was when answered: who wrote it, when (the same in every copy of it,
 * so each person finds it in their own thread), and the start of its text.
 */
export interface ReplyRef {
    sender_user_id: string;
    created_at: string;
    preview: string;
}

/** A reply keeps this much of the answered text. */
export const REPLY_PREVIEW_LENGTH = 140;

/** A GIF from GIPHY, as the chat shows it (its fixed-width rendition, 200px wide). */
export interface GifAttachment {
    kind: 'gif';
    giphyId: string;
    title: string;
    url: string;
    width: number;
    height: number;
}

/** A file the sender attached; its bytes are in the file store under fileId. */
export interface FileAttachment {
    kind: 'file';
    fileId: string;
    name: string;
    /** Bytes. */
    size: number;
    /** MIME type; image/* is shown as a picture. */
    type: string;
}

export type MessageAttachment = GifAttachment | FileAttachment;

/** A message waiting to be sent at send_at; only its sender sees it until then. */
export interface ScheduledMessageRow {
    id: string;
    sender_user_id: string;
    recipient_user_id: string;
    content: string;
    send_at: string;
    created_at: string;
}

export interface UserLabelRow {
    id: string;
    name: string;
    created_at: string;
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

/** A summary of a conversation's unread messages (the AI's, from the Edge Function summarize-chat). */
export interface ChatSummaryResult {
    /** 3–6 points, the most important first, in the conversation's language. */
    summary: string[];
    /** Tasks taken on or asked for: who ("you", a name, or null if not said), what, and when as it was said. */
    commitments: { who: string | null; what: string; when: string | null }[];
    /** What was agreed on. */
    decisions: string[];
    /** How many messages it was made from; 0: nothing new from the others. */
    count: number;
    /** Not the AI's: the offline app's stand-in, which only picks out messages. */
    standIn?: boolean;
}

/** The error of an AI feature when not everyone in the conversation has turned on AI suggestions. */
export const AI_CONSENT_MISSING = 'consent';
