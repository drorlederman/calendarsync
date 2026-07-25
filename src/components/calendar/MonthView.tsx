"use client";

import { EventDoc } from "@/lib/types";
import {
  TIMEZONE,
  dayKey,
  getMonthGridDays,
  getMonthRange,
} from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

const MAX_CHIPS = 3;

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const WEEKDAYS_HE = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"]; // Sun→Sat headers

export default function MonthView({
  events,
  anchorDate,
  onEventClick,
}: {
  events: EventRow[];
  anchorDate: Date;
  onEventClick: (event: EventRow) => void;
}) {
  const days = getMonthGridDays(anchorDate);
  const { start: monthStart, end: monthEnd } = getMonthRange(anchorDate);
  const todayKey = dayKey(new Date());
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();

  const byDay = new Map<string, EventRow[]>();
  for (const d of days) byDay.set(dayKey(d), []);
  for (const event of events) {
    const key = dayKey(event.start.toDate());
    if (byDay.has(key)) byDay.get(key)!.push(event);
  }

  return (
    <div
      className="bg-white rounded-2xl overflow-hidden"
      style={{ border: "1px solid #E8EDF5" }}
    >
      <div
        className="grid grid-cols-7"
        style={{ borderBottom: "1px solid #E8EDF5", direction: "ltr" }}
      >
        {WEEKDAYS_HE.map((label) => (
          <div
            key={label}
            className="px-1 py-2 text-center text-[11px] font-medium"
            style={{ color: "#5B6477" }}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr" style={{ direction: "ltr" }}>
        {days.map((d) => {
          const key = dayKey(d);
          const inMonth = d.getTime() >= monthStartMs && d.getTime() < monthEndMs;
          const dayEvents = byDay.get(key) ?? [];
          const overflow = Math.max(0, dayEvents.length - MAX_CHIPS);
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className="min-h-[5.5rem] p-1"
              style={{
                borderTop: "1px solid #E8EDF5",
                borderLeft: "1px solid #E8EDF5",
                background: isToday ? "#F8FAFF" : undefined,
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div
                className="text-[11px] font-semibold mb-0.5 px-0.5"
                style={{ color: isToday ? "#2563EB" : "#0D1321" }}
              >
                {new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric" }).format(d)}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="w-full text-right truncate rounded px-1 py-0.5 text-[10px] leading-tight transition hover:opacity-80"
                    style={{ background: `${event.color}22`, color: "#0D1321" }}
                    title={event.title}
                  >
                    {!event.allDay && (
                      <span className="opacity-70">{timeLabel(event.start.toDate())} </span>
                    )}
                    {event.title}
                  </button>
                ))}
                {overflow > 0 && (
                  <div className="text-[10px] px-1" style={{ color: "#5B6477" }}>
                    +{overflow} עוד
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
