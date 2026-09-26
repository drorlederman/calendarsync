"use client";

import { useEffect, useState } from "react";

// Registers the service worker and offers an install affordance:
//  - Android / desktop Chrome & Edge: a button wired to beforeinstallprompt.
//  - iOS Safari (no beforeinstallprompt): a one-time "share → add to home
//    screen" hint, since iOS has no programmatic install.
export default function PwaBoot({ accent = "#2563EB", appName = "האפליקציה" }: { accent?: string; appName?: string }) {
  const [deferred, setDeferred] = useState<any>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setDeferred(null));

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (isIOS && !standalone && !localStorage.getItem("pwa-hint-dismissed")) {
      setIosHint(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem("pwa-hint-dismissed", "1"); } catch {}
  };

  if (hidden) return null;

  const wrap: React.CSSProperties = {
    position: "fixed", bottom: "1rem", left: "50%", transform: "translateX(-50%)",
    zIndex: 60, maxWidth: "92%",
  };

  if (deferred) {
    return (
      <div style={wrap}>
        <button
          onClick={async () => { deferred.prompt(); await deferred.userChoice; setDeferred(null); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
          style={{ background: accent }}
        >
          ⬇️ התקן את {appName}
          <span onClick={(e) => { e.stopPropagation(); dismiss(); }} aria-label="סגור" className="opacity-80 pr-1">✕</span>
        </button>
      </div>
    );
  }

  if (iosHint) {
    return (
      <div style={wrap}>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs shadow-lg bg-white" style={{ border: "1px solid #E8EDF5", color: "#0D1321" }} dir="rtl">
          <span>להתקנה: הקש שיתוף <span aria-hidden>⎋</span> ואז «הוסף למסך הבית»</span>
          <button onClick={dismiss} aria-label="סגור" className="shrink-0 opacity-60 px-1">✕</button>
        </div>
      </div>
    );
  }

  return null;
}
