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

function localTimeParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
  };
}

function toDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Midnight of the Jerusalem calendar day containing `date`, as a UTC Date. */
export function startOfLocalDay(date: Date): Date {
  const { year, month, day } = zoneParts(date);
  const targetDay = toDayNumber(year, month, day);
  // Anchor near local midnight (covers UTC+2/+3); iterate using offset at the probe instant.
  let ms = Date.UTC(year, month - 1, day - 1, 21, 0, 0);
  for (let i = 0; i < 4; i++) {
    const lp = localTimeParts(new Date(ms));
    if (lp.year === year && lp.month === month && lp.day === day && lp.hour === 0 && lp.minute === 0) {
      break;
    }
    const currentDay = toDayNumber(lp.year, lp.month, lp.day);
    const minuteDiff = (targetDay - currentDay) * 24 * 60 - (lp.hour * 60 + lp.minute);
    ms += minuteDiff * 60 * 1000;
  }
  return new Date(ms);
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
  let targetMonth = p.month + direction;
  let targetYear = p.year;
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear += 1;
  } else if (targetMonth < 1) {
    targetMonth = 12;
    targetYear -= 1;
  }
  const clampedDay = Math.min(p.day, daysInMonth(targetYear, targetMonth));
  const shifted = new Date(Date.UTC(targetYear, targetMonth - 1, clampedDay, 12, 0, 0));
  return startOfLocalDay(shifted);
}

/**
 * Prev/next is allowed when the neighbor visible range *overlaps* the sync
 * window at all. Containment would permanently disable month navigation, since
 * a 31-day window can never contain a full calendar month plus its padding.
 * Days outside the window are rendered as explicitly uncached by the grids.
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
  // Both ranges are half-open [start, end).
  return range.start.getTime() < window.end.getTime() && range.end.getTime() > window.start.getTime();
}

/** True when the Jerusalem day containing `day` is covered by the sync window. */
export function isDayInSyncWindow(day: Date, now: Date = new Date()): boolean {
  const window = getSyncWindow(now);
  const t = startOfLocalDay(day).getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/** Hebrew label describing the cached sync window, e.g. "14 ביולי – 14 באוגוסט". */
export function syncWindowLabel(now: Date = new Date()): string {
  const { start, end } = getSyncWindow(now);
  const lastDay = addLocalDays(end, -1);
  const fmt = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "long",
  });
  return `${fmt.format(start)} – ${fmt.format(lastDay)}`;
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
