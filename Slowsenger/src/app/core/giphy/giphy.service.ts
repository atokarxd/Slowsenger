import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { SupabaseService } from '../supabase/supabase.service';
import { GifAttachment } from '../supabase/supabase.types';

const API = 'https://api.giphy.com/v1/gifs';
const PAGE_SIZE = 24;
/** GIPHY's own limit on the length of a search. */
const MAX_QUERY = 50;
/** Only GIFs rated for everyone. */
const RATING = 'g';

/** One GIF of a search, ready to be sent. */
export interface GifResult {
  id: string;
  title: string;
  /** The rendition for the picker's grid, and the one sent (the same: GIPHY's fixed width, 200px). */
  gif: GifAttachment;
}

/** A failed call, with what to tell the user. */
export class GiphyError extends Error {}

interface GiphyRendition {
  url?: string;
  webp?: string;
  width?: string;
  height?: string;
}

interface GiphyGif {
  id: string;
  title?: string;
  images?: { fixed_width?: GiphyRendition };
}

/** What the environment may say about GIPHY (each app's environment.ts has only its own part). */
interface GiphyEnvironment {
  /** The key itself: the browser calls GIPHY directly (offline). */
  giphyApiKey?: string;
  /** Or the Supabase Edge Function that keeps the key on the server and calls GIPHY for the browser (online). */
  giphyFunction?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

/**
 * GIF search on GIPHY (developers.giphy.com/docs/api); what is searched for goes to GIPHY, nothing else.
 * Two ways, by the environment: with a key in it, the browser calls GIPHY itself (the offline version);
 * with giphyFunction, it asks that Supabase Edge Function (supabase/functions/giphy-search), which holds
 * the key as a secret, so the key is neither in the repository nor in the browser, and only signed-in
 * users can search.
 */
@Injectable({ providedIn: 'root' })
export class GiphyService {
  private readonly supabase = inject(SupabaseService);
  private readonly env = environment as GiphyEnvironment;

  /** false: neither a key nor a function set in the environment, so there is nothing to search with. */
  readonly configured = !!this.env.giphyApiKey || !!this.env.giphyFunction;

  /** Trending GIFs for an empty query, search results otherwise. */
  async find(query: string, signal?: AbortSignal): Promise<GifResult[]> {
    if (!this.configured) throw new GiphyError('No GIPHY API key is set.');
    const q = query.trim().slice(0, MAX_QUERY);

    let response: Response;
    try {
      response = await this.request(q, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new GiphyError('GIPHY cannot be reached. Check the connection.');
    }
    if (response.status === 429) throw new GiphyError('The GIPHY key’s hourly limit is used up. Try again later.');
    if (response.status === 401 && !this.env.giphyApiKey) throw new GiphyError('Sign in again to search GIFs.');
    if (response.status === 401 || response.status === 403) throw new GiphyError('GIPHY did not accept the API key.');
    if (response.status === 503 && !this.env.giphyApiKey) throw new GiphyError('GIF search is not set up on the server yet.');
    if (!response.ok) throw new GiphyError('GIPHY is not answering. Try again later.');

    const body = (await response.json()) as { data?: GiphyGif[] };
    return (body.data ?? []).flatMap((gif) => {
      const rendition = gif.images?.fixed_width;
      const url = rendition?.webp || rendition?.url;
      if (!url) return [];
      const title = gif.title?.trim() || 'GIF';
      return [{
        id: gif.id,
        title,
        gif: { kind: 'gif', giphyId: gif.id, title, url, width: Number(rendition!.width) || 200, height: Number(rendition!.height) || 200 },
      }];
    });
  }

  /** GIPHY itself with the key, or the Edge Function as the signed-in user; both answer in GIPHY's form. */
  private async request(q: string, signal?: AbortSignal): Promise<Response> {
    if (this.env.giphyApiKey) {
      const params = new URLSearchParams({ api_key: this.env.giphyApiKey, limit: String(PAGE_SIZE), rating: RATING });
      if (q) params.set('q', q);
      return fetch(`${API}/${q ? 'search' : 'trending'}?${params}`, { signal });
    }
    const { data } = await this.supabase.getSession();
    return fetch(`${this.env.supabaseUrl}/functions/v1/${this.env.giphyFunction}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.env.supabaseAnonKey ?? '',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ q }),
      signal,
    });
  }
}
