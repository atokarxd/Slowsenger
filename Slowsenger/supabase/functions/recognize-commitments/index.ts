// Supabase Edge Function: suggests commitments from a message just sent in a direct conversation, with the
// recognizer of the research part (research/scripts/llm_recognize.py: the same prompt, answer schema, model
// and effort; the prefilter of research/scripts/common.py in front of it).
//
// The sender's app calls it after each message it sent ({ partner }). It runs only if both of them have
// turned on AI suggestions in their profile (conversation_ai_allowed), and only for the caller's newest
// message in the conversation, if it is at most two minutes old. A message the prefilter finds nothing
// task-like in is not sent on. Otherwise Claude Haiku 5.5 reads it with the messages before it, and every
// commitment or request it finds in that message becomes a proposal with a card in the conversation
// (record_detected_commitment): the person concerned accepts or declines it like any other. Suggesting the
// same thing twice is not possible: a suggestion is keyed by the message it started in and its owner.
//
// What goes to Anthropic: the text of the last few messages of the conversation and the two first names.
// The key stays here, as the secret ANTHROPIC_API_KEY.
//
// Set up (once): Dashboard → Edge Functions → Deploy a new function → name it "recognize-commitments" and
// paste this file; then Edge Functions → Secrets → add ANTHROPIC_API_KEY. With the CLI:
//   supabase functions deploy recognize-commitments
//   supabase secrets set ANTHROPIC_API_KEY=...

import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const MODEL = 'claude-haiku-5-5';
const EFFORT = 'medium';
const MAX_TOKENS = 16000;
/** How many messages the recognizer reads: the new one and the ones before it. */
const WINDOW = 12;
/** Only a message just sent is read: calling it again later for an old one does nothing. */
const FRESH_MS = 2 * 60 * 1000;
const MAX_SUGGESTIONS = 3;
const MAX_TITLE = 120;

// ─── From the research part, word for word (research/scripts/llm_recognize.py) ───────────────────────────

const SYSTEM = `You read short excerpts of team meetings or group chats and find the commitments in them, for a system that keeps a register of who agreed to do what and by when. The system only makes suggestions: the person concerned confirms each one in the app. So your job is to say what the conversation actually shows, never more.

Each turn starts with its id in brackets and the speaker's letter (with a role or name if known).

For every task-like utterance, give an item:
- kind: "commitment" (someone takes a task on: volunteers, accepts a request, or is assigned one without refusing), "request" (someone is asked, no acceptance yet), "offer" (conditional: "if you need it, I can..."), "modification" (an existing commitment's task or deadline changes), "withdrawal" (someone gives a commitment back), "group_plan" (the group plans or decides something without a concrete task owner, e.g. a meeting date).
- task: what is to be done, short, in the language of the conversation.
- owner: the speaker letters of who will do it; ["all"] only if explicitly everyone ("each of you", "mindenki"); [] if the conversation does not say who. Never guess an owner.
- deadline: the deadline as it was said ("by Friday", "péntekig", "after the meeting"), or null if none was said. Never infer a date; "majd" or "later" is not a deadline.
- agreement: "self", "accepted", "assigned", "conditional", "none" or "refused".
- evidence: the ids of the turns it is based on.

Not tasks: things done right now during the meeting ("I will present...", "go to the next slide", "I'm sending the link now"), reports of things already done, jokes and hypotheticals.

expected_action for the whole excerpt:
- "suggest": there is at least one commitment with a clear owner (letters or "all");
- "clarify": there is a task, but its owner is missing or uncertain, or it is only a conditional offer or an unanswered request;
- "none": nothing that could become a commitment.

uncertainty: one short sentence on what is unclear, or an empty string.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['commitment', 'request', 'offer', 'modification', 'withdrawal', 'group_plan'] },
          task: { type: 'string' },
          owner: { type: 'array', items: { type: 'string' } },
          deadline: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          agreement: { type: 'string', enum: ['self', 'accepted', 'assigned', 'conditional', 'none', 'refused'] },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'task', 'owner', 'deadline', 'agreement', 'evidence'],
        additionalProperties: false,
      },
    },
    expected_action: { type: 'string', enum: ['suggest', 'clarify', 'none'] },
    uncertainty: { type: 'string' },
  },
  required: ['items', 'expected_action', 'uncertainty'],
  additionalProperties: false,
};

// The prefilter, with Python's \w and \b (letters of every language, not only a–z).
const W = '[\\p{L}\\p{N}_]';
export const PREFILTER: Record<Language, RegExp> = {
  en: new RegExp(
    `(?<!${W})(i'll|i will|i'm going to|i'm gonna|i can|let me|we'll|we will|we're gonna|you'll|you will|you're gonna|` +
      `you're going to|supposed to|could you|can you|would you|will you|you could|everyone|each|` +
      `next (meeting|time|week)|by (monday|tuesday|wednesday|thursday|friday|tomorrow)|deadline|action)(?!${W})`,
    'iu',
  ),
  hu: new RegExp(
    `(vállal|majd|megcsinál|elkészít|megír|megnéz|átnéz|elküld|átküld|feltölt|elvisz|elintéz|ránéz|utánanéz|` +
      `mindenki|valaki|${W}+(nád|néd)(?!${W})|${W}+ig(?!${W})|holnap|hétfő|kedd|szerd|csütörtök|péntek|szombat|vasárnap|jövő hét)`,
    'iu',
  ),
};

// ─── The app's side ──────────────────────────────────────────────────────────────────────────────────────

type Language = 'en' | 'hu';

interface Item {
  kind: string;
  task: string;
  owner: string[];
  deadline: string | null;
  agreement: string;
  evidence: string[];
}

interface MessageRow {
  id: string;
  sender_user_id: string | null;
  content: string | null;
  created_at: string;
  commitment_id: string | null;
  attachment: unknown;
}

interface Turn {
  id: string;
  message: MessageRow;
  author: string;
}

interface Suggestion {
  sourceMessageId: string;
  itemKey: string;
  title: string;
  ownerId: string | null;
  requestedBy: string | null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Typed apostrophes (’) count as the plain one the prefilter knows. */
function plain(text: string): string {
  return text.replace(/[’‘]/g, "'");
}

/** Hungarian or English, by the conversation's letters and most common words. */
export function languageOf(texts: string[]): Language {
  const text = plain(texts.join('\n'));
  const count = (pattern: RegExp) => (text.match(pattern) ?? []).length;
  const hu = count(/[áéíóöőúüű]/giu) + count(new RegExp(`(?<!${W})(és|hogy|nem|igen|szia|meg|kell|lesz|van|majd|akkor|ezt|azt|köszi|oké)(?!${W})`, 'giu'));
  const en = count(new RegExp(`(?<!${W})(the|and|you|to|is|it|i|we|will|can|of|for|this|that|yes|no|please|thanks)(?!${W})`, 'giu'));
  return en > hu ? 'en' : 'hu';
}

/** A message people wrote (not a card, a GIF or a file). */
function isText(row: MessageRow): boolean {
  return !!row.sender_user_id && !row.commitment_id && !row.attachment && !!row.content?.trim();
}

/** The excerpt as the recognizer of the research part reads it: one line per turn, its id and speaker. */
export function excerptOf(turns: Turn[], letters: Map<string, string>, names: Map<string, string>, language: Language): string {
  const who = (id: string) => `${letters.get(id)}${names.get(id) ? ` (${names.get(id)})` : ''}`;
  // Both people of the conversation, also one who has not written in these turns yet (one line the research excerpts did not need)
  const people = [...letters.keys()].map(who).join(', ');
  const lines = turns.map((turn) => `[${turn.id}] ${who(turn.author)}: ${(turn.message.content ?? '').replace(/\s+/g, ' ').trim()}`);
  return `Language: ${language}\n\nParticipants: ${people}\n\n${lines.join('\n')}`;
}

/**
 * What the app suggests from the recognizer's items: commitments and requests found in the newest turn
 * (older ones were read when they were new), not refused or only offered; one per owner, "all" being both
 * of them; an owner the conversation does not name is left open. A suggestion starts in the earliest
 * message it is based on: the request a later "yes" answers is the same suggestion, made only once.
 */
export function suggestionsOf(items: Item[], turns: Turn[], letters: Map<string, string>): Suggestion[] {
  const byLetter = new Map([...letters].map(([id, letter]) => [letter.toLowerCase(), id]));
  const newest = turns.at(-1)!.id;
  const suggestions: Suggestion[] = [];
  for (const item of items) {
    if (!['commitment', 'request'].includes(item.kind) || ['refused', 'conditional'].includes(item.agreement)) continue;
    if (!item.evidence.includes(newest) || !item.task?.trim()) continue;
    const owners = item.owner.map((letter) => letter.trim().toLowerCase());
    let ownerIds: (string | null)[];
    if (owners.includes('all')) ownerIds = [...letters.keys()];
    else if (owners.length === 0) ownerIds = [null];
    else if (owners.every((letter) => byLetter.has(letter))) ownerIds = owners.map((letter) => byLetter.get(letter)!);
    else continue; // a letter of nobody here: never guess
    const source = turns.find((turn) => item.evidence.includes(turn.id)) ?? turns.at(-1)!;
    const deadline = item.deadline?.trim();
    const title = `${item.task.trim()}${deadline ? ` (${deadline})` : ''}`.slice(0, MAX_TITLE).trim();
    for (const ownerId of new Set(ownerIds)) {
      const key = ownerId ?? 'none';
      if (suggestions.some((s) => s.sourceMessageId === source.message.id && s.itemKey === key)) continue;
      suggestions.push({
        sourceMessageId: source.message.id,
        itemKey: key,
        title,
        ownerId,
        // Who asked: whoever wrote the message it started in, unless they took it on themselves
        requestedBy: source.author !== ownerId ? source.author : null,
      });
    }
  }
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/** The recognizer's items, or why there are none. */
async function recognize(apiKey: string, excerpt: string): Promise<{ items: Item[] } | { error: Response } | { skipped: string }> {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: excerpt }],
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { error: json({ error: 'The AI key on the server is not valid.' }, 503) };
    if (error instanceof Anthropic.RateLimitError) return { error: json({ error: 'The AI is busy; try again later.' }, 429) };
    if (error instanceof Anthropic.APIError) return { error: json({ error: 'The AI is not answering.' }, 502) };
    throw error;
  }
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return { skipped: response.stop_reason };
  const text = response.content.find((block) => block.type === 'text');
  try {
    const answer = JSON.parse(text?.type === 'text' ? text.text : '');
    return { items: Array.isArray(answer?.items) ? answer.items : [] };
  } catch {
    return { skipped: 'no-answer' };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await asCaller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  const me = auth?.user?.id;
  if (!me) return json({ error: 'Sign in first.' }, 401);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI suggestions are not set up on the server yet.' }, 503);

  let partner = '';
  try {
    partner = String((await request.json())?.partner ?? '');
  } catch {
    // checked below
  }
  if (!UUID.test(partner) || partner === me) return json({ error: 'Whose conversation?' }, 400);

  const conversation = `dm:${[me, partner].sort().join(':')}`;
  const { data: allowed } = await asCaller.rpc('conversation_ai_allowed', { p_key: conversation });
  if (allowed !== true) return json({ suggested: 0, skipped: 'consent' });

  // The caller's own copy of the conversation, read as them
  const { data: thread } = await asCaller
    .from('unified_threads')
    .select('id')
    .eq('owner_user_id', me)
    .eq('external_thread_id', `user:${partner}`)
    .maybeSingle();
  if (!thread) return json({ suggested: 0, skipped: 'no-new-message' });
  const { data: rows } = await asCaller
    .from('unified_messages')
    .select('id, sender_user_id, content, created_at, commitment_id, attachment')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: false })
    .limit(WINDOW * 3);
  const texts = ((rows ?? []) as MessageRow[]).filter(isText).reverse();
  const last = texts.findLastIndex((row) => row.sender_user_id === me);
  if (last < 0 || Date.now() - Date.parse(texts[last].created_at) > FRESH_MS) {
    return json({ suggested: 0, skipped: 'no-new-message' });
  }
  const window = texts.slice(Math.max(0, last - WINDOW + 1), last + 1);
  const language = languageOf(window.map((row) => row.content ?? ''));
  if (!PREFILTER[language].test(plain(window.at(-1)!.content ?? ''))) return json({ suggested: 0, skipped: 'prefilter' });

  // Letters in the order they speak, then the one who has not yet; first names only
  const letters = new Map<string, string>();
  for (const id of [...window.map((row) => row.sender_user_id!), me, partner]) {
    if (!letters.has(id)) letters.set(id, String.fromCharCode(65 + letters.size));
  }
  const { data: profiles } = await asCaller.from('profiles').select('id, display_name').in('id', [me, partner]);
  const names = new Map(((profiles ?? []) as { id: string; display_name: string | null }[])
    .map((p) => [p.id, (p.display_name ?? '').trim().split(/\s+/)[0]] as [string, string])
    .filter(([, name]) => !!name));
  const turns: Turn[] = window.map((message, i) => ({ id: `t${i + 1}`, message, author: message.sender_user_id! }));

  const answer = await recognize(apiKey, excerptOf(turns, letters, names, language));
  if ('error' in answer) return answer.error;
  if ('skipped' in answer) return json({ suggested: 0, skipped: answer.skipped });

  const asServer = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let suggested = 0;
  for (const suggestion of suggestionsOf(answer.items, turns, letters)) {
    const { data: id, error } = await asServer.rpc('record_detected_commitment', {
      p_actor_id: me,
      p_source_message_id: suggestion.sourceMessageId,
      p_item_key: suggestion.itemKey,
      p_title: suggestion.title,
      p_owner_id: suggestion.ownerId,
      p_requested_by: suggestion.requestedBy,
      p_card_text: `Suggested commitment: ${suggestion.title}`,
    });
    if (error) console.error('record_detected_commitment', error.message);
    else if (id) suggested++;
  }
  return json({ suggested });
});
