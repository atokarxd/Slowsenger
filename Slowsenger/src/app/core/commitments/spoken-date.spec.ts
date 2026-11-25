import { spokenDate } from './spoken-date';

describe('spokenDate', () => {
  const ZONE = 'Europe/Budapest';
  // Said on Wednesday 25 November 2026, 10:00 in Budapest (09:00 UTC)
  const said = new Date('2026-11-25T09:00:00.000Z');
  const at = (text: string) => spokenDate(text, said, ZONE);
  /** Local midnight (a day) or local time in Budapest, as the instant it is (UTC+1 in winter). */
  const day = (date: string) => ({ due: new Date(`${date}T00:00:00+01:00`).toISOString(), hasTime: false });
  const time = (date: string, clock: string) => ({ due: new Date(`${date}T${clock}:00+01:00`).toISOString(), hasTime: true });

  it('reads the days said in words', () => {
    expect(at('holnap')).toEqual(day('2026-11-26'));
    expect(at('Holnapra')).toEqual(day('2026-11-26'));
    expect(at('holnapután')).toEqual(day('2026-11-27'));
    expect(at('ma')).toEqual(day('2026-11-25'));
    expect(at('tomorrow')).toEqual(day('2026-11-26'));
    expect(at('the day after tomorrow')).toEqual(day('2026-11-27'));
  });

  it('takes a weekday as its next one, today\'s if it is today, and "jövő" as the week after', () => {
    expect(at('péntekig')).toEqual(day('2026-11-27'));
    expect(at('pénteken')).toEqual(day('2026-11-27'));
    expect(at('hétfőre')).toEqual(day('2026-11-30'));
    expect(at('szerdán')).toEqual(day('2026-11-25'));
    expect(at('by Friday')).toEqual(day('2026-11-27'));
    expect(at('jövő kedden')).toEqual(day('2026-12-01'));
    expect(at('jövő hét péntekig')).toEqual(day('2026-12-04'));
    expect(at('next Monday')).toEqual(day('2026-11-30'));
  });

  it('reads dates with month names, next year\'s if gone by', () => {
    expect(at('december 3-án')).toEqual(day('2026-12-03'));
    expect(at('nov. 28-ig')).toEqual(day('2026-11-28'));
    expect(at('3rd of December')).toEqual(day('2026-12-03'));
    expect(at('január 10')).toEqual(day('2027-01-10'));
  });

  it('reads the time said, with the day', () => {
    expect(at('Holnap 11:00-kor')).toEqual(time('2026-11-26', '11:00'));
    expect(at('holnap 11-kor')).toEqual(time('2026-11-26', '11:00'));
    expect(at('holnap 9.30-kor')).toEqual(time('2026-11-26', '09:30'));
    expect(at('pénteken 10 órakor')).toEqual(time('2026-11-27', '10:00'));
    expect(at('holnap este 8-kor')).toEqual(time('2026-11-26', '20:00'));
    expect(at('holnap délután 3-ra')).toEqual(time('2026-11-26', '15:00'));
    expect(at('holnap délben')).toEqual(time('2026-11-26', '12:00'));
    expect(at('tomorrow at 3pm')).toEqual(time('2026-11-26', '15:00'));
    expect(at('Friday at 11')).toEqual(time('2026-11-27', '11:00'));
    expect(at('tomorrow 11:30 am')).toEqual(time('2026-11-26', '11:30'));
  });

  it('takes a time alone as its next one: today if still ahead, else tomorrow', () => {
    expect(at('11-kor')).toEqual(time('2026-11-25', '11:00'));
    expect(at('9-re')).toEqual(time('2026-11-26', '09:00'));
  });

  it('keeps to the time zone, summer time included', () => {
    const summer = spokenDate('holnap 11-kor', new Date('2026-07-01T08:00:00.000Z'), ZONE);
    expect(summer).toEqual({ due: '2026-07-02T09:00:00.000Z', hasTime: true }); // UTC+2
    const late = spokenDate('holnap', new Date('2026-11-25T23:30:00.000Z'), ZONE); // already the 26th in Budapest
    expect(late).toEqual(day('2026-11-27'));
  });

  it('guesses nothing from what names no day or time', () => {
    for (const text of ['majd', 'later', 'a meeting után', 'jövő héten', 'kedvesen', '28-ig', '2026-ra', 'mama', null, '']) {
      expect(at(text as string)).toBeNull();
    }
  });
});
