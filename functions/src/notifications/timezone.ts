// The user is in Israel (Hebrew UI) — hardcode the local timezone for digest
// day-boundaries and message time formatting, same approach as fintics'
// israelNowParts helper.
export const TIMEZONE = "Asia/Jerusalem";

export interface ZoneParts {
  dateStr: string; // YYYY-MM-DD in the given timezone
  hour: number;
  minute: number;
  dayOfWeek: number; // 0 = Sunday
}

const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zoneParts(date: Date, timeZone: string): ZoneParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
    dayOfWeek: WEEKDAY_MAP[parts.weekday] ?? 0,
  };
}

/** [start, end) of "today" in the given timezone, expressed as UTC instants. */
export function localDayBoundsUtc(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = zoneParts(now, timeZone);
  const utcMidnightGuess = new Date(`${parts.dateStr}T00:00:00Z`);
  const guessParts = zoneParts(utcMidnightGuess, timeZone);
  const guessMinutes = guessParts.hour * 60 + guessParts.minute;
  const start = new Date(utcMidnightGuess.getTime() - guessMinutes * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function fmtTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
}

export function fmtDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone, weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(date);
}
