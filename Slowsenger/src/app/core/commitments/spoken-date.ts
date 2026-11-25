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
