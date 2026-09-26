import { CultureSettings, DEFAULT_CULTURE_SETTINGS } from "./culture/types";

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
  slackTeamId?: string;
  slackUserId?: string;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

export interface TokenDoc {
  accessToken: string;
  refreshToken?: string; // Slack user tokens have no refresh token — see oauth/slack.ts
  tokenExpiresAt: number; // epoch millis
}

export type JoinType = "meet" | "zoom" | "teams" | "other" | null;

export interface EventDoc {
  uid: string;
  connectedAccountId: string;
  provider: Provider;
  sourceCalendarId: string;
  externalEventId: string;
  title: string;
  start: FirebaseFirestore.Timestamp;
  end: FirebaseFirestore.Timestamp;
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  joinUrl: string | null;
  joinType: JoinType;
  color: string;
  status: "confirmed" | "cancelled";
  lastSeenSyncAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

export interface SettingsDoc {
  whatsapp: { enabled: boolean; phone: string };
  reminders: { offsetsMinutes: number[] };
  digest: { enabled: boolean; frequency: "daily" | "weekdays"; times: string[] };
  culture: CultureSettings;
}

export const DEFAULT_SETTINGS: SettingsDoc = {
  whatsapp: { enabled: false, phone: "" },
  reminders: { offsetsMinutes: [15, 1440] },
  digest: { enabled: false, frequency: "daily", times: ["07:30"] },
  culture: DEFAULT_CULTURE_SETTINGS,
};

export interface SentLogDoc {
  reminders: Record<string, boolean>;
  digest: Record<string, boolean>;
  tasks: Record<string, boolean>;
}

export type ReminderStatus = "open" | "done";
export type ReminderLevel = "low" | "medium" | "high";
/** @deprecated Prefer urgency/importance. Kept optional for documents written before the split. */
export type ReminderPriority = "normal" | "high";
export type ReminderSourceType = "email" | "event" | "manual" | "fintics";

export interface ReminderSource {
  type: ReminderSourceType;
  accountId?: string;
  messageId?: string;
  eventId?: string;
  transactionId?: string;
  label?: string;
  link?: string | null;
}

export interface ReminderDoc {
  uid: string;
  title: string;
  notes: string | null;
  dueAt: FirebaseFirestore.Timestamp | null;
  remindAt: FirebaseFirestore.Timestamp | null;
  leadOffsetsMinutes: number[];
  status: ReminderStatus;
  completedAt: FirebaseFirestore.Timestamp | null;
  urgency: ReminderLevel;
  importance: ReminderLevel;
  nagEnabled: boolean;
  /** Short code for completing the reminder via WhatsApp reply (e.g. "בוצע AB12"). */
  completionCode?: string;
  /** @deprecated Prefer urgency/importance. Present only on older documents. */
  priority?: ReminderPriority;
  source: ReminderSource | null;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
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

export interface SlackMessageDoc {
  uid: string;
  connectedAccountId: string;
  channelId: string;
  channelName: string;
  isDM: boolean;
  fromUserName: string;
  text: string;
  isMention: boolean;
  timestamp: FirebaseFirestore.Timestamp;
  color: string;
  notifiedViaWhatsApp: boolean;
}
