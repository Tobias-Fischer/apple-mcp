/**
 * Flexible, locale-independent date parsing shared by the EventKit and
 * AppleScript code paths.
 *
 * Accepts e.g.:
 *   "2026-03-09", "2026-03-09T14:30", "2026-03-09 14:30:00", "2026-03-09T14:30:00Z",
 *   "2026-03-09T14:30:00+10:00", "March 9, 2026", "9 March 2026",
 *   "Monday, 9 March 2026 at 2:00 PM", "9 March 2026 14:00", "9 March 2026 2pm"
 *
 * Fixes upstream issue #12: ISO timestamps used to silently become midnight,
 * and date-only ISO strings were parsed as UTC (wrong day west of Greenwich).
 */
export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  hasTime: boolean;
}

const DAY_NAMES = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun),?\s*/i;

function fromDate(d: Date, hasTime: boolean): DateParts {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hours: hasTime ? d.getHours() : 0,
    minutes: hasTime ? d.getMinutes() : 0,
    seconds: hasTime ? d.getSeconds() : 0,
    hasTime,
  };
}

export function parseDate(input: string): DateParts {
  const raw = input.trim();

  // ISO 8601: date, optional time, optional zone.
  const iso = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i
  );
  if (iso) {
    const [, y, mo, d, h, mi, s, zone] = iso;
    if (zone) {
      // Explicit zone: convert the instant into local wall-clock time.
      const dt = new Date(raw.replace(" ", "T"));
      if (isNaN(dt.getTime())) throw new Error(`Invalid date: "${input}"`);
      return fromDate(dt, true);
    }
    return {
      year: +y, month: +mo, day: +d,
      hours: h ? +h : 0, minutes: mi ? +mi : 0, seconds: s ? +s : 0,
      hasTime: h !== undefined,
    };
  }

  // Natural language: strip day name, pull out the time, parse the rest.
  let cleaned = raw.replace(DAY_NAMES, "");
  let hours = 0, minutes = 0, seconds = 0, hasTime = false;
  const timeRe = /(?:\bat\s+|,\s*|\s+)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?\s*$/;
  const tm = cleaned.match(timeRe);
  // Only treat a trailing bare number as a time if it has minutes or am/pm
  // (so "9 March 2026" keeps its year).
  if (tm && (tm[2] !== undefined || tm[4] !== undefined)) {
    hours = parseInt(tm[1], 10);
    minutes = tm[2] ? parseInt(tm[2], 10) : 0;
    seconds = tm[3] ? parseInt(tm[3], 10) : 0;
    const ampm = tm[4]?.replace(/\./g, "").toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    hasTime = true;
    cleaned = cleaned.slice(0, tm.index).trim();
  }

  // Bare ISO date left over (e.g. "2026-03-09 at 2pm").
  const isoDate = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    return { year: +isoDate[1], month: +isoDate[2], day: +isoDate[3], hours, minutes, seconds, hasTime };
  }

  const parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${input}"`);
  }
  return { ...fromDate(parsed, false), hours, minutes, seconds, hasTime };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock ISO string (no zone), as the Swift helper expects. */
export function toLocalISO(p: DateParts): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
}

/**
 * For the end of a range: a date without a time means "through the end of
 * that day", so "list events from 9 Nov to 9 Nov" returns that day's events.
 */
export function endOfRange(p: DateParts): DateParts {
  return p.hasTime ? p : { ...p, hours: 23, minutes: 59, seconds: 59 };
}
