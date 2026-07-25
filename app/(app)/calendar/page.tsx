"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { EventDoc } from "@/lib/types";
import AgendaView from "@/components/calendar/AgendaView";
import WeekView from "@/components/calendar/WeekView";
import MonthView from "@/components/calendar/MonthView";
import CalendarViewToggle from "@/components/calendar/CalendarViewToggle";
import EventDetailModal from "@/components/calendar/EventDetailModal";
import AddReminderModal from "@/components/reminders/AddReminderModal";
import { OUT_OF_WINDOW_LABEL } from "@/components/calendar/outOfWindow";
import {
  CalendarView,
  getVisibleRange,
  startOfLocalDay,
  syncWindowLabel,
} from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

export default function CalendarPage() {
  const { user } = useAuth();
  const [view, setView] = useState<CalendarView>("agenda");
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminderEvent, setReminderEvent] = useState<EventRow | null>(null);
  const [detailEvent, setDetailEvent] = useState<EventRow | null>(null);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const [{ db }, { collection, query, where, orderBy, onSnapshot, Timestamp }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      if (cancelled) return;

      setLoading(true);
      setError(null);

      const range = getVisibleRange(view, anchorDate);
      const constraints = range
        ? [
            where("uid", "==", user.uid),
            where("start", ">=", Timestamp.fromDate(range.start)),
            where("start", "<", Timestamp.fromDate(range.end)),
            orderBy("start", "asc"),
          ]
        : (() => {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            return [
              where("uid", "==", user.uid),
              where("start", ">=", Timestamp.fromDate(startOfToday)),
              orderBy("start", "asc"),
            ];
          })();

      const q = query(collection(db, "events"), ...constraints);
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setEvents(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as EventDoc) }))
              .filter((e) => e.status === "confirmed")
          );
          setLoading(false);
        },
        (err) => {
          console.error("events onSnapshot error:", err);
          setError(`שגיאה בטעינת היומן: ${err.message}`);
          setLoading(false);
        }
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [user, view, anchorDate]);

  const openReminder = (event: EventRow) => {
    setDetailEvent(null);
    setReminderEvent(event);
  };

  const wide = view !== "agenda";

  return (
    <div className={`space-y-5 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>יומן</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>כל הפגישות מכל החשבונות המחוברים, במקום אחד</p>
      </div>

      <CalendarViewToggle
        view={view}
        anchorDate={anchorDate}
        onViewChange={setView}
        onAnchorChange={setAnchorDate}
      />

      {wide && (
        <p className="text-xs" style={{ color: "#5B6477" }}>
          נתונים מסונכרנים זמינים בטווח {syncWindowLabel()}. ימים מחוץ לטווח מסומנים כ״{OUT_OF_WINDOW_LABEL}״.
        </p>
      )}

      {error ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FEF2F2", color: "#EF4444" }}>{error}</div>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
          ))}
        </div>
      ) : view === "agenda" ? (
        <AgendaView events={events} onAddReminder={openReminder} />
      ) : view === "week" ? (
        <WeekView events={events} anchorDate={anchorDate} onEventClick={setDetailEvent} />
      ) : (
        <MonthView events={events} anchorDate={anchorDate} onEventClick={setDetailEvent} />
      )}

      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onAddReminder={openReminder}
        />
      )}

      {reminderEvent && (
        <AddReminderModal
          onClose={() => setReminderEvent(null)}
          prefill={{
            title: reminderEvent.title,
            dueAt: reminderEvent.start.toDate(),
            source: {
              type: "event",
              eventId: reminderEvent.id,
              label: reminderEvent.title,
              link: reminderEvent.joinUrl,
            },
          }}
        />
      )}
    </div>
  );
}
