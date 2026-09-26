"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { DEFAULT_SETTINGS } from "@/lib/types";

const PRESETS = [5, 10, 15, 30, 60, 120, 240, 1440, 2880];

function labelFor(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "יום לפני" : `${days} ימים לפני`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "שעה לפני" : `${hours} שעות לפני`;
  }
  return `${minutes} דקות לפני`;
}

export default function RemindersSection() {
  const { user } = useAuth();
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_SETTINGS.reminders.offsetsMinutes);
  const [customValue, setCustomValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { doc, onSnapshot }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      unsubscribe = onSnapshot(doc(db, "settings", user.uid), (snap) => {
        if (!loadedOnce.current) {
          const data = snap.data();
          if (data?.reminders?.offsetsMinutes) setOffsets(data.reminders.offsetsMinutes);
          loadedOnce.current = true;
        }
        setLoading(false);
      });
    })();
    return () => unsubscribe?.();
  }, [user]);

  const addOffset = (minutes: number) => {
    if (!minutes || minutes <= 0 || offsets.includes(minutes)) return;
    setOffsets((prev) => [...prev, minutes].sort((a, b) => a - b));
  };

  const removeOffset = (minutes: number) => {
    setOffsets((prev) => prev.filter((m) => m !== minutes));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const [{ db }, { doc, setDoc }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      await setDoc(doc(db, "settings", user.uid), { reminders: { offsetsMinutes: offsets } }, { merge: true });
      setSaveMsg("נשמר");
    } catch {
      setSaveMsg("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 space-y-4" style={{ border: "1px solid #E8EDF5" }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>⏰ תזכורות לפני פגישות</h2>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
          אפשר להוסיף כמה זמני התרעה שיישלחו ב-WhatsApp לפני כל פגישה.
        </p>
      </div>

      {loading ? (
        <div className="h-10 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {offsets.map((m) => (
            <span
              key={m}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm"
              style={{ background: "#EFF4FF", color: "#2563EB", border: "1px solid #2563EB33" }}
            >
              {labelFor(m)}
              <button onClick={() => removeOffset(m)} className="ml-1 hover:opacity-70" aria-label="הסר" style={{ color: "#2563EB" }}>×</button>
            </span>
          ))}
          {offsets.length === 0 && <p className="text-sm" style={{ color: "#9CA3AF" }}>לא הוגדרו תזכורות.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PRESETS.filter((p) => !offsets.includes(p)).map((p) => (
          <button
            key={p}
            onClick={() => addOffset(p)}
            className="px-3 py-1.5 rounded-full text-xs font-medium border transition hover:bg-[#EFF4FF]"
            style={{ borderColor: "#E8EDF5", color: "#5B6477" }}
          >
            + {labelFor(p)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number" min={1} placeholder="דקות מותאם אישית"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { addOffset(parseInt(customValue, 10)); setCustomValue(""); }
          }}
          className="w-40 bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]"
          style={{ color: "#0D1321" }}
        />
        <button
          onClick={() => { addOffset(parseInt(customValue, 10)); setCustomValue(""); }}
          className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF]"
          style={{ borderColor: "#E8EDF5", color: "#0D1321" }}
        >
          + הוסף
        </button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save} disabled={saving}
          className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ background: "#2563EB" }}
        >
          {saving ? "שומר..." : "שמור"}
        </button>
        {saveMsg && <span className="text-sm" style={{ color: saveMsg === "נשמר" ? "#22C55E" : "#EF4444" }}>{saveMsg}</span>}
      </div>
    </div>
  );
}
