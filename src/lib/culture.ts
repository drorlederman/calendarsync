import type { Timestamp } from "firebase/firestore";

export const CULTURE_REGIONS = ["tel-aviv", "sharon", "center", "jerusalem", "haifa-north", "south"] as const;
export type CultureRegion = (typeof CULTURE_REGIONS)[number];

export const CULTURE_TYPES = ["cinema", "theater", "music", "venue", "tickets"] as const;
export type CultureType = (typeof CULTURE_TYPES)[number];

export type CultureFrequency = "daily" | "twiceWeekly" | "weekly";

export interface CultureSettings {
  enabled: boolean;
  regions: CultureRegion[];
  types: CultureType[];
  sourceIds: string[];
  taste: string;
  frequency: CultureFrequency;
  days: number[];
  time: string;
  extraPhone: string;
}

export const DEFAULT_CULTURE_SETTINGS: CultureSettings = {
  enabled: false, regions: [], types: [], sourceIds: [], taste: "",
  frequency: "weekly", days: [0], time: "09:00", extraPhone: "",
};

export const REGION_LABELS: Record<CultureRegion, string> = {
  "tel-aviv": "תל אביב",
  sharon: "השרון",
  center: "המרכז",
  jerusalem: "ירושלים",
  "haifa-north": "חיפה והצפון",
  south: "הדרום",
};

export const TYPE_LABELS: Record<CultureType, string> = {
  cinema: "קולנוע",
  theater: "תיאטרון",
  music: "מוזיקה והופעות",
  venue: "מרכזי תרבות",
  tickets: "פורטלי כרטיסים",
};

export const TYPE_EMOJI: Record<CultureType, string> = {
  cinema: "🎬", theater: "🎭", music: "🎵", venue: "🎤", tickets: "🎟️",
};

export const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export interface ClientCultureSource {
  id: string;
  name: string;
  url: string;
  type: CultureType;
  regions: CultureRegion[];
  enabled: boolean;
  lastScan?: { at: Timestamp; ok: boolean; error?: string; eventCount: number };
  consecutiveFailures?: number;
}

export interface ClientCultureEvent {
  id: string;
  sourceId: string;
  title: string;
  category: CultureType;
  venue: string;
  city: string;
  region: CultureRegion;
  dates: Timestamp[];
  url: string;
  description: string | null;
  review: { score: "positive" | "mixed" | "negative"; summary: string; outlet: string } | null;
  recommended: boolean;
}

export function filterSources(
  sources: ClientCultureSource[], regions: CultureRegion[], types: CultureType[],
): ClientCultureSource[] {
  return sources.filter((s) =>
    s.enabled &&
    (regions.length === 0 || s.regions.some((r) => regions.includes(r))) &&
    (types.length === 0 || types.includes(s.type)),
  );
}

export function nextDateInRange(dates: Date[], from: Date, to: Date | null): Date | null {
  return dates.find((d) => d >= from && (to === null || d < to)) ?? null;
}
