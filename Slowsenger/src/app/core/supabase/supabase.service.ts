import { Injectable } from '@angular/core';
import { createClient, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  public readonly client: SupabaseClient;
  private currentUser = new BehaviorSubject<User | null>(null);
  private currentSession = new BehaviorSubject<Session | null>(null);

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
    this.setupAuthListener();
  }

  // Ezt fogja használni az auth-guard! Megvárja, amíg biztosan kiderül a státusz.
  async getSession(): Promise<{ data: { session: Session | null }; error: any }> {
    return await this.client.auth.getSession();
  }

  // Erre feliratkozhat a navbar, vagy a profil komponens, ha kell a user adat
  get user$(): Observable<User | null> {
    return this.currentUser.asObservable();
  }

  private setupAuthListener() {
    this.client.auth.getSession().then(({ data: { session } }) => {
      this.currentSession.next(session);
      this.currentUser.next(session?.user ?? null);
    });

    this.client.auth.onAuthStateChange((_event, session) => {
      this.currentSession.next(session);
      this.currentUser.next(session?.user ?? null);
    });
  }
}