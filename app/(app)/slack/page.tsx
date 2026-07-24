"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { SlackMessage } from "@/lib/types";
import SlackMessageList from "@/components/slack/SlackMessageList";

type SlackMessageRow = SlackMessage & { id: string };

export default function SlackPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<SlackMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { collection, query, where, orderBy, onSnapshot, limit }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const q = query(
        collection(db, "slackMessages"),
        where("uid", "==", user.uid),
        orderBy("timestamp", "desc"),
        limit(100)
      );
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as SlackMessage) })));
          setLoading(false);
        },
        (err) => {
          console.error("slackMessages onSnapshot error:", err);
          setError(`שגיאה בטעינת הודעות סלאק: ${err.message}`);
          setLoading(false);
        }
      );
    })();
    return () => unsubscribe?.();
  }, [user]);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>סלאק</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>הודעות ואזכורים מכל ה-workspaces המחוברים</p>
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
        <SlackMessageList messages={messages} />
      )}
    </div>
  );
}
