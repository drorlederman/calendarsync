import type { Timestamp } from "firebase/firestore";

export type Provider = "google" | "microsoft" | "slack";
export type AccountStatus = "active" | "reauth_required" | "error";

export interface ConnectedAccountDoc {
  uid: string;
  provider: Provider;
  externalEmail: string;
  displayColor: string;
  status: AccountStatus;
  errorMessage?: string;
  scopes: string[];
}

export type JoinType = "meet" | "zoom" | "teams" | "other" | null;

export interface EventDoc {
  uid: string;
  connectedAccountId: string;
  provider: Provider;
  title: string;
  start: Timestamp;
  end: Timestamp;
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  joinUrl: string | null;
  joinType: JoinType;
  color: string;
  status: "confirmed" | "cancelled";
}

export interface SettingsDoc {
  whatsapp: { enabled: boolean; phone: string };
  reminders: { offsetsMinutes: number[] };
  digest: { enabled: boolean; frequency: "daily" | "weekdays"; times: string[] };
}

export const DEFAULT_SETTINGS: SettingsDoc = {
  whatsapp: { enabled: false, phone: "" },
  reminders: { offsetsMinutes: [15, 1440] },
  digest: { enabled: false, frequency: "daily", times: ["07:30"] },
};

export interface InboxMessage {
  id: string;
  accountId: string;
  accountColor: string;
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  isRead: boolean;
}

export interface SlackMessage {
  channelId: string;
  channelName: string;
  isDM: boolean;
  fromUserName: string;
  text: string;
  isMention: boolean;
  timestamp: Timestamp;
  color: string;
}
