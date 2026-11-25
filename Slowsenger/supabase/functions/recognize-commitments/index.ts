// Supabase Edge Function: suggests commitments from a message just sent in a direct conversation, with the
// recognizer of the research part (research/scripts/llm_recognize.py: the same prompt, answer schema, model
// and effort; the prefilter of research/scripts/common.py in front of it).
//
// The sender's app calls it after each message it sent ({ partner }). It runs only if both of them have
// turned on AI suggestions in their profile (conversation_ai_allowed), and only for the caller's newest
// message in the conversation, if it is at most two minutes old. A message the prefilter finds nothing
// task-like in is not sent on. Otherwise Claude Haiku 5.5 reads it with the messages before it, and every
// commitment or request it finds in that message becomes a proposal with a card in the conversation
// (record_detected_commitment): the person concerned accepts or declines it like any other. A meeting
// proposed with a day or time ("holnap 11-kor gym?") becomes one too, for the other person to accept. The
// day and time said are read into the card's date (spoken-date, below). Suggesting the same thing twice is
// not possible: a suggestion is keyed by the message it started in and its owner.
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

// ─── spoken-date: a copy of it is in supabase/functions/recognize-commitments/index.ts (keep the two the same) ───
// When a deadline or a meeting said in words falls: "holnap 11-kor", "péntekig", "jövő kedden", "december
// 3-án", "tomorrow at 3pm". It reads only what was said, from the time it was said, in the speakers' time
// zone; it guesses nothing else ("majd", "later", "a meeting után" give no date). Hungarian and English.

/** A deadline as the commitments store it: the instant, and whether a time was said (else the day). */
export interface SpokenDate {
  /** ISO instant: the time said, or the local midnight of the day said. */
  due: string;
  hasTime: boolean;
}

const L = '\\p{L}';
const WEEKDAYS: [RegExp, number][] = [
  [new RegExp(`(?<!${L})(vasárnap|sunday)`, 'iu'), 0],
  [new RegExp(`(?<!${L})(hétfő|monday)`, 'iu'), 1],
  [new RegExp(`(?<!${L})(kedd|tuesday)`, 'iu'), 2],
  [new RegExp(`(?<!${L})(szerd[aá]|wednesday)`, 'iu'), 3],
  [new RegExp(`(?<!${L})(csütörtök|thursday)`, 'iu'), 4],
  [new RegExp(`(?<!${L})(péntek|friday)`, 'iu'), 5],
  [new RegExp(`(?<!${L})(szombat|saturday)`, 'iu'), 6],
];
const MONTHS: [string, number][] = [
  ['január|january|jan', 1], ['február|february|feb', 2], ['március|márc|march|mar', 3], ['április|ápr|april|apr', 4],
  ['május|máj|may', 5], ['június|jún|june|jun', 6], ['július|júl|july|jul', 7], ['augusztus|august|aug', 8],
  ['szeptember|szept|september|sept|sep', 9], ['október|okt|october|oct', 10], ['november|nov', 11], ['december|dec', 12],
];
const MONTH_DAY = new RegExp(`(?<!${L})(${MONTHS.map(([names]) => names).join('|')})\\.?\\s*(\\d{1,2})(?!\\d)`, 'iu');
const DAY_MONTH = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.map(([names]) => names).join('|')})(?!${L})`, 'iu');
// 9:30, or 9.30 when -kor (etc.) shows it is a time and not a date
const CLOCK = new RegExp(`(?<!\\d)([01]?\\d|2[0-3])(?::([0-5]\\d)|\\.([0-5]\\d)(?=\\s*-?(kor|ra|re|ig|tól|től)(?!${L})))(?!\\d)`, 'iu');
// 11-kor, 11kor, 9-re, 5-ig, 11 órakor, 11 óra
const HOUR_HU = new RegExp(`(?<!\\d)([01]?\\d|2[0-3])\\s*(?:-?(?:kor|ra|re|ig|tól|től)|\\s*ór[aá]\\p{L}*)(?!${L})`, 'iu');
// 3pm, 11:30 am
const AM_PM = new RegExp(`(?<!\\d)(1[0-2]|0?\\d)(?::([0-5]\\d))?\\s*(am|pm)(?!${L})`, 'iu');
// at 11
const AT_HOUR = new RegExp(`(?<!${L})at\\s+([01]?\\d|2[0-3])(?![\\d:])(?!\\s*(?:st|nd|rd|th))`, 'iu');
const AFTERNOON = new RegExp(`(?<!${L})(délután|du\\.|este|éjjel|afternoon|evening|tonight)(?!${L})`, 'iu');
const NOON = new RegExp(`(?<!${L})(délben|noon)(?!${L})`, 'iu');

/** The calendar day and clock time of an instant in a time zone. */
function localParts(at: Date, timeZone: string): { year: number; month: number; day: number; weekday: number; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(at).map((part) => [part.type, part.value]));
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts['weekday']),
    minutes: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}

/** The instant of a local date and time in a time zone (daylight saving included). */
function zonedInstant(year: number, month: number, day: number, minutes: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const local = localParts(new Date(guess), timeZone);
    const shown = Date.UTC(local.year, local.month - 1, local.day, 0, local.minutes);
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** The time said, in minutes after midnight, or null. */
function timeIn(text: string): number | null {
  if (NOON.test(text)) return 12 * 60;
  const amPm = AM_PM.exec(text);
  if (amPm) {
    const hour = Number(amPm[1]) % 12 + (amPm[3].toLowerCase() === 'pm' ? 12 : 0);
    return hour * 60 + Number(amPm[2] ?? 0);
  }
  let hour: number | null = null;
  let minute = 0;
  const clock = CLOCK.exec(text);
  const at = AT_HOUR.exec(text);
  const hungarian = HOUR_HU.exec(text);
  if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2] ?? clock[3]);
  } else if (at ?? hungarian) {
    hour = Number((at ?? hungarian)![1]);
  }
  if (hour === null) return null;
  // "este 8-kor", "délután 3-kor": in the afternoon
  if (hour < 12 && AFTERNOON.test(text)) hour += 12;
  return hour * 60 + minute;
}

/** When what was said falls, or null if it names no day or time. */
export function spokenDate(text: string | null | undefined, saidAt: Date, timeZone: string): SpokenDate | null {
  if (!text?.trim()) return null;
  const now = localParts(saidAt, timeZone);
  const today = Date.UTC(now.year, now.month - 1, now.day);
  const DAY = 24 * 60 * 60 * 1000;
  let day: number | null = null; // UTC midnight of the local day, for counting days

  if (new RegExp(`(?<!${L})holnaput[áa]n|day after tomorrow`, 'iu').test(text)) day = today + 2 * DAY;
  else if (new RegExp(`(?<!${L})(holnap|tomorrow)`, 'iu').test(text)) day = today + DAY;
  else if (new RegExp(`(?<!${L})(ma|mai|today|tonight)(?!${L})`, 'iu').test(text)) day = today;
  else {
    const date = MONTH_DAY.exec(text) ?? DAY_MONTH.exec(text);
    if (date) {
      const [monthText, dayText] = MONTH_DAY.test(text) ? [date[1], date[2]] : [date[2], date[1]];
      const month = MONTHS.find(([names]) => new RegExp(`^(${names})$`, 'iu').test(monthText))![1];
      const dayOfMonth = Number(dayText);
      if (dayOfMonth >= 1 && dayOfMonth <= 31) {
        day = Date.UTC(now.year, month - 1, dayOfMonth);
        if (day < today) day = Date.UTC(now.year + 1, month - 1, dayOfMonth); // a date gone by: next year's
      }
    } else {
      const weekday = WEEKDAYS.find(([pattern]) => pattern.test(text))?.[1];
      if (weekday !== undefined) {
        const next = new RegExp(`(?<!${L})(jövő|next)(?!${L})`, 'iu').test(text);
        // Its next one (today's if it is today); "jövő"/"next": the one in the week after this
        let ahead = (weekday - now.weekday + 7) % 7;
        if (next) ahead = 7 - ((now.weekday + 6) % 7) + ((weekday + 6) % 7);
        day = today + ahead * DAY;
      }
    }
  }

  const minutes = timeIn(text);
  if (day === null && minutes === null) return null;
  if (day === null) day = minutes! > now.minutes ? today : today + DAY; // only a time: its next one
  const date = new Date(day);
  const at = zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), minutes ?? 0, timeZone);
  return { due: at.toISOString(), hasTime: minutes !== null };
}
// ─── end of spoken-date ───

// ─── The app's side ──────────────────────────────────────────────────────────────────────────────────────

type Language = 'en' | 'hu';
/** The speakers' time zone when the app does not say it. */
const DEFAULT_ZONE = 'Europe/Budapest';

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
  /** The day and time said, if any. */
  due: string | null;
  hasTime: boolean;
  /** A meeting rather than a task. */
  meeting: boolean;
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
 * What the app suggests from the recognizer's items found in the newest turn (older ones were read when
 * they were new), not refused or only offered:
 * - commitments and requests: one per owner, "all" being both of them; an owner the conversation does not
 *   name is left open;
 * - a meeting (a "group_plan" of the two of them) with a day or time said: for the one it was proposed to,
 *   who accepts or declines it like an invite.
 * A suggestion starts in the earliest message it is based on: the request a later "yes" answers is the same
 * suggestion, made only once. The day and time said become its date, from when that message was sent.
 */
export function suggestionsOf(items: Item[], turns: Turn[], letters: Map<string, string>, timeZone = DEFAULT_ZONE): Suggestion[] {
  const byLetter = new Map([...letters].map(([id, letter]) => [letter.toLowerCase(), id]));
  const newest = turns.at(-1)!.id;
  const suggestions: Suggestion[] = [];
  for (const item of items) {
    const meeting = item.kind === 'group_plan';
    if (!['commitment', 'request'].includes(item.kind) && !meeting) continue;
    if (['refused', 'conditional'].includes(item.agreement)) continue;
    if (!item.evidence.includes(newest) || !item.task?.trim()) continue;
    const source = turns.find((turn) => item.evidence.includes(turn.id)) ?? turns.at(-1)!;
    const sentAt = new Date(source.message.created_at);
    const deadline = item.deadline?.trim() || null;
    // A meeting's day and time may be only in its message ("Holnap 11:00-kor lemegyünk gym-be?")
    const when = spokenDate(deadline, sentAt, timeZone) ?? (meeting ? spokenDate(source.message.content, sentAt, timeZone) : null);
    if (meeting && !when && !deadline) continue; // a plan with no day or time is not a meeting yet

    let ownerIds: (string | null)[];
    if (meeting) {
      ownerIds = [[...letters.keys()].find((id) => id !== source.author) ?? null];
    } else {
      const owners = item.owner.map((letter) => letter.trim().toLowerCase());
      if (owners.includes('all')) ownerIds = [...letters.keys()];
      else if (owners.length === 0) ownerIds = [null];
      else if (owners.every((letter) => byLetter.has(letter))) ownerIds = owners.map((letter) => byLetter.get(letter)!);
      else continue; // a letter of nobody here: never guess
    }
    // The card shows a date it understood; one it did not stays in the title, as it was said
    const title = `${item.task.trim()}${deadline && !when ? ` (${deadline})` : ''}`.slice(0, MAX_TITLE).trim();
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
        due: when?.due ?? null,
        hasTime: when?.hasTime ?? false,
        meeting,
      });
    }
  }
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/** The time zone the app says its user is in, if it is a real one. */
function zoneOf(value: unknown): string {
  try {
    if (typeof value === 'string' && value) {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return value;
    }
  } catch {
    // not a time zone
  }
  return DEFAULT_ZONE;
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
  let timeZone = DEFAULT_ZONE;
  try {
    const body = await request.json();
    partner = String(body?.partner ?? '');
    timeZone = zoneOf(body?.timeZone);
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
  for (const suggestion of suggestionsOf(answer.items, turns, letters, timeZone)) {
    const { data: id, error } = await asServer.rpc('record_detected_commitment', {
      p_actor_id: me,
      p_source_message_id: suggestion.sourceMessageId,
      p_item_key: suggestion.itemKey,
      p_title: suggestion.title,
      p_owner_id: suggestion.ownerId,
      p_requested_by: suggestion.requestedBy,
      p_card_text: `${suggestion.meeting ? 'Suggested meeting' : 'Suggested commitment'}: ${suggestion.title}`,
      p_due: suggestion.due,
      p_has_time: suggestion.hasTime,
    });
    if (error) console.error('record_detected_commitment', error.message);
    else if (id) suggested++;
  }
  return json({ suggested });
});
