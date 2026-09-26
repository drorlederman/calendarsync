"use client";

import { Check, Pencil, Trash2, Send, Link2, AlertCircle, BellRing } from "lucide-react";
import type { ReminderDoc } from "@/lib/types";
import { resolveReminderLevel } from "@/lib/types";

export type ReminderRow = ReminderDoc & { id: string };

const ACCENT = "#F59E0B";
const TIMEZONE = "Asia/Jerusalem";

function fmtDue(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

export type Bucket = "overdue" | "today" | "week" | "later" | "none" | "done";

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "באיחור",
  today: "היום",
  week: "השבוע",
  later: "מאוחר יותר",
  none: "ללא תאריך",
  done: "הושלמו",
};

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "week", "later", "none", "done"];

function bucketOf(r: ReminderRow, now: Date): Bucket {
  if (r.status === "done") return "done";
  const due = r.dueAt?.toDate() ?? null;
  if (!due) return "none";
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday); endToday.setDate(endToday.getDate() + 1);
  const endWeek = new Date(startToday); endWeek.setDate(endWeek.getDate() + 7);
  if (due < now) return "overdue";
  if (due < endToday) return "today";
  if (due < endWeek) return "week";
  return "later";
}

function levelDot(r: ReminderRow): string {
  const urgency = resolveReminderLevel(r.urgency, r.priority);
  const importance = resolveReminderLevel(r.importance, r.priority);
  return urgency === "high" || importance === "high" ? "#EF4444" : ACCENT;
}

export default function ReminderList({
  reminders,
  now,
  busyId,
  confirmingId,
  onToggleDone,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onSendNow,
  onOpenSource,
}: {
  reminders: ReminderRow[];
  now: Date;
  busyId: string | null;
  confirmingId: string | null;
  onToggleDone: (r: ReminderRow) => void;
  onEdit: (r: ReminderRow) => void;
  onDelete: (r: ReminderRow) => void;
  onConfirmDelete: (r: ReminderRow) => void;
  onCancelDelete: () => void;
  onSendNow: (r: ReminderRow) => void;
  onOpenSource: (r: ReminderRow) => void;
}) {
  if (reminders.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
        <p style={{ color: "#9CA3AF" }}>אין תזכורות עדיין. הוסף אחת, או צור תזכורת ישירות ממייל או מפגישה ביומן.</p>
      </div>
    );
  }

  const groups = new Map<Bucket, ReminderRow[]>();
  for (const r of reminders) {
    const b = bucketOf(r, now);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b)!.push(r);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => {
      const ax = a.dueAt?.toMillis() ?? a.createdAt?.toMillis?.() ?? 0;
      const bx = b.dueAt?.toMillis() ?? b.createdAt?.toMillis?.() ?? 0;
      return ax - bx;
    });
  }

  return (
    <div className="space-y-6">
      {BUCKET_ORDER.filter((b) => groups.has(b)).map((b) => {
        const rows = groups.get(b)!;
        const overdue = b === "overdue";
        return (
          <div key={b}>
            <h2
              className="text-sm font-semibold mb-2 flex items-center gap-1.5"
              style={{ color: overdue ? "#EF4444" : "#5B6477" }}
            >
              {overdue && <AlertCircle size={14} />}
              {BUCKET_LABEL[b]} <span style={{ color: "#9CA3AF" }}>({rows.length})</span>
            </h2>
            <div className="bg-white rounded-2xl divide-y" style={{ border: "1px solid #E8EDF5" }}>
              {rows.map((r) => {
                const done = r.status === "done";
                const due = r.dueAt?.toDate() ?? null;
                const urgency = resolveReminderLevel(r.urgency, r.priority);
                const importance = resolveReminderLevel(r.importance, r.priority);
                const dot = levelDot(r);
                const confirming = confirmingId === r.id;
                const busy = busyId === r.id;
                return (
                  <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                    <button
                      onClick={() => onToggleDone(r)}
                      aria-label={done ? "החזר לפתוחות" : "סמן כבוצע"}
                      className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition"
                      style={{
                        border: `2px solid ${done ? "#22C55E" : dot}`,
                        background: done ? "#22C55E" : "transparent",
                      }}
                    >
                      {done && <Check size={12} color="#fff" strokeWidth={3} />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: done ? "#9CA3AF" : "#0D1321", textDecoration: done ? "line-through" : "none" }}
                        >
                          {r.title}
                        </p>
                        {!done && r.nagEnabled && (
                          <BellRing size={13} color={ACCENT} className="shrink-0" aria-label="נודניק פעיל" />
                        )}
                      </div>
                      {due && (
                        <p className="text-xs mt-0.5" style={{ color: overdue ? "#EF4444" : "#9CA3AF" }}>
                          🗓️ {fmtDue(due)}
                        </p>
                      )}
                      {!done && (urgency === "high" || importance === "high") && (
                        <p className="text-xs mt-0.5" style={{ color: "#EF4444" }}>
                          {urgency === "high" ? "דחיפות גבוהה" : ""}
                          {urgency === "high" && importance === "high" ? " · " : ""}
                          {importance === "high" ? "חשיבות גבוהה" : ""}
                        </p>
                      )}
                      {r.notes && <p className="text-xs mt-0.5 truncate" style={{ color: "#9CA3AF" }}>{r.notes}</p>}
                      {r.source && r.source.type !== "manual" && (
                        <button
                          onClick={() => onOpenSource(r)}
                          className="text-xs mt-1 inline-flex items-center gap-1 transition hover:opacity-70"
                          style={{ color: "#2563EB" }}
                        >
                          <Link2 size={11} />
                          {r.source.type === "email" ? "פתח מייל"
                            : r.source.type === "event" ? "פתח פגישה"
                            : "פתח ב-Fintics"}: {r.source.label ?? ""}
                        </button>
                      )}

                      {confirming && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs" style={{ color: "#EF4444" }}>למחוק?</span>
                          <button onClick={() => onConfirmDelete(r)} className="text-xs font-semibold" style={{ color: "#EF4444" }}>כן, מחק</button>
                          <button onClick={onCancelDelete} className="text-xs" style={{ color: "#5B6477" }}>ביטול</button>
                        </div>
                      )}
                    </div>

                    {!done && !confirming && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onSendNow(r)} disabled={busy}
                          aria-label="שלח עכשיו ל-WhatsApp" title="שלח עכשיו ל-WhatsApp"
                          className="p-1.5 rounded-lg transition hover:bg-[#F8FAFC] disabled:opacity-40"
                        >
                          <Send size={15} color="#22C55E" />
                        </button>
                        <button
                          onClick={() => onEdit(r)} aria-label="ערוך" title="ערוך"
                          className="p-1.5 rounded-lg transition hover:bg-[#F8FAFC]"
                        >
                          <Pencil size={15} color="#5B6477" />
                        </button>
                        <button
                          onClick={() => onDelete(r)} aria-label="מחק" title="מחק"
                          className="p-1.5 rounded-lg transition hover:bg-[#F8FAFC]"
                        >
                          <Trash2 size={15} color="#EF4444" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
