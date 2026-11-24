// Supabase Edge Function: GIF search for the chat's GIF picker (src/app/core/giphy/giphy.service.ts).
//
// The GIPHY API key stays here, on the server, as the secret GIPHY_API_KEY: it is neither in the public
// repository nor sent to the browser. Only signed-in users can search (the token's role must be
// "authenticated"; the gateway has already checked the token's signature, "Verify JWT" being on).
// What is searched for goes to GIPHY, nothing else. The answer has GIPHY's own form, cut down to what
// the picker uses.
//
// Set up (once): Dashboard → Edge Functions → Deploy a new function → name it "giphy-search" and paste this
// file; then Edge Functions → Secrets → add GIPHY_API_KEY. With the CLI:
//   supabase functions deploy giphy-search
//   supabase secrets set GIPHY_API_KEY=...

const GIPHY = 'https://api.giphy.com/v1/gifs';
const PAGE_SIZE = '24';
const MAX_QUERY = 50; // GIPHY's own limit on the length of a search
const RATING = 'g'; // only GIFs rated for everyone

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Rendition {
  url?: string;
  webp?: string;
  width?: string;
  height?: string;
}

interface Gif {
  id: string;
  title?: string;
  images?: { fixed_width?: Rendition };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** The role in the request's token ("authenticated" for a signed-in user, "anon" for the bare anon key). */
function roleOf(authorization: string | null): string | null {
  try {
    const payload = (authorization ?? '').replace(/^Bearer\s+/i, '').split('.')[1] ?? '';
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (roleOf(request.headers.get('Authorization')) !== 'authenticated') {
    return json({ error: 'Sign in to search GIFs.' }, 401);
  }
  const key = Deno.env.get('GIPHY_API_KEY');
  if (!key) return json({ error: 'GIF search is not set up on the server yet.' }, 503);

  let q = '';
  try {
    const body = await request.json();
    q = String(body?.q ?? '').trim().slice(0, MAX_QUERY);
  } catch {
    // No body: trending GIFs
  }

  const params = new URLSearchParams({ api_key: key, limit: PAGE_SIZE, rating: RATING });
  if (q) params.set('q', q);
  let response: Response;
  try {
    response = await fetch(`${GIPHY}/${q ? 'search' : 'trending'}?${params}`);
  } catch {
    return json({ error: 'GIPHY cannot be reached.' }, 502);
  }
  if (response.status === 429) return json({ error: 'The GIPHY key’s hourly limit is used up.' }, 429);
  if (!response.ok) return json({ error: 'GIPHY is not answering.' }, 502);

  const body = (await response.json()) as { data?: Gif[] };
  const data = (body.data ?? []).map((gif) => {
    const rendition = gif.images?.fixed_width ?? {};
    return {
      id: gif.id,
      title: gif.title ?? '',
      images: { fixed_width: { url: rendition.url, webp: rendition.webp, width: rendition.width, height: rendition.height } },
    };
  });
  return json({ data });
});
