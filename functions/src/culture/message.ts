import { SelectedEvent } from "./select";
import { fmtEventDate } from "./time";
import { CultureType } from "./types";

const EMOJI: Record<CultureType, string> = { cinema: "🎬", theater: "🎭", music: "🎵", venue: "🎤", tickets: "🎟️" };

function fmtDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, day: "numeric", month: "numeric" }).format(date);
}

export function buildCultureMessage(
  items: SelectedEvent[], from: Date, to: Date, timeZone: string, appUrl: string,
): string {
  const lines: string[] = [`🎭 מה כדאי לראות — ${fmtDay(from, timeZone)}–${fmtDay(to, timeZone)}`, ""];
  for (const ev of items) {
    lines.push(`${EMOJI[ev.category]} *${ev.title}*`);
    const place = [ev.venue, ev.city].filter(Boolean).join(", ");
    lines.push(`📍 ${place} · 🗓️ ${fmtEventDate(ev.nextDate, timeZone)}`);
    if (ev.review && ev.review.score === "positive") lines.push(`⭐ ${ev.review.summary} (${ev.review.outlet})`);
    lines.push(`🔗 ${ev.url}`);
    lines.push("");
  }
  lines.push(`לכל האירועים: ${appUrl}/culture`);
  return lines.join("\n");
}
