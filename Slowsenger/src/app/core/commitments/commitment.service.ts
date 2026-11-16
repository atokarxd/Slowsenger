import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, from, map, switchMap, tap } from 'rxjs';
import { ToastService } from '../toast/toast.service';
import { SlowsengerDataService } from '../supabase/slowsenger-data.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AppUserSummary } from '../supabase/supabase.types';
import { Commitment } from './commitment';
import { COMMITMENT_COLUMNS, CommitmentRow, toActionPayload, toCommitment } from './commitment-rows';
import { CommitmentAction, transition } from './lifecycle';

/** A commitment added by hand from a chat message (it starts as a proposal). */
export interface CommitmentDraft {
  title: string;
  owner: AppUserSummary | null;
  due: string | null;
  hasTime: boolean;
  /** The chat partner and the message it comes from. */
  partner: AppUserSummary;
  message: { id: string; text: string; sentByMe: boolean };
}

// The commitments live in Supabase (supabase/migrations/20261116_commitments.sql): both people of
// the conversation can read them, and every change goes through a database function that checks
// the lifecycle rules and the permissions. The same rules run here first, so the screen answers at
// once; the server has the last word, and what it says replaces the guess.
@Injectable({ providedIn: 'root' })
export class CommitmentService {
  private readonly data = inject(SlowsengerDataService);
  private readonly supabaseBase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  private readonly profiles = signal<AppUserSummary[]>([]);
  private readonly store = signal<Commitment[]>([]);

  /** The signed-in user. */
  readonly me = signal<AppUserSummary | null>(null);
  readonly myId = computed(() => this.me()?.id ?? null);
  /** Commitments from the signed-in user's conversations. */
  readonly commitments = this.store.asReadonly();

  private get supabase() {
    return this.supabaseBase.client;
  }

  /** Loads the commitments into `commitments` (and returns them). */
  load(): Observable<Commitment[]> {
    return forkJoin({ profiles: this.data.listProfiles(), profile: this.data.getProfile(), rows: this.fetch() }).pipe(
      map(({ profiles, profile, rows }) => {
        this.profiles.set(profiles);
        this.me.set(profiles.find((p) => p.id === profile?.id) ?? null);
        return rows.map((row) => this.toCommitment(row));
      }),
      tap((commitments) => this.store.set(commitments)),
    );
  }

  /** Runs a lifecycle action as the signed-in user. Returns why it was refused, or null. */
  apply(id: string, action: CommitmentAction): string | null {
    const actorId = this.myId();
    const commitment = this.store().find((c) => c.id === id);
    if (!actorId || !commitment) return 'Commitment not found.';
    const result = transition(commitment, action, { actorId, now: new Date() });
    if (!result.ok) return result.error;
    this.put({ ...result.commitment, ownedByMe: result.commitment.owner?.id === actorId });

    const request = this.supabase.rpc('apply_commitment_action', {
      p_commitment_id: id,
      p_action: action.type,
      p_payload: toActionPayload(action),
    });
    from(request).pipe(
      map(({ error }) => {
        if (error) throw error;
      }),
    ).subscribe({
      next: () => this.reload(id),
      error: (error: { message?: string }) => {
        // Refused (the other person got there first, say) or not sent: back to what the server has
        this.put(commitment);
        this.toast.show(error.message || 'Could not save the change.', 'error', 5000);
        this.reload(id);
      },
    });
    return null;
  }

  /** Adds a proposal linked to a chat message; the owner still has to accept it. */
  create(draft: CommitmentDraft): Observable<Commitment> {
    const request = this.supabase.rpc('create_commitment', {
      p_partner_id: draft.partner.id,
      p_title: draft.title.trim(),
      p_owner_id: draft.owner?.id ?? null,
      p_due: draft.due,
      p_has_time: draft.hasTime,
      p_source_message_id: draft.message.id,
    });
    return from(request).pipe(
      map(({ data, error }) => {
        if (error) throw error;
        return data as string;
      }),
      switchMap((id) => this.fetchOne(id)),
      map((row) => {
        if (!row) throw new Error('The new commitment could not be read back.');
        const commitment = this.toCommitment(row);
        this.put(commitment);
        return commitment;
      }),
    );
  }

  /** "You" for the signed-in user, otherwise the person's name. */
  nameOf(userId: string | null): string {
    if (!userId) return 'nobody';
    if (userId === this.myId()) return 'You';
    return this.profiles().find((p) => p.id === userId)?.name ?? 'someone';
  }

  private toCommitment(row: CommitmentRow): Commitment {
    return toCommitment(row, (userId) => this.profiles().find((p) => p.id === userId), this.myId());
  }

  /** Replaces the commitment with the same id, or adds it. */
  private put(commitment: Commitment): void {
    this.store.update((commitments) => commitments.some((c) => c.id === commitment.id)
      ? commitments.map((c) => (c.id === commitment.id ? commitment : c))
      : [...commitments, commitment]);
  }

  /** Takes the commitment as the server has it now. */
  private reload(id: string): void {
    this.fetchOne(id).subscribe({
      next: (row) => {
        if (row) this.put(this.toCommitment(row));
        else this.store.update((commitments) => commitments.filter((c) => c.id !== id));
      },
      error: () => undefined, // the next load brings it
    });
  }

  private fetch(): Observable<CommitmentRow[]> {
    return from(
      this.supabase
        .from('commitments')
        .select(COMMITMENT_COLUMNS)
        .order('created_at', { ascending: true })
    ).pipe(
      map(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as unknown as CommitmentRow[];
      }),
    );
  }

  private fetchOne(id: string): Observable<CommitmentRow | null> {
    return from(this.supabase.from('commitments').select(COMMITMENT_COLUMNS).eq('id', id).maybeSingle()).pipe(
      map(({ data, error }) => {
        if (error) throw error;
        return data as unknown as CommitmentRow | null;
      }),
    );
  }
}
