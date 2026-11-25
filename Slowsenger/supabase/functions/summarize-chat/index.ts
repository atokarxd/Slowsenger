// Supabase Edge Function: sums up the unread part of a conversation for the chat's summary panel
// (src/app/pages/dashboard/chat/chat-summary). Claude Haiku 5.5 gives 3–6 points, the commitments and the
// decisions of those messages, in the conversation's language.
//
// The app calls it when the panel opens ({ thread, since }: the caller's conversation and when they last
// read it). It runs only if everyone in the conversation has turned on AI suggestions in their profile
// (conversation_ai_allowed); otherwise it answers 403 { error: 'consent' }. It reads the messages as the
// caller (their own copy, through row level security): at most the newest 300 since `since`.
//
// What goes to Anthropic: those messages' text and the senders' first names. The key stays here, as the
// secret ANTHROPIC_API_KEY (the same one recognize-commitments uses).
//
// Set up (once): Dashboard → Edge Functions → Deploy a new function → name it "summarize-chat" and paste
// this file; the secret ANTHROPIC_API_KEY is shared by the functions. With the CLI:
//   supabase functions deploy summarize-chat

import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const MODEL = 'claude-haiku-5-5';
// Someone is waiting with the panel open: a summary needs little thinking
const EFFORT = 'low';
const MAX_TOKENS = 4000;
const MAX_MESSAGES = 300;
const MAX_MESSAGE_LENGTH = 1000;

const SYSTEM = `You sum up the unread part of a chat for someone who has been away. The app also keeps a register of commitments (who agreed to do what and by when), so tasks matter most.

Each line is one message: the sender's first name, then the text. The reader's own messages are marked "(you)". Lines from "App" are cards the app posted (commitment invites and suggestions); [GIF] and [file] stand for what was sent.

Give:
- summary: 3 to 6 short points on what happened, the most important first. Speak to the reader as "you".
- commitments: the tasks someone took on or was asked to do in these messages: who (a name as written, "you" for the reader, or null if the messages do not say who), what (short), when (the deadline as it was said, or null). Never guess an owner or a deadline.
- decisions: what was agreed on (a time, a place, a choice), short; none if nothing was.

Write in the language of the conversation. Only what the messages show, never more.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'array', items: { type: 'string' } },
    commitments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          who: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          what: { type: 'string' },
          when: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['who', 'what', 'when'],
        additionalProperties: false,
      },
    },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'commitments', 'decisions'],
  additionalProperties: false,
};

interface MessageRow {
  sender_user_id: string | null;
  content: string | null;
  created_at: string;
  commitment_id: string | null;
  attachment: { kind?: string; title?: string; name?: string } | null;
}

interface Summary {
  summary: string[];
  commitments: { who: string | null; what: string; when: string | null }[];
  decisions: string[];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const THREAD = /^(user|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** One line per message, as the model reads it. */
export function transcriptOf(rows: MessageRow[], me: string, names: Map<string, string>): string {
  return rows.map((row) => {
    const who = row.sender_user_id === null ? 'App' : `${names.get(row.sender_user_id) || 'Someone'}${row.sender_user_id === me ? ' (you)' : ''}`;
    let text = (row.content ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (row.attachment?.kind === 'gif') text = `[GIF] ${row.attachment.title ?? ''}`.trim();
    else if (row.attachment?.kind === 'file') text = `[file] ${row.attachment.name ?? ''}`.trim();
    return `${who}: ${text}`;
  }).join('\n');
}

/** The answer kept to what the panel shows. */
export function tidy(answer: Summary): Summary {
  const strings = (list: unknown) => (Array.isArray(list) ? list : []).map((s) => String(s ?? '').trim()).filter(Boolean);
  return {
    summary: strings(answer?.summary).slice(0, 6),
    commitments: (Array.isArray(answer?.commitments) ? answer.commitments : [])
      .filter((c) => c && String(c.what ?? '').trim())
      .slice(0, 10)
      .map((c) => ({ who: c.who?.trim() || null, what: c.what.trim(), when: c.when?.trim() || null })),
    decisions: strings(answer?.decisions).slice(0, 6),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await asCaller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  const me = auth?.user?.id;
  if (!me) return json({ error: 'Sign in first.' }, 401);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'The AI summary is not set up on the server yet.' }, 503);

  let thread = '';
  let since: string | null = null;
  try {
    const body = await request.json();
    thread = String(body?.thread ?? '');
    since = body?.since && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : null;
  } catch {
    // checked below
  }
  if (!THREAD.test(thread)) return json({ error: 'Which conversation?' }, 400);

  const [kind, id] = thread.split(':');
  const conversation = kind === 'group' ? thread : `dm:${[me, id].sort().join(':')}`;
  const { data: allowed } = await asCaller.rpc('conversation_ai_allowed', { p_key: conversation });
  if (allowed !== true) return json({ error: 'consent' }, 403);

  const { data: own } = await asCaller
    .from('unified_threads')
    .select('id')
    .eq('owner_user_id', me)
    .eq('external_thread_id', thread)
    .maybeSingle();
  if (!own) return json({ error: 'No such conversation.' }, 404);
  let query = asCaller
    .from('unified_messages')
    .select('sender_user_id, content, created_at, commitment_id, attachment')
    .eq('thread_id', own.id);
  if (since) query = query.gt('created_at', since);
  const { data: rows } = await query.order('created_at', { ascending: false }).limit(MAX_MESSAGES);
  const messages = ((rows ?? []) as MessageRow[]).reverse();
  if (!messages.some((row) => row.sender_user_id !== me && row.content?.trim())) {
    return json({ summary: [], commitments: [], decisions: [], count: 0 });
  }

  const senders = [...new Set(messages.map((row) => row.sender_user_id).filter((s): s is string => !!s))];
  const { data: profiles } = await asCaller.from('profiles').select('id, display_name').in('id', senders);
  const names = new Map(((profiles ?? []) as { id: string; display_name: string | null }[])
    .map((p) => [p.id, (p.display_name ?? '').trim().split(/\s+/)[0]] as [string, string]));

  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: transcriptOf(messages, me, names) }],
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'The AI key on the server is not valid.' }, 503);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy; try again in a minute.' }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: 'The AI is not answering; try again later.' }, 502);
    throw error;
  }
  if (response.stop_reason === 'refusal') return json({ error: 'The AI would not sum this conversation up.' }, 422);
  const text = response.content.find((block) => block.type === 'text');
  let answer: Summary;
  try {
    answer = JSON.parse(text?.type === 'text' ? text.text : '');
  } catch {
    return json({ error: 'The AI did not finish the summary; try again.' }, 502);
  }
  return json({ ...tidy(answer), count: messages.length });
});
