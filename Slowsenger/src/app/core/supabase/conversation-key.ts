import { AppUserSummary } from './supabase.types';

/** Nicknames are at most this long. */
export const NICKNAME_MAX_LENGTH = 40;

/**
 * The key of a conversation, the same for everyone in it: "group:<id>" for a group, and for two people
 * "dm:<id>:<id>" with their ids sorted, so both of them arrive at the same key.
 */
export function conversationKey(viewerId: string, conversation: Pick<AppUserSummary, 'id' | 'members'>): string {
  return conversation.members ? `group:${conversation.id}` : `dm:${[viewerId, conversation.id].sort().join(':')}`;
}
