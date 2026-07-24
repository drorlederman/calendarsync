"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { ConnectedAccountDoc, Provider } from "@/lib/types";
import { RefreshCw, Trash2 } from "lucide-react";

type AccountRow = ConnectedAccountDoc & { id: string };

const PROVIDER_LABEL: Record<string, string> = { google: "Google", microsoft: "Microsoft", slack: "Slack" };

export default function ConnectedAccountsSection() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { collection, query, where, onSnapshot }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const q = query(collection(db, "connectedAccounts"), where("uid", "==", user.uid));
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setAccounts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ConnectedAccountDoc) })));
          setLoading(false);
        },
        (err) => {
          console.error("connectedAccounts onSnapshot error:", err);
          setError(`שגיאה בטעינת חשבונות מחוברים: ${err.message}`);
          setLoading(false);
        }
      );
    })();
    return () => unsubscribe?.();
  }, [user]);

  const connect = async (provider: Provider) => {
    setError(null);
    setConnecting(provider);
    try {
      const [app, { getFunctions, httpsCallable }] = await Promise.all([
        import("@/lib/firebase/client").then((m) => m.default),
        import("firebase/functions"),
      ]);
      const fns = getFunctions(app, "us-central1");
      const result = await httpsCallable<{ provider: string }, { authUrl: string }>(fns, "oauthStartCallable")({ provider });
      window.location.assign(result.data.authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהתחלת החיבור");
      setConnecting(null);
    }
  };

  const disconnect = async (accountId: string) => {
    if (!confirm("להסיר את החשבון הזה? היומן והדואר שלו לא יופיעו יותר.")) return;
    setBusyId(accountId);
    try {
      const [app, { getFunctions, httpsCallable }] = await Promise.all([
        import("@/lib/firebase/client").then((m) => m.default),
        import("firebase/functions"),
      ]);
      const fns = getFunctions(app, "us-central1");
      await httpsCallable(fns, "disconnectAccountCallable")({ accountId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהסרת החשבון");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 space-y-5" style={{ border: "1px solid #E8EDF5" }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>חשבונות מחוברים</h2>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
          חבר חשבונות Google ו-Outlook כדי לרכז את היומן והדואר שלהם כאן.
        </p>
      </div>

      {error && <p className="text-sm" style={{ color: "#EF4444" }}>{error}</p>}

      {loading ? (
        <div className="h-12 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
      ) : accounts.length === 0 ? (
        <p className="text-sm" style={{ color: "#9CA3AF" }}>אין חשבונות מחוברים עדיין.</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#F8FAFC" }}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: acc.displayColor }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: "#0D1321" }}>{acc.externalEmail}</p>
                <p className="text-xs" style={{ color: "#9CA3AF" }}>{PROVIDER_LABEL[acc.provider] ?? acc.provider}</p>
              </div>
              {acc.status === "active" ? (
                <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: "#DCFCE7", color: "#22C55E" }}>מחובר</span>
              ) : (
                <button
                  onClick={() => connect(acc.provider)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1 transition hover:opacity-80"
                  style={{ background: "#FEF2F2", color: "#EF4444" }}
                >
                  <RefreshCw size={12} /> יש להתחבר מחדש
                </button>
              )}
              <button
                onClick={() => disconnect(acc.id)}
                disabled={busyId === acc.id}
                aria-label="הסר חשבון"
                className="p-1.5 rounded-lg transition hover:opacity-70 disabled:opacity-40"
                style={{ color: "#9CA3AF" }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button
          onClick={() => connect("google")}
          disabled={connecting !== null}
          className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50"
          style={{ borderColor: "#E8EDF5", color: "#0D1321" }}
        >
          {connecting === "google" ? "מתחבר..." : "+ חבר חשבון Google"}
        </button>
        <button
          onClick={() => connect("microsoft")}
          disabled={connecting !== null}
          className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50"
          style={{ borderColor: "#E8EDF5", color: "#0D1321" }}
        >
          {connecting === "microsoft" ? "מתחבר..." : "+ חבר חשבון Microsoft"}
        </button>
        <button
          onClick={() => connect("slack")}
          disabled={connecting !== null}
          className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50"
          style={{ borderColor: "#E8EDF5", color: "#0D1321" }}
        >
          {connecting === "slack" ? "מתחבר..." : "+ חבר Slack"}
        </button>
      </div>
    </div>
  );
}
