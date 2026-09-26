import { createHash } from "crypto";
import { CultureRegion } from "./types";
import { zonedTimeToUtc } from "./time";

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function eventId(sourceId: string, title: string): string {
  return createHash("sha1").update(`${sourceId}|${normalizeTitle(title)}`).digest("hex").slice(0, 24);
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;

/** "YYYY-MM-DD" (stored at local midnight) or "YYYY-MM-DDTHH:mm" local → UTC Date. */
export function parseLocalDate(s: string, timeZone: string): Date | null {
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  const d = zonedTimeToUtc(m[1], m[2] ?? "00:00", timeZone);
  return isNaN(d.getTime()) ? null : d;
}

export interface ValidEvent {
  id: string;
  title: string;
  venue: string;
  city: string;
  region: CultureRegion;
  dates: Date[];
  url: string;
  description: string | null;
}

const MAX_DATES = 30;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

export function validateScanResult(
  raw: unknown,
  source: { id: string; url: string; regions: CultureRegion[] },
  now: Date,
  horizonDays = 14,
): ValidEvent[] {
  const list = (raw as { events?: unknown } | null)?.events;
  if (!Array.isArray(list)) return [];

  const sourceHost = bareHost(new URL(source.url).hostname);
  // Keep shows that started up to 12h ago (tonight's show scanned at 03:00 is still "today").
  const minMs = now.getTime() - 12 * 60 * 60 * 1000;
  const maxMs = now.getTime() + horizonDays * 24 * 60 * 60 * 1000;
  const byId = new Map<string, ValidEvent>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title, 200);
    if (!title) continue;

    let region = o.region as CultureRegion;
    if (!source.regions.includes(region)) {
      if (source.regions.length !== 1) continue;
      region = source.regions[0];
    }

    let url = source.url;
    try {
      const u = new URL(str(o.url, 1000));
      const h = bareHost(u.hostname);
      if (u.protocol === "https:" && (h === sourceHost || h.endsWith(`.${sourceHost}`))) url = u.toString();
    } catch { /* keep source.url */ }

    const rawDates = Array.isArray(o.dates) ? o.dates : [];
    const dates = rawDates
      .map((d) => (typeof d === "string" ? parseLocalDate(d, "Asia/Jerusalem") : null))
      .filter((d): d is Date => d !== null && d.getTime() >= minMs && d.getTime() <= maxMs);
    if (dates.length === 0) continue;

    const id = eventId(source.id, title);
    const existing = byId.get(id);
    const allMs = new Set([...(existing?.dates ?? []), ...dates].map((d) => d.getTime()));
    const merged = [...allMs].sort((a, b) => a - b).slice(0, MAX_DATES).map((ms) => new Date(ms));

    byId.set(id, {
      id,
      title: existing?.title ?? title,
      venue: existing?.venue || str(o.venue, 200),
      city: existing?.city || str(o.city, 100),
      region,
      dates: merged,
      url: existing?.url ?? url,
      description: existing?.description ?? (str(o.description, 500) || null),
    });
  }
  return [...byId.values()];
}

export function pickSourcesToScan(
  sources: Array<{ id: string; enabled: boolean; lastScanAtMs: number | null }>,
  selectedIds: Set<string>,
  max: number,
): string[] {
  return sources
    .filter((s) => s.enabled && selectedIds.has(s.id))
    .sort((a, b) => (a.lastScanAtMs ?? -1) - (b.lastScanAtMs ?? -1))
    .slice(0, max)
    .map((s) => s.id);
}
