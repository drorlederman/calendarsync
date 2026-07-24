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
}

export const DEFAULT_SETTINGS: SettingsDoc = {
  whatsapp: { enabled: false, phone: "" },
  reminders: { offsetsMinutes: [15, 1440] },
  digest: { enabled: false, frequency: "daily", times: ["07:30"] },
};

export interface SentLogDoc {
  reminders: Record<string, boolean>;
  digest: Record<string, boolean>;
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
