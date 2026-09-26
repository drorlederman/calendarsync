"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import CultureEventCard from "@/components/culture/CultureEventCard";
import {
  CULTURE_REGIONS, CULTURE_TYPES, DEFAULT_CULTURE_SETTINGS, REGION_LABELS, TYPE_LABELS, nextDateInRange,
  type ClientCultureEvent, type ClientCultureSource, type CultureRegion, type CultureSettings, type CultureType,
} from "@/lib/culture";

type Range = "today" | "week" | "all";
const DAY_MS = 24 * 60 * 60 * 1000;

function rangeEnd(range: Range, now: Date): Date | null {
  if (range === "all") return null;
  if (range === "week") return new Date(now.getTime() + 7 * DAY_MS);
  // End of today in Asia/Jerusalem.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const noonLocalHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(noonUtc));
  const offsetH = noonLocalHour - 12;
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - offsetH * 3600000 + DAY_MS);
}

export default function CulturePage() {
  const { user } = useAuth();
  const [culture, setCulture] = useState<CultureSettings>(DEFAULT_CULTURE_SETTINGS);
  const [sources, setSources] = useState<Map<string, ClientCultureSource>>(new Map());
  const [events, setEvents] = useState<ClientCultureEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<CultureType | "all">("all");
  const [region, setRegion] = useState<CultureRegion | "all">("all");
  const [range, setRange] = useState<Range>("week");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ db }, { doc, getDoc, collection, getDocs, query, where }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const settingsSnap = await getDoc(doc(db, "settings", user.uid));
      const c: CultureSettings = { ...DEFAULT_CULTURE_SETTINGS, ...(settingsSnap.data()?.culture ?? {}) };
      const srcSnap = await getDocs(collection(db, "cultureSources"));
      const srcMap = new Map(srcSnap.docs.map((s) => [s.id, { id: s.id, ...(s.data() as Omit<ClientCultureSource, "id">) }]));
      const loaded: ClientCultureEvent[] = [];
      for (let i = 0; i < c.sourceIds.length; i += 30) {
        const snap = await getDocs(query(collection(db, "cultureEvents"), where("sourceId", "in", c.sourceIds.slice(i, i + 30))));
        snap.docs.forEach((d) => loaded.push({ id: d.id, ...(d.data() as Omit<ClientCultureEvent, "id">) }));
      }
      if (cancelled) return;
      setCulture(c);
      setSources(srcMap);
      setEvents(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const list = useMemo(() => {
    const now = new Date();
    const end = rangeEnd(range, now);
    return events
      .filter((e) => (culture.regions.length === 0 || culture.regions.includes(e.region)))
      .filter((e) => (culture.types.length === 0 || culture.types.includes(e.category)))
      .filter((e) => (type === "all" || e.category === type) && (region === "all" || e.region === region))
      .map((e) => ({ e, next: nextDateInRange(e.dates.map((t) => t.toDate()), now, end) }))
      .filter((x): x is { e: ClientCultureEvent; next: Date } => x.next !== null)
      .sort((a, b) => Number(b.e.recommended) - Number(a.e.recommended) || a.next.getTime() - b.next.getTime());
  }, [events, culture, type, region, range]);

  const selectStyle = "bg-white border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>תרבות</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>אירועים מהאתרים והאזורים שבחרת · מתעדכן כל לילה</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={range} onChange={(e) => setRange(e.target.value as Range)} className={selectStyle} style={{ color: "#0D1321" }}>
          <option value="today">היום</option>
          <option value="week">השבוע</option>
          <option value="all">הכל</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as CultureType | "all")} className={selectStyle} style={{ color: "#0D1321" }}>
          <option value="all">כל הסוגים</option>
          {CULTURE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value as CultureRegion | "all")} className={selectStyle} style={{ color: "#0D1321" }}>
          <option value="all">כל האזורים</option>
          {CULTURE_REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: "#E8EDF5" }} />)}
        </div>
      ) : culture.sourceIds.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-sm" style={{ border: "1px solid #E8EDF5", color: "#5B6477" }}>
          עוד לא בחרת אתרים. <Link href="/settings" style={{ color: "#2563EB" }}>לבחירה בהגדרות</Link>
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-sm" style={{ border: "1px solid #E8EDF5", color: "#5B6477" }}>
          לא נמצאו אירועים בטווח שנבחר. אתרים חדשים נסרקים בלילה הקרוב.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map(({ e, next }) => (
            <CultureEventCard key={e.id} event={e} nextDate={next} sourceName={sources.get(e.sourceId)?.name ?? e.sourceId} />
          ))}
        </div>
      )}
    </div>
  );
}
