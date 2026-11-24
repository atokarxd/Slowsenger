import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, map, Observable, of, tap } from 'rxjs';
import { conversationKey } from '../supabase/conversation-key';
import { SlowsengerDataService } from '../supabase/slowsenger-data.service';
import { AppUserSummary, NicknameRow } from '../supabase/supabase.types';

/**
 * The nicknames in the signed-in user's conversations, for the list, the chat and the profile card alike:
 * one saved on the card shows everywhere at once. Everyone in a conversation sees its nicknames.
 */
@Injectable({ providedIn: 'root' })
export class NicknameService {
  private readonly data = inject(SlowsengerDataService);

  /** The signed-in user's id, known once load() has run. */
  readonly myId = signal<string | null>(null);
  private readonly rows = signal<NicknameRow[]>([]);
  /** conversation key → person id → nickname */
  private readonly byConversation = computed(() => {
    const conversations = new Map<string, Map<string, string>>();
    for (const row of this.rows()) {
      let names = conversations.get(row.conversation);
      if (!names) conversations.set(row.conversation, (names = new Map()));
      names.set(row.user_id, row.nickname);
    }
    return conversations;
  });

  load(): void {
    forkJoin({ me: this.data.getProfile(), rows: this.data.getNicknames() }).subscribe({
      next: ({ me, rows }) => {
        this.myId.set(me?.id ?? null);
        this.rows.set(rows);
      },
      error: () => this.rows.set([]),
    });
  }

  /** Someone's nickname in a conversation (with a person, or a group), or null. */
  of(conversation: Pick<AppUserSummary, 'id' | 'members'>, personId: string): string | null {
    const me = this.myId();
    return me ? this.byConversation().get(conversationKey(me, conversation))?.get(personId) ?? null : null;
  }

  /** Saves the nicknames that changed (person id → nickname; an empty one takes it away). */
  save(conversation: AppUserSummary, changes: ReadonlyMap<string, string>): Observable<void> {
    const me = this.myId();
    if (!me || changes.size === 0) return of(undefined);
    const key = conversationKey(me, conversation);
    return forkJoin(
      [...changes].map(([personId, nickname]) =>
        this.data.setNickname(conversation, personId, nickname).pipe(map((row) => ({ personId, row }))),
      ),
    ).pipe(
      tap((saved) => this.rows.update((rows) => [
        ...rows.filter((r) => !(r.conversation === key && saved.some((s) => s.personId === r.user_id))),
        ...saved.flatMap((s) => (s.row ? [s.row] : [])),
      ])),
      map(() => undefined),
    );
  }
}
