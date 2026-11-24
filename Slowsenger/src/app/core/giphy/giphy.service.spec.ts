import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { SupabaseService } from '../supabase/supabase.service';
import { GiphyError, GiphyService } from './giphy.service';

describe('GiphyService', () => {
  // Each app's environment has only its own GIPHY fields: set them all for each test, put them back after
  const env = environment as { giphyApiKey?: string; giphyFunction?: string; supabaseUrl?: string; supabaseAnonKey?: string };
  const saved = { ...env };
  const fetchMock = vi.fn();
  const reply = (status: number, body: unknown = {}) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  const giphy = () => TestBed.inject(GiphyService);
  const requested = () => new URL(fetchMock.mock.calls.at(-1)![0] as string);

  beforeEach(() => {
    Object.assign(env, { giphyApiKey: 'test-key', giphyFunction: undefined });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { getSession: async () => ({ data: { session: { access_token: 'user-token' } }, error: null }) } }],
    });
  });

  afterEach(() => {
    for (const key of ['giphyApiKey', 'giphyFunction', 'supabaseUrl', 'supabaseAnonKey'] as const) {
      if (key in saved) env[key] = saved[key];
      else delete env[key];
    }
    vi.unstubAllGlobals();
  });

  it('asks for trending GIFs without a query, and searches with one', async () => {
    reply(200, { data: [] });
    await giphy().find('  ');
    expect(requested().pathname).toBe('/v1/gifs/trending');
    expect(requested().searchParams.get('q')).toBeNull();

    reply(200, { data: [] });
    await giphy().find(' macska ');
    expect(requested().pathname).toBe('/v1/gifs/search');
    expect(Object.fromEntries(requested().searchParams)).toEqual({ api_key: 'test-key', limit: '24', rating: 'g', q: 'macska' });
  });

  it('keeps a search within GIPHY’s 50 characters', async () => {
    reply(200, { data: [] });
    await giphy().find('x'.repeat(80));
    expect(requested().searchParams.get('q')).toHaveLength(50);
  });

  it('turns GIFs into what the chat sends, preferring WebP, and skips any without the rendition', async () => {
    reply(200, {
      data: [
        { id: 'a', title: 'Happy cat', images: { fixed_width: { url: 'https://g/a.gif', webp: 'https://g/a.webp', width: '200', height: '150' } } },
        { id: 'b', title: '', images: { fixed_width: { url: 'https://g/b.gif', width: '200', height: '113' } } },
        { id: 'c', images: {} },
      ],
    });
    const results = await giphy().find('cat');
    expect(results.map((r) => r.gif)).toEqual([
      { kind: 'gif', giphyId: 'a', title: 'Happy cat', url: 'https://g/a.webp', width: 200, height: 150 },
      { kind: 'gif', giphyId: 'b', title: 'GIF', url: 'https://g/b.gif', width: 200, height: 113 },
    ]);
  });

  it('says what went wrong', async () => {
    reply(429);
    await expect(giphy().find('cat')).rejects.toThrow('hourly limit');
    reply(403);
    await expect(giphy().find('cat')).rejects.toThrow('did not accept the API key');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(giphy().find('cat')).rejects.toBeInstanceOf(GiphyError);
  });

  it('does not call GIPHY without a key', async () => {
    env.giphyApiKey = '';
    const service = giphy();
    expect(service.configured).toBe(false);
    await expect(service.find('cat')).rejects.toThrow('No GIPHY API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('through the Edge Function (the key on the server)', () => {
    beforeEach(() => {
      Object.assign(env, { giphyApiKey: '', giphyFunction: 'giphy-search', supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon' });
    });

    it('asks the function as the signed-in user, with no key in the browser', async () => {
      reply(200, { data: [{ id: 'a', title: 'Cat', images: { fixed_width: { url: 'https://g/a.gif', width: '200', height: '150' } } }] });
      const results = await giphy().find(' macska ');
      const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
      expect(url).toBe('https://project.supabase.co/functions/v1/giphy-search');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ q: 'macska' });
      expect(init.headers).toEqual(expect.objectContaining({ apikey: 'anon', Authorization: 'Bearer user-token' }));
      expect(url).not.toContain('api_key');
      expect(results.map((r) => r.gif.giphyId)).toEqual(['a']);
    });

    it('says when the user is signed out, or the server has no key yet', async () => {
      reply(401);
      await expect(giphy().find('cat')).rejects.toThrow('Sign in again');
      reply(503);
      await expect(giphy().find('cat')).rejects.toThrow('not set up on the server');
    });
  });
});
