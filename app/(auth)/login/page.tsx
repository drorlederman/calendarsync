"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, error, loginWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !loading) router.replace("/calendar");
  }, [user, loading, router]);

  const handleGoogleLogin = async () => {
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
      // stay in submitting state — useEffect above will redirect
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setFormError(err instanceof Error ? err.message : "התחברות עם Google נכשלה");
      }
      setSubmitting(false);
    }
  };

  const isLoading = loading || submitting;

  if (loading && !submitting) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#2563EB", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: "#F8FAFC" }}>
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold" style={{ color: "#0D1321" }}>📅 CalendarSync</h1>
          <p className="text-sm" style={{ color: "#5B6477" }}>יומן, דואר ותזכורות WhatsApp במקום אחד</p>
        </div>

        {(formError || error) && (
          <div className="rounded-xl p-4 text-sm text-center" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#EF4444" }}>
            {formError || error}
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90"
          style={{ background: "#2563EB" }}
        >
          {submitting ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.173 17.64 11.865 17.64 9.2Z" fill="white" fillOpacity=".9"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="white" fillOpacity=".9"/>
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332Z" fill="white" fillOpacity=".9"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58Z" fill="white" fillOpacity=".9"/>
            </svg>
          )}
          {submitting ? "מתחבר..." : "התחברות עם Google"}
        </button>

        <p className="text-center text-xs" style={{ color: "#9CA3AF" }}>
          זו התחברות לאפליקציה בלבד. חיבור חשבונות Google/Outlook נוספים ליומן ולדואר נעשה במסך ההגדרות לאחר ההתחברות.
        </p>
      </div>
    </div>
  );
}
