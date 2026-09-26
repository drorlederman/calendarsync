import { CultureRegion, CultureReview, CultureSettings, CultureType } from "./types";

export interface SelectableEvent {
  id: string;
  sourceId: string;
  title: string;
  category: CultureType;
  region: CultureRegion;
  venue: string;
  city: string;
  url: string;
  description: string | null;
  dates: Date[];
  recommended: boolean;
  review: CultureReview | null;
}

export type SelectedEvent = SelectableEvent & { nextDate: Date };

export function tasteKeywords(taste: string): string[] {
  return taste.split(/[\s,;.]+/).map((w) => w.trim()).filter((w) => w.length >= 3);
}

export function selectForMessage(
  events: SelectableEvent[], culture: CultureSettings, from: Date, to: Date, limit = 8,
): SelectedEvent[] {
  const sources = new Set(culture.sourceIds);
  const keywords = tasteKeywords(culture.taste).map((k) => k.toLowerCase());
  const scored: Array<{ ev: SelectedEvent; score: number }> = [];

  for (const ev of events) {
    if (!sources.has(ev.sourceId)) continue;
    if (culture.regions.length > 0 && !culture.regions.includes(ev.region)) continue;
    if (culture.types.length > 0 && !culture.types.includes(ev.category)) continue;
    const nextDate = ev.dates.find((d) => d >= from && d < to);
    if (!nextDate) continue;
    const haystack = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
    const tasteHits = keywords.filter((k) => haystack.includes(k)).length;
    scored.push({ ev: { ...ev, nextDate }, score: (ev.recommended ? 100 : 0) + tasteHits * 10 });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.ev.nextDate.getTime() - b.ev.nextDate.getTime())
    .slice(0, limit)
    .map((s) => s.ev);
}
