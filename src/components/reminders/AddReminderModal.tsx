"use client";

import { useState } from "react";
import { X, Link2 } from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";
import type { ReminderDoc, ReminderLevel, ReminderSource } from "@/lib/types";
import { resolveReminderLevel, shouldAutoEnableNag } from "@/lib/types";

const ACCENT = "#F59E0B"; // reminders accent — distinct from the #2563EB meetings blue

const OFFSET_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "בזמן היעד" },
  { minutes: 15, label: "15 דק׳ לפני" },
  { minutes: 60, label: "שעה לפני" },
  { minutes: 1440, label: "יום לפני" },
];

const LEVEL_OPTIONS: { value: ReminderLevel; label: string }[] = [
  { value: "low", label: "נמוכה" },
  { value: "medium", label: "בינונית" },
  { value: "high", label: "גבוהה" },
];

export interface ReminderPrefill {
  title?: string;
  dueAt?: Date | null;
  source?: ReminderSource | null;
}

function toInputValue(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputValue(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const DEFAULT_REMIND_LEAD_MINUTES = 30;

function defaultRemindAt(due: Date | null): Date | null {
  if (!due) return null;
  return new Date(due.getTime() - DEFAULT_REMIND_LEAD_MINUTES * 60 * 1000);
}

export default function AddReminderModal({
  onClose,
  prefill,
  existing,
}: {
  onClose: () => void;
  prefill?: ReminderPrefill;
  existing?: { id: string; data: ReminderDoc };
}) {
  const { user } = useAuth();
  const base = existing?.data;

  const initialUrgency = resolveReminderLevel(base?.urgency, base?.priority);
  const initialImportance = resolveReminderLevel(base?.importance, base?.priority);

  const initialDue = base?.dueAt?.toDate() ?? prefill?.dueAt ?? null;

  const [title, setTitle] = useState(base?.title ?? prefill?.title ?? "");
  const [notes, setNotes] = useState(base?.notes ?? "");
  const [dueStr, setDueStr] = useState(toInputValue(initialDue));
  const [remindStr, setRemindStr] = useState(
    toInputValue(base?.remindAt?.toDate() ?? defaultRemindAt(initialDue))
  );
  // Once the user edits "remind me at" by hand, stop deriving it from the due date.
  const [remindTouched, setRemindTouched] = useState(Boolean(base?.remindAt));
  const [offsets, setOffsets] = useState<number[]>(base?.leadOffsetsMinutes ?? [15, 1440]);
  const [urgency, setUrgency] = useState<ReminderLevel>(initialUrgency);
  const [importance, setImportance] = useState<ReminderLevel>(initialImportance);
  const [nagEnabled, setNagEnabled] = useState<boolean>(
    base?.nagEnabled ?? shouldAutoEnableNag(initialUrgency, initialImportance)
  );
  const [nagTouched, setNagTouched] = useState(base?.nagEnabled != null);
  const [source, setSource] = useState<ReminderSource | null>(base?.source ?? prefill?.source ?? null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleOffset = (m: number) =>
    setOffsets((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)));

  const onDueChange = (value: string) => {
    setDueStr(value);
    if (!remindTouched) {
      setRemindStr(toInputValue(defaultRemindAt(fromInputValue(value))));
    }
  };

  const applyLevel = (kind: "urgency" | "importance", value: ReminderLevel) => {
    const nextUrgency = kind === "urgency" ? value : urgency;
    const nextImportance = kind === "importance" ? value : importance;
    if (kind === "urgency") setUrgency(value);
    else setImportance(value);
    // Auto-on when either is high, unless the user already flipped the toggle manually.
    if (!nagTouched && shouldAutoEnableNag(nextUrgency, nextImportance)) {
      setNagEnabled(true);
    }
  };

  const save = async () => {
    if (!user) return;
    if (!title.trim()) {
      setError("יש להזין נושא");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [{ db }, { collection, addDoc, doc, updateDoc, Timestamp }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const dueDate = fromInputValue(dueStr);
      const remindDate = fromInputValue(remindStr);
      const now = Timestamp.now();
      const payload = {
        uid: user.uid,
        title: title.trim(),
        notes: notes.trim() || null,
        dueAt: dueDate ? Timestamp.fromDate(dueDate) : null,
        remindAt: remindDate ? Timestamp.fromDate(remindDate) : null,
        leadOffsetsMinutes: dueDate ? offsets : [],
        urgency,
        importance,
        nagEnabled,
        source: source ?? null,
        updatedAt: now,
      };
      if (existing) {
        await updateDoc(doc(db, "reminders", existing.id), payload);
      } else {
        await addDoc(collection(db, "reminders"), {
          ...payload,
          status: "open",
          completedAt: null,
          createdAt: now,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשמירה");
      setSaving(false);
    }
  };

  const field = "w-full bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#F59E0B]";

  const levelRow = (label: string, value: ReminderLevel, onPick: (v: ReminderLevel) => void) => (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>{label}</label>
      <div className="flex gap-2">
        {LEVEL_OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition border"
              style={{
                background: on ? ACCENT : "#ffffff",
                color: on ? "#ffffff" : "#5B6477",
                borderColor: on ? ACCENT : "#E8EDF5",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(13,19,33,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>
            {existing ? "עריכת תזכורת" : "🔔 תזכורת חדשה"}
          </h2>
          <button onClick={onClose} aria-label="סגור" className="p-1">
            <X size={20} color="#5B6477" />
          </button>
        </div>

        {source && (
          <div
            className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ background: "#FEF6E7", color: "#92651A", border: "1px solid #F6DFB0" }}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Link2 size={13} className="shrink-0" />
              <span className="truncate">
                מקושר ל{source.type === "email" ? "מייל" : source.type === "event" ? "פגישה" : ""}: {source.label ?? "—"}
              </span>
            </span>
            <button onClick={() => setSource(null)} aria-label="הסר קישור" className="shrink-0 p-0.5">
              <X size={13} />
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>נושא</label>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="מה צריך לזכור?" className={field} style={{ color: "#0D1321" }} autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>תיאור (אופציונלי)</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} className={field} style={{ color: "#0D1321" }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>תאריך יעד</label>
            <input
              type="datetime-local" value={dueStr} onChange={(e) => onDueChange(e.target.value)}
              className={field} style={{ color: "#0D1321" }} dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>הזכר לי ב־</label>
            <input
              type="datetime-local" value={remindStr}
              onChange={(e) => { setRemindTouched(true); setRemindStr(e.target.value); }}
              className={field} style={{ color: "#0D1321" }} dir="ltr"
            />
          </div>
        </div>

        {dueStr && (
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>התרעות לפני היעד</label>
            <div className="flex flex-wrap gap-2">
              {OFFSET_OPTIONS.map((o) => {
                const on = offsets.includes(o.minutes);
                return (
                  <button
                    key={o.minutes} onClick={() => toggleOffset(o.minutes)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition border"
                    style={{
                      background: on ? ACCENT : "#ffffff",
                      color: on ? "#ffffff" : "#5B6477",
                      borderColor: on ? ACCENT : "#E8EDF5",
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {levelRow("דחיפות", urgency, (v) => applyLevel("urgency", v))}
        {levelRow("חשיבות", importance, (v) => applyLevel("importance", v))}

        <div
          className="flex items-start justify-between gap-3 rounded-xl px-3 py-3"
          style={{ background: "#F8FAFC", border: "1px solid #E8EDF5" }}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium" style={{ color: "#0D1321" }}>נודניק</p>
            <p className="text-xs mt-0.5" style={{ color: "#5B6477" }}>
              התרעה יומית עד שתסומן כבוצעה
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={nagEnabled}
            onClick={() => {
              setNagTouched(true);
              setNagEnabled((v) => !v);
            }}
            className="relative shrink-0 w-11 h-6 rounded-full transition"
            style={{ background: nagEnabled ? ACCENT : "#D1D5DB" }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition"
              style={{ right: nagEnabled ? "2px" : "auto", left: nagEnabled ? "auto" : "2px" }}
            />
          </button>
        </div>

        {error && <p className="text-sm" style={{ color: "#EF4444" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={save} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            {saving ? "שומר..." : existing ? "שמור שינויים" : "הוסף תזכורת"}
          </button>
          <button onClick={onClose} className="text-sm font-medium" style={{ color: "#5B6477" }}>ביטול</button>
        </div>
      </div>
    </div>
  );
}
