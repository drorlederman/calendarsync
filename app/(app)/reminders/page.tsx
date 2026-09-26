"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";
import type { ReminderDoc } from "@/lib/types";
import ReminderList, { type ReminderRow } from "@/components/reminders/ReminderList";
import AddReminderModal from "@/components/reminders/AddReminderModal";

export default function RemindersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ReminderRow | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Refresh "now" each minute so overdue/today buckets stay accurate without a reload.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { collection, query, where, onSnapshot }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const q = query(collection(db, "reminders"), where("uid", "==", user.uid));
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setReminders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ReminderDoc) })));
          setLoading(false);
        },
        (err) => {
          setError(`שגיאה בטעינת התזכורות: ${err.message}`);
          setLoading(false);
        }
      );
    })();
    return () => unsubscribe?.();
  }, [user]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const toggleDone = async (r: ReminderRow) => {
    const [{ db }, { doc, updateDoc, Timestamp }] = await Promise.all([
      import("@/lib/firebase/client"),
      import("firebase/firestore"),
    ]);
    const next = r.status === "done" ? "open" : "done";
    await updateDoc(doc(db, "reminders", r.id), {
      status: next,
      completedAt: next === "done" ? Timestamp.now() : null,
      updatedAt: Timestamp.now(),
    });
  };

  const confirmDelete = async (r: ReminderRow) => {
    setConfirmingId(null);
    const [{ db }, { doc, deleteDoc }] = await Promise.all([
      import("@/lib/firebase/client"),
      import("firebase/firestore"),
    ]);
    await deleteDoc(doc(db, "reminders", r.id));
  };

  const sendNow = async (r: ReminderRow) => {
    setBusyId(r.id);
    try {
      const [app, { getFunctions, httpsCallable }] = await Promise.all([
        import("@/lib/firebase/client").then((m) => m.default),
        import("firebase/functions"),
      ]);
      const fns = getFunctions(app, "us-central1");
      await httpsCallable(fns, "sendReminderNowCallable")({ reminderId: r.id });
      showToast("נשלח ל-WhatsApp ✓");
    } catch (err) {
      showToast(`שגיאה: ${err instanceof Error ? err.message : "לא ידוע"}`);
    } finally {
      setBusyId(null);
    }
  };

  const openSource = (r: ReminderRow) => {
    if (r.source?.link) {
      window.open(r.source.link, "_blank", "noopener,noreferrer");
    } else if (r.source?.type === "email") {
      router.push("/inbox");
    } else if (r.source?.type === "event") {
      router.push("/calendar");
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>תזכורות</h1>
          <p className="text-sm mt-1" style={{ color: "#5B6477" }}>משימות ותזכורות אישיות — עם התרעות WhatsApp</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#F59E0B" }}
        >
          <Plus size={16} /> תזכורת חדשה
        </button>
      </div>

      {error ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FEF2F2", color: "#EF4444" }}>{error}</div>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
          ))}
        </div>
      ) : (
        <ReminderList
          reminders={reminders}
          now={now}
          busyId={busyId}
          confirmingId={confirmingId}
          onToggleDone={toggleDone}
          onEdit={(r) => setEditing(r)}
          onDelete={(r) => setConfirmingId(r.id)}
          onConfirmDelete={confirmDelete}
          onCancelDelete={() => setConfirmingId(null)}
          onSendNow={sendNow}
          onOpenSource={openSource}
        />
      )}

      {adding && <AddReminderModal onClose={() => setAdding(false)} />}
      {editing && (
        <AddReminderModal
          onClose={() => setEditing(null)}
          existing={{ id: editing.id, data: editing }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: "#0D1321", color: "#fff" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
