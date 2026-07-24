"use client";

import { SlackMessage } from "@/lib/types";

type SlackMessageRow = SlackMessage & { id: string };

function fmtTime(timestamp: SlackMessage["timestamp"]): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(timestamp.toDate());
}

export default function SlackMessageList({ messages }: { messages: SlackMessageRow[] }) {
  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
        <p style={{ color: "#9CA3AF" }}>אין הודעות סלאק עדיין.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl divide-y" style={{ border: "1px solid #E8EDF5" }}>
      {messages.map((msg) => (
        <div key={msg.id} className="flex items-start gap-3 px-4 py-3">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ background: msg.color }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium truncate" style={{ color: "#0D1321" }}>
                {msg.fromUserName}
                {msg.isDM && (
                  <span className="mr-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: "#EFF4FF", color: "#2563EB" }}>DM</span>
                )}
                {!msg.isDM && msg.isMention && (
                  <span className="mr-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: "#FEF2F2", color: "#EF4444" }}>אזכור</span>
                )}
              </p>
              <span className="text-xs shrink-0" style={{ color: "#9CA3AF" }}>{fmtTime(msg.timestamp)}</span>
            </div>
            {!msg.isDM && <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>{msg.channelName}</p>}
            <p className="text-sm truncate mt-0.5" style={{ color: "#0D1321" }}>{msg.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
