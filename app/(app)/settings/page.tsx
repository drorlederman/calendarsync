"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import ConnectedAccountsSection from "@/components/settings/ConnectedAccountsSection";
import RemindersSection from "@/components/settings/RemindersSection";
import DigestSection from "@/components/settings/DigestSection";
import WhatsAppSection from "@/components/settings/WhatsAppSection";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const searchParams = useSearchParams();
  // Lazy initializer — reads the OAuth-redirect query params once on mount,
  // no effect needed for a one-time derived initial value.
  const [toast] = useState<string | null>(() => {
    if (searchParams.get("connected")) return "החשבון חובר בהצלחה ✓";
    if (searchParams.get("connectError")) return `שגיאה בחיבור החשבון: ${searchParams.get("connectError")}`;
    return null;
  });

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>הגדרות</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>ניהול חשבונות, תזכורות ועדכוני WhatsApp</p>
      </div>

      {toast && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: toast.startsWith("שגיאה") ? "#FEF2F2" : "#DCFCE7",
            color: toast.startsWith("שגיאה") ? "#EF4444" : "#22C55E",
          }}
        >
          {toast}
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 space-y-3" style={{ border: "1px solid #E8EDF5" }}>
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>פרטי חשבון</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p style={{ color: "#5B6477" }}>שם</p>
            <p className="font-medium mt-0.5" style={{ color: "#0D1321" }}>{user?.displayName || "—"}</p>
          </div>
          <div>
            <p style={{ color: "#5B6477" }}>דואל</p>
            <p className="font-medium mt-0.5" style={{ color: "#0D1321" }}>{user?.email || "—"}</p>
          </div>
        </div>
      </div>

      <ConnectedAccountsSection />
      <RemindersSection />
      <DigestSection />
      <WhatsAppSection />

      <div className="rounded-2xl p-6" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: "#EF4444" }}>יציאה</h2>
        <button
          onClick={async () => { await logout(); window.location.href = "/login"; }}
          className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#EF4444" }}
        >
          התנתקות
        </button>
      </div>
    </div>
  );
}
