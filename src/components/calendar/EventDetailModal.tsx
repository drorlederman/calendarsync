"use client";

import { X, Video, MapPin, BellPlus, Link2 } from "lucide-react";
import { EventDoc } from "@/lib/types";
import { TIMEZONE } from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

function timeRangeLabel(event: EventRow): string {
  if (event.allDay) return "כל היום";
  const fmt = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = fmt.format(event.start.toDate());
  const endTime = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(event.end.toDate());
  return `${start} – ${endTime}`;
}

export default function EventDetailModal({
  event,
  onClose,
  onAddReminder,
}: {
  event: EventRow;
  onClose: () => void;
  onAddReminder?: (event: EventRow) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(13,19,33,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-lg"
        style={{ border: "1px solid #E8EDF5" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0 mt-1.5"
              style={{ background: event.color }}
            />
            <h2 className="text-lg font-semibold leading-snug" style={{ color: "#0D1321" }}>
              {event.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור" className="p-1 shrink-0">
            <X size={18} color="#5B6477" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          <p className="text-sm" style={{ color: "#5B6477" }}>{timeRangeLabel(event)}</p>

          {event.location && (
            <p className="text-sm flex items-center gap-1.5" style={{ color: "#5B6477" }}>
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </p>
          )}

          {event.joinUrl && (
            <a
              href={event.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
              style={{ background: "#EFF4FF", color: "#2563EB" }}
            >
              <Video size={12} /> הצטרף
              <Link2 size={11} />
            </a>
          )}

          {onAddReminder && (
            <button
              type="button"
              onClick={() => onAddReminder(event)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
              style={{ background: "#FEF6E7", color: "#92651A" }}
            >
              <BellPlus size={12} /> הוסף לתזכורות
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
