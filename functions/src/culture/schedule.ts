import { zoneParts } from "../notifications/timezone";
import { zonedTimeToUtc } from "./time";
import { CultureSettings } from "./types";

const TICK_MINUTES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function includesDay(culture: CultureSettings, dayOfWeek: number): boolean {
  return culture.frequency === "daily" || culture.days.includes(dayOfWeek);
}

function toMinutes(time: string): number {
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  return (hh || 0) * 60 + (mm || 0);
}

export function cultureDueKey(culture: CultureSettings, now: Date, timeZone: string): string | null {
  if (!culture.enabled || culture.sourceIds.length === 0) return null;
  const p = zoneParts(now, timeZone);
  if (!includesDay(culture, p.dayOfWeek)) return null;
  const nowMin = p.hour * 60 + p.minute;
  const target = toMinutes(culture.time);
  if (nowMin < target || nowMin >= target + TICK_MINUTES) return null;
  return `${p.dateStr}_${culture.time}`;
}

export function nextSendAfter(culture: CultureSettings, now: Date, timeZone: string): Date {
  // Step by ~24h and read the local date; noon anchor keeps DST shifts from
  // skipping or repeating a calendar day.
  const todayNoon = zonedTimeToUtc(zoneParts(now, timeZone).dateStr, "12:00", timeZone);
  for (let d = 1; d <= 7; d++) {
    const p = zoneParts(new Date(todayNoon.getTime() + d * DAY_MS), timeZone);
    if (includesDay(culture, p.dayOfWeek)) return zonedTimeToUtc(p.dateStr, culture.time, timeZone);
  }
  return new Date(now.getTime() + 7 * DAY_MS);
}
