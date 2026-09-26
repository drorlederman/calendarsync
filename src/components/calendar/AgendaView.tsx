"use client";

import { EventDoc } from "@/lib/types";
import { Video, MapPin, BellPlus } from "lucide-react";

type EventRow = EventDoc & { id: string };

const TIMEZONE = "Asia/Jerusalem";

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(date);
}

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function AgendaView({
  events,
  onAddReminder,
}: {
  events: EventRow[];
  onAddReminder?: (event: EventRow) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
        <p style={{ color: "#9CA3AF" }}>אין פגישות קרובות ביומן.</p>
      </div>
    );
  }

  // events arrive pre-sorted by start ascending, so a Map groups them into
  // chronological day order with no extra sort needed.
  const groups = new Map<string, EventRow[]>();
  for (const event of events) {
    const key = dayKey(event.start.toDate());
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([key, dayEvents]) => (
        <div key={key}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "#5B6477" }}>
            {dayLabel(dayEvents[0].start.toDate())}
          </h2>
          <div className="bg-white rounded-2xl divide-y" style={{ border: "1px solid #E8EDF5" }}>
            {dayEvents.map((event) => (
              <div key={event.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: event.color }} />
                <div className="w-16 shrink-0 text-sm font-medium" style={{ color: "#0D1321" }}>
                  {event.allDay ? "כל היום" : timeLabel(event.start.toDate())}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "#0D1321" }}>{event.title}</p>
                  {event.location && (
                    <p className="text-xs flex items-center gap-1 truncate mt-0.5" style={{ color: "#9CA3AF" }}>
                      <MapPin size={11} /> {event.location}
                    </p>
                  )}
                </div>
                {onAddReminder && (
                  <button
                    onClick={() => onAddReminder(event)}
                    aria-label="הוסף לתזכורות" title="הוסף לתזכורות"
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
                    style={{ background: "#FEF6E7", color: "#92651A" }}
                  >
                    <BellPlus size={12} /> תזכורת
                  </button>
                )}
                {event.joinUrl && (
                  <a
                    href={event.joinUrl} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
                    style={{ background: "#EFF4FF", color: "#2563EB" }}
                  >
                    <Video size={12} /> הצטרף
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
