export const TIMEZONE = "Asia/Jerusalem";

export type CalendarView = "agenda" | "week" | "month";

export type SyncWindow = { start: Date; end: Date };
export type VisibleRange = { start: Date; end: Date };

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function zoneParts(date: Date): { dateStr: string; dayOfWeek: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAY_MAP[parts.weekday] ?? 0,
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
  };
}

/** Midnight of the Jerusalem calendar day containing `date`, as a UTC Date. */
export function startOfLocalDay(date: Date): Date {
  const { dateStr } = zoneParts(date);
  // Probe: interpret dateStr as UTC midnight, then subtract the Jerusalem offset at that instant.
  const utcMidnightGuess = new Date(`${dateStr}T00:00:00Z`);
  const offsetFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const op = Object.fromEntries(offsetFmt.formatToParts(utcMidnightGuess).map((p) => [p.type, p.value]));
  const guessMinutes = (parseInt(op.hour, 10) % 24) * 60 + parseInt(op.minute, 10);
  return new Date(utcMidnightGuess.getTime() - guessMinutes * 60 * 1000);
}

export function dayKey(date: Date): string {
  return zoneParts(date).dateStr;
}

export function addLocalDays(date: Date, days: number): Date {
  // Advance by calendar days in Jerusalem by reconstructing from Y-M-D parts.
  const p = zoneParts(date);
  // Use UTC noon on a Date built from parts, then re-snap — avoids DST edge issues for day arithmetic.
  const utcNoon = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0));
  return startOfLocalDay(utcNoon);
}

export function getWeekRange(anchor: Date): VisibleRange {
  const p = zoneParts(anchor);
  const start = addLocalDays(startOfLocalDay(anchor), -p.dayOfWeek); // back to Sunday
  const end = addLocalDays(start, 7);
  return { start, end };
}

export function getMonthRange(anchor: Date): VisibleRange {
  const p = zoneParts(anchor);
  const start = startOfLocalDay(new Date(Date.UTC(p.year, p.month - 1, 1, 12, 0, 0)));
  const end = startOfLocalDay(new Date(Date.UTC(p.year, p.month, 1, 12, 0, 0))); // month is 1-indexed; Date.UTC month is 0-indexed so p.month == next month index
  return { start, end };
}

export function getVisibleRange(view: CalendarView, anchor: Date): VisibleRange | null {
  if (view === "agenda") return null;
  return view === "week" ? getWeekRange(anchor) : getMonthRange(anchor);
}

/**
 * Sync window matching functions/src/calendar/sync.ts:
 * windowStart = now - 1 day, windowEnd = now + 30 days.
 * We expose half-open [startOf(yesterday), startOf(today+31)) so day-level
 * comparisons stay clean and match "events through the end of today+30".
 */
export function getSyncWindow(now: Date = new Date()): SyncWindow {
  const todayStart = startOfLocalDay(now);
  const start = addLocalDays(todayStart, -1);
  const end = addLocalDays(todayStart, 31); // exclusive end after the +30th day
  return { start, end };
}

export function shiftAnchor(view: "week" | "month", anchor: Date, direction: -1 | 1): Date {
  if (view === "week") return addLocalDays(startOfLocalDay(anchor), direction * 7);
  const p = zoneParts(anchor);
  // Land on the same day-of-month in the neighbor month (clamp via Date.UTC overflow is fine for anchor).
  const shifted = new Date(Date.UTC(p.year, p.month - 1 + direction, p.day, 12, 0, 0));
  return startOfLocalDay(shifted);
}

/**
 * Prev/next is allowed only when the *entire* neighbor visible range sits
 * inside the sync window [window.start, window.end).
 */
export function canNavigate(
  view: "week" | "month",
  anchor: Date,
  direction: -1 | 1,
  now: Date = new Date()
): boolean {
  const neighborAnchor = shiftAnchor(view, anchor, direction);
  const range = view === "week" ? getWeekRange(neighborAnchor) : getMonthRange(neighborAnchor);
  const window = getSyncWindow(now);
  return range.start.getTime() >= window.start.getTime() && range.end.getTime() <= window.end.getTime();
}

export function periodLabel(view: "week" | "month", anchor: Date): string {
  if (view === "month") {
    return new Intl.DateTimeFormat("he-IL", {
      timeZone: TIMEZONE,
      month: "long",
      year: "numeric",
    }).format(anchor);
  }
  const { start, end } = getWeekRange(anchor);
  const lastDay = addLocalDays(end, -1);
  const fmt = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
  });
  return `${fmt.format(start)} – ${fmt.format(lastDay)}`;
}

/** Sunday-start padded grid of local midnights covering the month of `anchor`. */
export function getMonthGridDays(anchor: Date): Date[] {
  const { start: monthStart, end: monthEnd } = getMonthRange(anchor);
  const gridStart = getWeekRange(monthStart).start;
  // Last day of month is the day before monthEnd; take that day's week end.
  const lastDay = addLocalDays(monthEnd, -1);
  const gridEnd = getWeekRange(lastDay).end;
  const days: Date[] = [];
  for (let d = gridStart; d.getTime() < gridEnd.getTime(); d = addLocalDays(d, 1)) {
    days.push(d);
  }
  return days;
}
