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
  days: number[]; // 0 = Sunday. daily: ignored; weekly: 1 day; twiceWeekly: 2 days
  time: string;   // "HH:MM", Asia/Jerusalem
  extraPhone: string; // optional second WhatsApp recipient for culture messages only ("" = none)
}

export const DEFAULT_CULTURE_SETTINGS: CultureSettings = {
  enabled: false,
  regions: [],
  types: [],
  sourceIds: [],
  taste: "",
  frequency: "weekly",
  days: [0],
  time: "09:00",
  extraPhone: "",
};

/** One entry of the managed catalog, as written in code. */
export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  type: CultureType;
  regions: CultureRegion[];
}

export interface CultureSourceDoc {
  name: string;
  url: string;
  type: CultureType;
  regions: CultureRegion[];
  enabled: boolean;
  lastScan?: { at: FirebaseFirestore.Timestamp; ok: boolean; error?: string; eventCount: number };
  consecutiveFailures?: number;
}

export interface CultureReview {
  score: "positive" | "mixed" | "negative";
  summary: string;
  outlet: string;
}

export interface CultureEventDoc {
  sourceId: string;
  title: string;
  category: CultureType;
  venue: string;
  city: string;
  region: CultureRegion;
  dates: FirebaseFirestore.Timestamp[];
  firstDate: FirebaseFirestore.Timestamp;
  lastDate: FirebaseFirestore.Timestamp;
  url: string;
  description: string | null;
  review: CultureReview | null;
  reviewPending: boolean; // true on create for cinema/theater until lookupReview ran
  recommended: boolean;
  firstSeenAt: FirebaseFirestore.Timestamp;
  lastSeenAt: FirebaseFirestore.Timestamp;
}
