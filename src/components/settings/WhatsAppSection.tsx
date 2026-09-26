"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { DEFAULT_SETTINGS } from "@/lib/types";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

export default function WhatsAppSection() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(DEFAULT_SETTINGS.whatsapp.enabled);
  const [phone, setPhone] = useState(DEFAULT_SETTINGS.whatsapp.phone);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testingKind, setTestingKind] = useState<"reminder" | "digest" | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
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
          const data = snap.data()?.whatsapp;
          if (data) {
            setEnabled(!!data.enabled);
            if (data.phone) setPhone(data.phone);
          }
          loadedOnce.current = true;
        }
        setLoading(false);
      });
    })();
    return () => unsubscribe?.();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const normalized = normalizePhone(phone);
      setPhone(normalized);
      const [{ db }, { doc, setDoc }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      await setDoc(doc(db, "settings", user.uid), { whatsapp: { enabled, phone: normalized } }, { merge: true });
      setSaveMsg("נשמר");
    } catch {
      setSaveMsg("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (kind: "reminder" | "digest") => {
    setTestingKind(kind);
    setTestMsg(null);
    try {
      const [app, { getFunctions, httpsCallable }] = await Promise.all([
        import("@/lib/firebase/client").then((m) => m.default),
        import("firebase/functions"),
      ]);
      const fns = getFunctions(app, "us-central1");
      await httpsCallable(fns, "sendTestWhatsAppCallable")({ kind });
      setTestMsg("נשלח ✓");
    } catch (err) {
      setTestMsg(`שגיאה: ${err instanceof Error ? err.message : "לא ידוע"}`);
    } finally {
      setTestingKind(null);
    }
  };

  const canTest = enabled && phone.trim().length > 0;

  return (
    <div className="bg-white rounded-2xl p-6 space-y-4" style={{ border: "1px solid #E8EDF5" }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>💬 עדכוני WhatsApp</h2>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>מספר ה-WhatsApp שאליו יישלחו תזכורות וסיכומי פגישות (דרך Green API)</p>
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
              {enabled ? "הודעות מופעלות" : "הודעות כבויות"}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>מספר WhatsApp</label>
            <input
              type="tel" dir="ltr" placeholder="+972501234567"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full max-w-xs bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#2563EB]"
              style={{ color: "#0D1321" }}
            />
          </div>

          <div className="bg-[#111b21] rounded-2xl p-4" dir="rtl">
            <div className="bg-[#202c33] rounded-xl px-4 py-3 max-w-xs inline-block">
              <pre className="text-[13px] text-[#e9edef] whitespace-pre-wrap font-sans leading-relaxed">
                {"⏰ תזכורת — 15 דקות לפני הפגישה\n\n📌 פגישת סטטוס שבועית\n🕐 14:00\n🔗 https://meet.google.com/abc-defg-hij"}
              </pre>
              <p className="text-xs text-[#8696a0] mt-2 text-left">✓✓</p>
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "שומר..." : "שמור"}
        </button>
        {canTest && (
          <>
            <button onClick={() => sendTest("reminder")} disabled={testingKind !== null} className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:opacity-80 disabled:opacity-50" style={{ color: "#22C55E", borderColor: "#22C55E44" }}>
              {testingKind === "reminder" ? "שולח..." : "💬 שלח תזכורת לדוגמה"}
            </button>
            <button onClick={() => sendTest("digest")} disabled={testingKind !== null} className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:opacity-80 disabled:opacity-50" style={{ color: "#22C55E", borderColor: "#22C55E44" }}>
              {testingKind === "digest" ? "שולח..." : "💬 שלח סיכום לדוגמה"}
            </button>
          </>
        )}
        {saveMsg && <span className="text-sm" style={{ color: saveMsg === "נשמר" ? "#22C55E" : "#EF4444" }}>{saveMsg}</span>}
        {testMsg && <span className="text-sm" style={{ color: testMsg.startsWith("שגיאה") ? "#EF4444" : "#22C55E" }}>{testMsg}</span>}
      </div>
    </div>
  );
}
