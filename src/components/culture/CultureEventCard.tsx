import { TYPE_EMOJI, REGION_LABELS, type ClientCultureEvent } from "@/lib/culture";

const TZ = "Asia/Jerusalem";

function fmtNext(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const dateOnly = parts === "00:00";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "long",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}

export default function CultureEventCard({
  event, nextDate, sourceName,
}: { event: ClientCultureEvent; nextDate: Date; sourceName: string }) {
  const more = event.dates.length - 1;
  return (
    <a
      href={event.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-2xl p-4 transition hover:shadow-sm"
      style={{ border: `1px solid ${event.recommended ? "#22C55E66" : "#E8EDF5"}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold" style={{ color: "#0D1321" }}>
          {TYPE_EMOJI[event.category]} {event.title}
        </h3>
        {event.recommended && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "#DCFCE7", color: "#15803D" }}>
            מומלץ
          </span>
        )}
      </div>
      <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
        📍 {[event.venue, event.city].filter(Boolean).join(", ") || REGION_LABELS[event.region]} · {sourceName}
      </p>
      <p className="text-sm mt-0.5" style={{ color: "#0D1321" }}>
        🗓️ {fmtNext(nextDate)}{more > 0 ? ` (+${more} מועדים)` : ""}
      </p>
      {event.review && event.review.score === "positive" && (
        <p className="text-sm mt-2" style={{ color: "#15803D" }}>⭐ {event.review.summary} ({event.review.outlet})</p>
      )}
      {event.description && <p className="text-sm mt-2" style={{ color: "#5B6477" }}>{event.description}</p>}
    </a>
  );
}
