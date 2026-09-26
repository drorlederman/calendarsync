import { zoneParts } from "./timezone";

export type TimestampLike = { toMillis: () => number; toDate: () => Date };

export interface NagReminderInput {
  nagEnabled?: boolean;
  status?: string;
  remindAt?: TimestampLike | null;
  dueAt?: TimestampLike | null;
  /** May be a write sentinel (FieldValue) on freshly constructed docs — ignored then. */
  createdAt?: { toDate?: () => Date } | null;
}

export const DEFAULT_NAG_HOUR = 9;
export const DEFAULT_NAG_MINUTE = 0;
export const NAG_KEY_KEEP_DAYS = 7;

/** Local clock (hour/minute) for the daily nag: remindAt → dueAt → 09:00. */
export function nagClockParts(
  reminder: NagReminderInput,
  timeZone: string,
): { hour: number; minute: number; source: "remindAt" | "dueAt" | "default" } {
  if (reminder.remindAt) {
    const p = zoneParts(reminder.remindAt.toDate(), timeZone);
    return { hour: p.hour, minute: p.minute, source: "remindAt" };
  }
  if (reminder.dueAt) {
    const p = zoneParts(reminder.dueAt.toDate(), timeZone);
    return { hour: p.hour, minute: p.minute, source: "dueAt" };
  }
  return { hour: DEFAULT_NAG_HOUR, minute: DEFAULT_NAG_MINUTE, source: "default" };
}

/**
 * First calendar date (YYYY-MM-DD in timeZone) on which a nag may fire.
 * With remindAt/dueAt: the day *after* that anchor (one-shots cover the first day).
 * With neither: the createdAt local date (or today if missing).
 */
export function nagStartDateStr(
  reminder: NagReminderInput,
  timeZone: string,
  todayStr: string,
): string {
  const anchor = reminder.remindAt ?? reminder.dueAt;
  if (anchor) {
    return nextLocalDateStr(zoneParts(anchor.toDate(), timeZone).dateStr);
  }
  if (typeof reminder.createdAt?.toDate === "function") {
    return zoneParts(reminder.createdAt.toDate(), timeZone).dateStr;
  }
  return todayStr;
}

function nextLocalDateStr(dateStr: string): string {
  // dateStr is a calendar date in the user's zone; advance by one civil day via UTC noon
  // so DST edges don't shift the Y-M-D string incorrectly.
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function nagDedupKey(reminderId: string, dateStr: string): string {
  return `nag_${reminderId}_${dateStr}`;
}

export function shouldFireNag(args: {
  reminderId: string;
  reminder: NagReminderInput;
  now: Date;
  timeZone: string;
  tickWindowMinutes?: number;
}): { fire: boolean; key: string | null } {
  const { reminderId, reminder, now, timeZone } = args;
  const tickWindow = args.tickWindowMinutes ?? 5;

  if (!reminder.nagEnabled || reminder.status !== "open") {
    return { fire: false, key: null };
  }

  const parts = zoneParts(now, timeZone);
  const startDate = nagStartDateStr(reminder, timeZone, parts.dateStr);
  if (parts.dateStr < startDate) return { fire: false, key: null };

  const clock = nagClockParts(reminder, timeZone);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const targetMinutes = clock.hour * 60 + clock.minute;
  if (nowMinutes < targetMinutes || nowMinutes >= targetMinutes + tickWindow) {
    return { fire: false, key: null };
  }

  return { fire: true, key: nagDedupKey(reminderId, parts.dateStr) };
}

/** Drop nag_* keys older than keepDays relative to todayStr (YYYY-MM-DD). */
export function pruneNagKeys(
  tasks: Record<string, boolean>,
  todayStr: string,
  keepDays: number = NAG_KEY_KEEP_DAYS,
): Record<string, boolean> {
  const cutoff = new Date(`${todayStr}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(tasks)) {
    if (!key.startsWith("nag_")) {
      out[key] = val;
      continue;
    }
    const dateStr = key.slice(key.lastIndexOf("_") + 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr < cutoffStr) continue;
    out[key] = val;
  }
  return out;
}
