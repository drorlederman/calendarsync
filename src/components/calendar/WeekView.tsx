"use client";

import { EventDoc } from "@/lib/types";
import { TIMEZONE, dayKey, getWeekRange, addLocalDays, isDayInSyncWindow } from "@/lib/calendar/range";
import { OUT_OF_WINDOW_LABEL, OUT_OF_WINDOW_TITLE, outOfWindowStyle } from "./outOfWindow";

type EventRow = EventDoc & { id: string };

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function weekdayShort(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, weekday: "short" }).format(date);
}

function dayNum(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric" }).format(date);
}

export default function WeekView({
  events,
  anchorDate,
  onEventClick,
}: {
  events: EventRow[];
  anchorDate: Date;
  onEventClick: (event: EventRow) => void;
}) {
  const { start } = getWeekRange(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addLocalDays(start, i));
  const todayKey = dayKey(new Date());

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
      {/* direction:ltr → Sunday on the left (Google Calendar-style grids), chip text stays RTL */}
      <div className="grid grid-cols-7 divide-x" style={{ borderColor: "#E8EDF5", direction: "ltr" }}>
        {days.map((d) => {
          const key = dayKey(d);
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const inWindow = isDayInSyncWindow(d);
          return (
            <div
              key={key}
              className="min-h-[12rem] flex flex-col"
              style={{
                borderColor: "#E8EDF5",
                ...(inWindow ? {} : outOfWindowStyle),
              }}
              title={inWindow ? undefined : OUT_OF_WINDOW_TITLE}
            >
              <div
                className="px-2 py-2 text-center"
                style={{ borderBottom: "1px solid #E8EDF5", background: isToday ? "#EFF4FF" : undefined }}
              >
                <div className="text-[11px]" style={{ color: "#5B6477" }}>{weekdayShort(d)}</div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: isToday ? "#2563EB" : inWindow ? "#0D1321" : "#9AA3B2" }}
                >
                  {dayNum(d)}
                </div>
              </div>
              <div className="flex-1 p-1 space-y-1 overflow-y-auto max-h-[28rem]">
                {!inWindow && (
                  <div className="text-[10px] text-center pt-2" style={{ color: "#9AA3B2" }}>
                    {OUT_OF_WINDOW_LABEL}
                  </div>
                )}
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="w-full text-right rounded-md px-1.5 py-1 text-[11px] leading-snug transition hover:opacity-80"
                    style={{ background: `${event.color}22`, color: "#0D1321" }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle"
                      style={{ background: event.color }}
                    />
                    <span className="font-medium">
                      {event.allDay ? "כל היום" : timeLabel(event.start.toDate())}
                    </span>
                    {" "}
                    <span className="opacity-80">{event.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
