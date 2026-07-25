"use client";

import { useEffect, useState } from "react";
import { X, BellPlus } from "lucide-react";
import AddReminderModal from "@/components/reminders/AddReminderModal";

export default function MessageDetail({
  accountId, messageId, subject, onClose,
}: {
  accountId: string;
  messageId: string;
  subject?: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>("text/plain");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingReminder, setAddingReminder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [app, { getFunctions, httpsCallable }] = await Promise.all([
          import("@/lib/firebase/client").then((m) => m.default),
          import("firebase/functions"),
        ]);
        const fns = getFunctions(app, "us-central1");
        const result = await httpsCallable<
          { accountId: string; messageId: string },
          { body: string; contentType: string }
        >(fns, "getMessageBodyCallable")({ accountId, messageId });
        if (!cancelled) {
          setBody(result.data.body);
          setContentType(result.data.contentType);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "שגיאה בטעינת ההודעה");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId, messageId]);

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(13,19,33,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 className="text-base font-semibold truncate" style={{ color: "#0D1321" }}>{subject || "תוכן ההודעה"}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setAddingReminder(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-90"
              style={{ background: "#FEF6E7", color: "#92651A" }}
            >
              <BellPlus size={13} /> הוסף לתזכורות
            </button>
            <button onClick={onClose} aria-label="סגור" className="p-1">
              <X size={20} color="#5B6477" />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="h-40 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
        ) : error ? (
          <p className="text-sm" style={{ color: "#EF4444" }}>{error}</p>
        ) : contentType === "text/html" ? (
          // sandbox="" (empty) blocks scripts/forms/popups/same-origin — the
          // simplest safe way to render untrusted email HTML without
          // executing anything it contains.
          <iframe
            srcDoc={body ?? ""}
            sandbox=""
            className="w-full min-h-[50vh] rounded-xl"
            style={{ border: "1px solid #E8EDF5" }}
          />
        ) : (
          <pre className="text-sm whitespace-pre-wrap" style={{ color: "#0D1321" }}>{body}</pre>
        )}
      </div>
    </div>
    {addingReminder && (
      <AddReminderModal
        onClose={() => setAddingReminder(false)}
        prefill={{
          title: subject ?? "",
          source: { type: "email", accountId, messageId, label: subject ?? "מייל" },
        }}
      />
    )}
    </>
  );
}
