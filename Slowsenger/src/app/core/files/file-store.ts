import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { conversationKey } from '../supabase/conversation-key';
import { SupabaseService } from '../supabase/supabase.service';
import { AppUserSummary } from '../supabase/supabase.types';

/** The Storage bucket of attached files (supabase/migrations/20261124_chat_features.sql). */
const BUCKET = 'chat-files';
/** How long a link to a file works. */
const URL_SECONDS = 60 * 60;

/** The largest file that can be attached (the bucket allows the same). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** "2.4 MB", "830 KB", "120 B". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The folder of a conversation's files: its conversationKey with "_" for ":" ("dm_<id>_<id>",
 * "group_<id>"). The bucket's policies read it back to let only the conversation's people in.
 */
export function conversationFolder(key: string): string {
  return key.replaceAll(':', '_');
}

/**
 * Where attached files are kept, apart from the messages that point to them: a private Supabase Storage
 * bucket, one folder per conversation, which only the people of that conversation can read or write. A
 * message refers to its file by the file's path in the bucket; showing it takes a link that expires.
 */
@Injectable({ providedIn: 'root' })
export class FileStore {
  private readonly supabaseBase = inject(SupabaseService);
  /** One link per file for the session, however many messages show it. */
  private readonly urls = new Map<string, Promise<string | null>>();

  private get storage() {
    return this.supabaseBase.client.storage.from(BUCKET);
  }

  /** Keeps the file sent into a conversation; returns the id (its path) the message refers to it by. */
  save(file: File, conversation: AppUserSummary): Observable<string> {
    return from((async () => {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`Files up to ${formatBytes(MAX_FILE_BYTES)} can be attached.`);
      }
      const { data, error: userError } = await this.supabaseBase.client.auth.getUser();
      if (userError || !data.user) throw userError ?? new Error('User session not found');
      // A storage key keeps to plain characters; the name the message shows is kept with the message
      const safeName = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
      const path = `${conversationFolder(conversationKey(data.user.id, conversation))}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await this.storage.upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (error) throw error;
      return path;
    })());
  }

  /** A link to show or download the file from, for an hour; null if it cannot be read (any more). */
  url(fileId: string): Observable<string | null> {
    let url = this.urls.get(fileId);
    if (!url) {
      url = this.storage.createSignedUrl(fileId, URL_SECONDS)
        .then(({ data, error }) => (error ? null : data.signedUrl))
        .catch(() => null);
      this.urls.set(fileId, url);
    }
    return from(url);
  }
}
