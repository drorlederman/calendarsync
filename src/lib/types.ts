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

export type ReminderStatus = "open" | "done";
export type ReminderLevel = "low" | "medium" | "high";
/** @deprecated Prefer urgency/importance. Kept optional for documents written before the split. */
export type ReminderPriority = "normal" | "high";
export type ReminderSourceType = "email" | "event" | "manual" | "fintics";

export interface ReminderSource {
  type: ReminderSourceType;
  accountId?: string;     // connectedAccount the email belongs to
  messageId?: string;     // Gmail/Graph message id
  eventId?: string;       // events/{id} document id
  transactionId?: string; // fintics transaction id (cross-app: flagged expense)
  label?: string;         // human-readable: email subject / event title / expense
  link?: string | null;   // direct link (joinUrl / deep link into the source app)
}

export interface ReminderDoc {
  uid: string;
  title: string;
  notes: string | null;
  dueAt: Timestamp | null;          // deadline for the task
  remindAt: Timestamp | null;       // explicit "remind me at" instant
  leadOffsetsMinutes: number[];     // extra alerts this many minutes before dueAt
  status: ReminderStatus;
  completedAt: Timestamp | null;
  urgency: ReminderLevel;
  importance: ReminderLevel;
  nagEnabled: boolean;
  /** Short code for completing the reminder via WhatsApp reply (e.g. "בוצע AB12"). */
  completionCode?: string;
  /** @deprecated Prefer urgency/importance. Present only on older documents. */
  priority?: ReminderPriority;
  source: ReminderSource | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export function resolveReminderLevel(
  explicit: ReminderLevel | undefined,
  legacyPriority: ReminderPriority | undefined,
  fallback: ReminderLevel = "medium",
): ReminderLevel {
  if (explicit === "low" || explicit === "medium" || explicit === "high") return explicit;
  if (legacyPriority === "high") return "high";
  if (legacyPriority === "normal") return "medium";
  return fallback;
}

export function shouldAutoEnableNag(urgency: ReminderLevel, importance: ReminderLevel): boolean {
  return urgency === "high" || importance === "high";
}

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
