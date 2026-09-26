"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { DEFAULT_SETTINGS } from "@/lib/types";
import {
  CULTURE_REGIONS, CULTURE_TYPES, REGION_LABELS, TYPE_LABELS, WEEKDAY_LABELS, filterSources,
  type ClientCultureSource, type CultureFrequency, type CultureRegion, type CultureType,
} from "@/lib/culture";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-sm transition"
      style={{
        background: active ? "#EFF4FF" : "#F8FAFC",
        color: active ? "#2563EB" : "#5B6477",
        border: `1px solid ${active ? "#2563EB55" : "#E8EDF5"}`,
      }}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function normalizeDays(frequency: CultureFrequency, days: number[]): number[] {
  if (frequency === "daily") return [];
  if (frequency === "weekly") return [days[0] ?? 0];
  const uniq = [...new Set(days)].slice(0, 2);
  return uniq.length === 2 ? uniq.sort() : [0, 3];
}

export default function CultureSection() {
  const { user } = useAuth();
  const d = DEFAULT_SETTINGS.culture;
  const [enabled, setEnabled] = useState(d.enabled);
  const [regions, setRegions] = useState<CultureRegion[]>(d.regions);
  const [types, setTypes] = useState<CultureType[]>(d.types);
  const [sourceIds, setSourceIds] = useState<string[]>(d.sourceIds);
  const [taste, setTaste] = useState(d.taste);
  const [frequency, setFrequency] = useState<CultureFrequency>(d.frequency);
  const [days, setDays] = useState<number[]>(d.days);
  const [time, setTime] = useState(d.time);
  const [sources, setSources] = useState<ClientCultureSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { doc, onSnapshot, collection, getDocs }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const srcSnap = await getDocs(collection(db, "cultureSources"));
      setSources(srcSnap.docs.map((s) => ({ id: s.id, ...(s.data() as Omit<ClientCultureSource, "id">) }))
        .sort((a, b) => a.name.localeCompare(b.name, "he")));
      unsubscribe = onSnapshot(doc(db, "settings", user.uid), (snap) => {
        if (!loadedOnce.current) {
          const c = snap.data()?.culture;
          if (c) {
            setEnabled(!!c.enabled);
            if (c.regions) setRegions(c.regions);
            if (c.types) setTypes(c.types);
            if (c.sourceIds) setSourceIds(c.sourceIds);
            if (typeof c.taste === "string") setTaste(c.taste);
            if (c.frequency) setFrequency(c.frequency);
            if (c.days) setDays(c.days);
            if (c.time) setTime(c.time);
          }
          loadedOnce.current = true;
        }
        setLoading(false);
      });
    })();
    return () => unsubscribe?.();
  }, [user]);

  const visible = useMemo(() => filterSources(sources, regions, types), [sources, regions, types]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const [{ db }, { doc, setDoc }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const visibleIds = new Set(visible.map((s) => s.id));
      const culture = {
        enabled, regions, types, taste: taste.trim(), frequency, time,
        sourceIds: sourceIds.filter((id) => visibleIds.has(id)),
        days: normalizeDays(frequency, days),
      };
      await setDoc(doc(db, "settings", user.uid), { culture }, { merge: true });
      setSourceIds(culture.sourceIds);
      setDays(culture.days);
      setSaveMsg("נשמר");
    } catch {
      setSaveMsg("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const [app, { getFunctions, httpsCallable }] = await Promise.all([
        import("@/lib/firebase/client").then((m) => m.default),
        import("firebase/functions"),
      ]);
      const fns = getFunctions(app, "us-central1");
      const res = await httpsCallable<void, { ok: boolean; count: number }>(fns, "sendTestCultureCallable")();
      setTestMsg(`נשלח ✓ (${res.data.count} אירועים)`);
    } catch (err) {
      setTestMsg(`שגיאה: ${err instanceof Error ? err.message : "לא ידוע"}`);
    } finally {
      setTesting(false);
    }
  };

  const selectStyle = "bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]";
  const dayFor = (i: number) => days[i] ?? (i === 0 ? 0 : 3);

  return (
    <div className="bg-white rounded-2xl p-6 space-y-4" style={{ border: "1px solid #E8EDF5" }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>🎭 אירועי תרבות</h2>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
          בחרו אזורים ואתרים לסריקה. האירועים מתעדכנים כל לילה ומוצגים בעמוד &quot;תרבות&quot;, והמומלצים נשלחים ב-WhatsApp.
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
              {enabled ? "הודעות תרבות מופעלות" : "הודעות תרבות כבויות"}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>אזורים (ללא בחירה = הכל)</label>
            <div className="flex flex-wrap gap-2">
              {CULTURE_REGIONS.map((r) => (
                <Chip key={r} active={regions.includes(r)} onClick={() => setRegions((p) => toggle(p, r))}>{REGION_LABELS[r]}</Chip>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>סוגי אתרים (ללא בחירה = הכל)</label>
            <div className="flex flex-wrap gap-2">
              {CULTURE_TYPES.map((t) => (
                <Chip key={t} active={types.includes(t)} onClick={() => setTypes((p) => toggle(p, t))}>{TYPE_LABELS[t]}</Chip>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>אתרים לסריקה</label>
            {visible.length === 0 ? (
              <p className="text-sm" style={{ color: "#5B6477" }}>
                {sources.length === 0 ? "רשימת האתרים תופיע אחרי הסריקה הראשונה." : "אין אתרים שמתאימים לסינון."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {visible.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#0D1321" }}>
                    <input type="checkbox" checked={sourceIds.includes(s.id)} onChange={() => setSourceIds((p) => toggle(p, s.id))} />
                    <span>{s.name}</span>
                    <span className="text-xs" style={{ color: "#5B6477" }}>· {TYPE_LABELS[s.type]}</span>
                    {(s.consecutiveFailures ?? 0) >= 3 && (
                      <span className="text-xs" style={{ color: "#EF4444" }}>· סריקה לא זמינה כרגע</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>טעם אישי (לא חובה)</label>
            <input
              value={taste}
              onChange={(e) => setTaste(e.target.value)}
              placeholder="למשל: דרמות אירופיות, ג'אז, בלי מחזות זמר"
              className={`w-full ${selectStyle}`}
              style={{ color: "#0D1321" }}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>תדירות</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as CultureFrequency)} className={selectStyle} style={{ color: "#0D1321" }}>
                <option value="daily">כל יום</option>
                <option value="twiceWeekly">פעמיים בשבוע</option>
                <option value="weekly">פעם בשבוע</option>
              </select>
            </div>
            {frequency !== "daily" && [0, 1].slice(0, frequency === "weekly" ? 1 : 2).map((i) => (
              <div key={i}>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>{i === 0 ? "יום" : "יום נוסף"}</label>
                <select
                  value={dayFor(i)}
                  onChange={(e) => setDays(() => { const next = [dayFor(0), dayFor(1)]; next[i] = Number(e.target.value); return next; })}
                  className={selectStyle}
                  style={{ color: "#0D1321" }}
                >
                  {WEEKDAY_LABELS.map((label, idx) => <option key={idx} value={idx}>{label}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>שעה</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={selectStyle} style={{ color: "#0D1321" }} />
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "שומר..." : "שמור"}
        </button>
        <button onClick={sendTest} disabled={testing || sourceIds.length === 0} className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50" style={{ borderColor: "#E8EDF5", color: "#0D1321" }}>
          {testing ? "שולח..." : "שלח הודעת בדיקה"}
        </button>
        {saveMsg && <span className="text-sm" style={{ color: saveMsg === "נשמר" ? "#22C55E" : "#EF4444" }}>{saveMsg}</span>}
        {testMsg && <span className="text-sm" style={{ color: testMsg.startsWith("נשלח") ? "#22C55E" : "#EF4444" }}>{testMsg}</span>}
      </div>
    </div>
  );
}
