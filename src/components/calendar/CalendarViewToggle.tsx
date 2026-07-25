"use client";

import { ChevronRight, ChevronLeft } from "lucide-react";
import {
  CalendarView,
  canNavigate,
  periodLabel,
  shiftAnchor,
  startOfLocalDay,
} from "@/lib/calendar/range";

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "agenda", label: "רשימה" },
  { id: "week", label: "שבוע" },
  { id: "month", label: "חודש" },
];

export default function CalendarViewToggle({
  view,
  anchorDate,
  onViewChange,
  onAnchorChange,
}: {
  view: CalendarView;
  anchorDate: Date;
  onViewChange: (v: CalendarView) => void;
  onAnchorChange: (d: Date) => void;
}) {
  const showNav = view === "week" || view === "month";
  const canPrev = showNav && canNavigate(view, anchorDate, -1);
  const canNext = showNav && canNavigate(view, anchorDate, 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        className="inline-flex rounded-full p-1"
        style={{ background: "#F1F5F9" }}
        role="tablist"
        aria-label="תצוגת יומן"
      >
        {VIEWS.map(({ id, label }) => {
          const active = view === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(id)}
              className="px-3.5 py-1.5 rounded-full text-sm font-medium transition"
              style={{
                background: active ? "#ffffff" : "transparent",
                color: active ? "#0D1321" : "#5B6477",
                boxShadow: active ? "0 1px 2px rgba(13,19,33,0.06)" : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {showNav && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAnchorChange(startOfLocalDay(new Date()))}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
            style={{ background: "#EFF4FF", color: "#2563EB" }}
          >
            היום
          </button>
          <span className="text-sm font-medium min-w-[9rem] text-center" style={{ color: "#0D1321" }}>
            {periodLabel(view, anchorDate)}
          </span>
          {/* RTL: ChevronRight visually points toward earlier dates (prev) */}
          <button
            type="button"
            aria-label="הקודם"
            disabled={!canPrev}
            onClick={() => canPrev && onAnchorChange(shiftAnchor(view, anchorDate, -1))}
            className="p-1.5 rounded-lg transition disabled:opacity-30"
            style={{ color: "#0D1321" }}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            aria-label="הבא"
            disabled={!canNext}
            onClick={() => canNext && onAnchorChange(shiftAnchor(view, anchorDate, 1))}
            className="p-1.5 rounded-lg transition disabled:opacity-30"
            style={{ color: "#0D1321" }}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
