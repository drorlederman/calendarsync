"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { ConnectedAccountDoc, InboxMessage } from "@/lib/types";
import MessageList from "@/components/inbox/MessageList";
import MessageDetail from "@/components/inbox/MessageDetail";
import AddReminderModal from "@/components/reminders/AddReminderModal";
import type { ReminderPrefill } from "@/components/reminders/AddReminderModal";

type AccountRow = ConnectedAccountDoc & { id: string };
type InboxItem = Omit<InboxMessage, "accountId" | "accountColor">;
type ListResult = Record<string, { items: InboxItem[]; nextPageToken?: string; accountColor: string; error?: string }>;

export default function InboxPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [pageTokens, setPageTokens] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<{ accountId: string; messageId: string; subject: string } | null>(null);
  const [reminderPrefill, setReminderPrefill] = useState<ReminderPrefill | null>(null);
  const [readLocally, setReadLocally] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { collection, query, where, onSnapshot }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const q = query(
        collection(db, "connectedAccounts"),
        where("uid", "==", user.uid),
        where("status", "==", "active")
      );
      unsubscribe = onSnapshot(q, (snap) => {
        setAccounts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ConnectedAccountDoc) })));
      });
    })();
    return () => unsubscribe?.();
  }, [user]);

  const loadMessages = useCallback(async (tokens?: Record<string, string>) => {
    const [app, { getFunctions, httpsCallable }] = await Promise.all([
      import("@/lib/firebase/client").then((m) => m.default),
      import("firebase/functions"),
    ]);
    const fns = getFunctions(app, "us-central1");
    const result = await httpsCallable<{ pageTokens?: Record<string, string> }, { results: ListResult }>(
      fns, "listInboxMessagesCallable"
    )({ pageTokens: tokens });

    const newMessages: InboxMessage[] = [];
    const newTokens: Record<string, string> = {};
    const newErrors: Record<string, string> = {};
    for (const [accountId, r] of Object.entries(result.data.results)) {
      for (const item of r.items) newMessages.push({ ...item, accountId, accountColor: r.accountColor });
      if (r.nextPageToken) newTokens[accountId] = r.nextPageToken;
      if (r.error) newErrors[accountId] = r.error;
    }
    return { newMessages, newTokens, newErrors };
  }, []);

  useEffect(() => {
    (async () => {
      if (accounts.length === 0) { setLoading(false); return; }
      setLoading(true);
      const { newMessages, newTokens, newErrors } = await loadMessages();
      setMessages(newMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setPageTokens(newTokens);
      setErrors(newErrors);
      setLoading(false);
    })();
  }, [accounts, loadMessages]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const { newMessages, newTokens, newErrors } = await loadMessages(pageTokens);
    setMessages((prev) =>
      [...prev, ...newMessages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    );
    setPageTokens(newTokens);
    setErrors((prev) => ({ ...prev, ...newErrors }));
    setLoadingMore(false);
  };

  const openMessage = (msg: InboxMessage) => {
    setSelected({ accountId: msg.accountId, messageId: msg.id, subject: msg.subject });
    setReadLocally((prev) => ({ ...prev, [`${msg.accountId}_${msg.id}`]: true }));
  };

  const openReminderForMessage = (msg: InboxMessage) => {
    setReminderPrefill({
      title: msg.subject,
      source: {
        type: "email",
        accountId: msg.accountId,
        messageId: msg.id,
        label: msg.subject || "מייל",
      },
    });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>דואר</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>כל תיבות הדואר מרוכזות במקום אחד</p>
      </div>

      {accounts.length === 0 && !loading && (
        <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
          <p style={{ color: "#9CA3AF" }}>אין חשבונות מחוברים. חבר חשבון Google או Microsoft במסך ההגדרות.</p>
        </div>
      )}

      {Object.keys(errors).length > 0 && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FEF2F2", color: "#EF4444" }}>
          חלק מהחשבונות לא נטענו כראוי — ייתכן שדרוש חיבור מחדש במסך ההגדרות.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
          ))}
        </div>
      ) : (
        <>
          <MessageList messages={messages} readLocally={readLocally} onSelect={openMessage} onAddReminder={openReminderForMessage} />
          {Object.keys(pageTokens).length > 0 && (
            <div className="text-center">
              <button
                onClick={handleLoadMore} disabled={loadingMore}
                className="px-5 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50"
                style={{ borderColor: "#E8EDF5", color: "#0D1321" }}
              >
                {loadingMore ? "טוען..." : "טען עוד"}
              </button>
            </div>
          )}
        </>
      )}

      {selected && (
        <MessageDetail accountId={selected.accountId} messageId={selected.messageId} subject={selected.subject} onClose={() => setSelected(null)} />
      )}

      {reminderPrefill && (
        <AddReminderModal
          onClose={() => setReminderPrefill(null)}
          prefill={reminderPrefill}
        />
      )}
    </div>
  );
}
