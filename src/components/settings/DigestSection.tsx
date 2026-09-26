"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { DEFAULT_SETTINGS } from "@/lib/types";

type Frequency = "daily" | "weekdays";

export default function DigestSection() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(DEFAULT_SETTINGS.digest.enabled);
  const [frequency, setFrequency] = useState<Frequency>(DEFAULT_SETTINGS.digest.frequency);
  const [times, setTimes] = useState<string[]>(DEFAULT_SETTINGS.digest.times);
  const [newTime, setNewTime] = useState("07:30");
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
          const data = snap.data()?.digest;
          if (data) {
            setEnabled(!!data.enabled);
            if (data.frequency) setFrequency(data.frequency);
            if (data.times) setTimes(data.times);
          }
          loadedOnce.current = true;
        }
        setLoading(false);
      });
    })();
    return () => unsubscribe?.();
  }, [user]);

  const addTime = () => {
    if (!newTime || times.includes(newTime)) return;
    setTimes((prev) => [...prev, newTime].sort());
  };
  const removeTime = (t: string) => setTimes((prev) => prev.filter((x) => x !== t));

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const [{ db }, { doc, setDoc }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      await setDoc(doc(db, "settings", user.uid), { digest: { enabled, frequency, times } }, { merge: true });
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
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>📅 סיכום פגישות יומי</h2>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
          שלח ריכוז פגישות של אותו היום ב-WhatsApp, בתדירות ובשעות שתבחר.
        </p>
      </div>

      {loading ? (
        <div className="h-10 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
      ) : (
        <>
          <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setEnabled((v) => !v)}>
            <div className="relative w-11 h-6 rounded-full transition-colors" style={{ background: enabled ? "#22C55E" : "#E8EDF5" }}>
              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-sm font-medium" style={{ color: enabled ? "#22C55E" : "#5B6477" }}>
              {enabled ? "סיכום מופעל" : "סיכום כבוי"}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>תדירות</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              className="bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]"
              style={{ color: "#0D1321" }}
            >
              <option value="daily">כל יום</option>
              <option value="weekdays">ימי חול (א׳-ה׳)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>שעות שליחה</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {times.map((t) => (
                <span key={t} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm" style={{ background: "#EFF4FF", color: "#2563EB", border: "1px solid #2563EB33" }}>
                  {t}
                  <button onClick={() => removeTime(t)} className="ml-1 hover:opacity-70" aria-label="הסר" style={{ color: "#2563EB" }}>×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)}
                className="bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]"
                style={{ color: "#0D1321" }}
              />
              <button onClick={addTime} className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF]" style={{ borderColor: "#E8EDF5", color: "#0D1321" }}>
                + הוסף שעה
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "שומר..." : "שמור"}
        </button>
        {saveMsg && <span className="text-sm" style={{ color: saveMsg === "נשמר" ? "#22C55E" : "#EF4444" }}>{saveMsg}</span>}
      </div>
    </div>
  );
}
