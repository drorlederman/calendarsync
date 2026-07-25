"use client";

import { BellPlus } from "lucide-react";
import { InboxMessage } from "@/lib/types";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default function MessageList({
  messages, readLocally, onSelect, onAddReminder,
}: {
  messages: InboxMessage[];
  readLocally: Record<string, boolean>;
  onSelect: (msg: InboxMessage) => void;
  onAddReminder: (msg: InboxMessage) => void;
}) {
  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
        <p style={{ color: "#9CA3AF" }}>אין הודעות דואר.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl divide-y" style={{ border: "1px solid #E8EDF5" }}>
      {messages.map((msg) => {
        const isRead = msg.isRead || readLocally[`${msg.accountId}_${msg.id}`];
        return (
          <div
            key={`${msg.accountId}_${msg.id}`}
            className="flex items-start gap-2 px-4 py-3 transition hover:bg-[#F8FAFC]"
          >
            <button
              type="button"
              onClick={() => onSelect(msg)}
              className="min-w-0 flex-1 flex items-start gap-3 text-right"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ background: msg.accountColor }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm truncate" style={{ color: "#0D1321", fontWeight: isRead ? 400 : 700 }}>{msg.from}</p>
                  <span className="text-xs shrink-0" style={{ color: "#9CA3AF" }}>{fmtDate(msg.date)}</span>
                </div>
                <p className="text-sm truncate" style={{ color: "#0D1321", fontWeight: isRead ? 400 : 600 }}>{msg.subject}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: "#9CA3AF" }}>{msg.snippet}</p>
              </div>
            </button>
            <button
              type="button"
              aria-label="הוסף תזכורת"
              title="הוסף תזכורת"
              onClick={(e) => {
                e.stopPropagation();
                onAddReminder(msg);
              }}
              className="shrink-0 mt-0.5 p-2 rounded-full transition hover:opacity-90"
              style={{ background: "#FEF6E7", color: "#92651A" }}
            >
              <BellPlus size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
