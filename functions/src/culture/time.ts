import { zoneParts, fmtDateTime } from "../notifications/timezone";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Local wall-clock time in `timeZone` → UTC instant. Same guess-and-correct
 * approach as localDayBoundsUtc: read the zone's offset at the naive UTC guess
 * and subtract it. Returns an Invalid Date for impossible dates (e.g. Feb 30).
 */
export function zonedTimeToUtc(dateStr: string, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  const guess = new Date(`${dateStr}T${pad(hh || 0)}:${pad(mm || 0)}:00Z`);
  if (isNaN(guess.getTime()) || guess.toISOString().slice(0, 10) !== dateStr) return new Date(NaN);
  const p = zoneParts(guess, timeZone);
  const asUtc = Date.UTC(
    parseInt(p.dateStr.slice(0, 4), 10), parseInt(p.dateStr.slice(5, 7), 10) - 1,
    parseInt(p.dateStr.slice(8, 10), 10), p.hour, p.minute,
  );
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

/** Cinema dates are stored at local midnight (day only) — format those without a time. */
export function fmtEventDate(date: Date, timeZone: string): string {
  const p = zoneParts(date, timeZone);
  if (p.hour === 0 && p.minute === 0) {
    return new Intl.DateTimeFormat("he-IL", { timeZone, weekday: "short", day: "numeric", month: "long" }).format(date);
  }
  return fmtDateTime(date, timeZone);
}
