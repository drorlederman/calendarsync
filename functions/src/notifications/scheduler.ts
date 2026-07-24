import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { db } from "../firebase";
import { EventDoc, SettingsDoc, DEFAULT_SETTINGS } from "../types";
import { sendWhatsApp, greenApiUrl, greenApiInstance, greenApiToken } from "./whatsapp";
import { TIMEZONE, zoneParts, localDayBoundsUtc, fmtTime } from "./timezone";

const TICK_WINDOW_MS = 5 * 60 * 1000;

function fmtOffset(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "יום אחד" : `${days} ימים`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "שעה אחת" : `${hours} שעות`;
  }
  return `${minutes} דקות`;
}

function buildReminderMessage(event: EventDoc, offsetMinutes: number): string {
  const lines: string[] = [];
  lines.push(`⏰ תזכורת — ${fmtOffset(offsetMinutes)} לפני הפגישה`);
  lines.push("");
  lines.push(`📌 ${event.title}`);
  lines.push(`🕐 ${fmtTime(event.start.toDate(), TIMEZONE)}`);
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.joinUrl) lines.push(`🔗 ${event.joinUrl}`);
  return lines.join("\n");
}

function buildDigestMessage(events: EventDoc[], dateLabel: string, slackCount: number): string {
  const lines: string[] = [];
  lines.push(`📅 סיכום פגישות להיום — ${dateLabel}`);
  lines.push("");
  if (events.length === 0) {
    lines.push("אין פגישות מתוכננות היום 🎉");
  } else {
    const sorted = [...events].sort((a, b) => a.start.toMillis() - b.start.toMillis());
    for (const event of sorted) {
      const time = event.allDay ? "כל היום" : fmtTime(event.start.toDate(), TIMEZONE);
      const link = event.joinUrl ? ` (🔗 ${event.joinUrl})` : "";
      lines.push(`🕐 ${time} — ${event.title}${link}`);
    }
  }
  if (slackCount > 0) {
    lines.push("");
    lines.push(`💬 Slack: ${slackCount} הודעות ישירות/אזכורים היום`);
  }
  return lines.join("\n");
}

async function countTodaySlackAlerts(uid: string, start: Date, end: Date): Promise<number> {
  const snap = await db.collection("slackMessages")
    .where("uid", "==", uid)
    .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("timestamp", "<", admin.firestore.Timestamp.fromDate(end))
    .get();
  return snap.docs.filter((d) => d.data().isDM || d.data().isMention).length;
}

async function processReminders(
  uid: string, settings: SettingsDoc, now: Date, apiUrl: string, instanceId: string, token: string
): Promise<void> {
  const offsets = settings.reminders.offsetsMinutes;
  if (offsets.length === 0) return;
  const maxOffset = Math.max(...offsets);
  const windowEnd = new Date(now.getTime() + maxOffset * 60 * 1000 + TICK_WINDOW_MS);

  const eventsSnap = await db.collection("events")
    .where("uid", "==", uid)
    .where("start", ">=", admin.firestore.Timestamp.fromDate(now))
    .where("start", "<=", admin.firestore.Timestamp.fromDate(windowEnd))
    .get();
  if (eventsSnap.empty) return;

  const sentLogRef = db.doc(`sentLog/${uid}`);
  const sentLogSnap = await sentLogRef.get();
  const sentReminders: Record<string, boolean> = (sentLogSnap.data()?.reminders as Record<string, boolean>) ?? {};
  const newlySent: Record<string, boolean> = {};

  for (const doc of eventsSnap.docs) {
    const event = doc.data() as EventDoc;
    if (event.status !== "confirmed") continue;
    const startMs = event.start.toMillis();

    for (const offsetMinutes of offsets) {
      const dueAt = startMs - offsetMinutes * 60 * 1000;
      const diff = dueAt - now.getTime();
      // Fires once per offset per event, in the 5-min tick window dueAt falls into.
      if (diff < 0 || diff >= TICK_WINDOW_MS) continue;
      // startMs in the key makes a rescheduled event get a fresh key automatically —
      // no stale-reminder-on-reschedule bug, no invalidation bookkeeping needed.
      const key = `${doc.id}_${offsetMinutes}_${startMs}`;
      if (sentReminders[key] || newlySent[key]) continue;

      await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, buildReminderMessage(event, offsetMinutes));
      newlySent[key] = true;
    }
  }

  if (Object.keys(newlySent).length > 0) {
    await sentLogRef.set({ reminders: newlySent }, { merge: true });
  }
}

// "weekdays" follows the Israeli work week (Sunday–Thursday), not the
// international Mon–Fri convention — Friday/Saturday are skipped.
function isIsraeliWorkday(dayOfWeek: number): boolean {
  return dayOfWeek !== 5 && dayOfWeek !== 6;
}

async function processDigest(
  uid: string, settings: SettingsDoc, now: Date, apiUrl: string, instanceId: string, token: string
): Promise<void> {
  if (!settings.digest.enabled || settings.digest.times.length === 0) return;
  const parts = zoneParts(now, TIMEZONE);
  if (settings.digest.frequency === "weekdays" && !isIsraeliWorkday(parts.dayOfWeek)) return;

  const nowMinutes = parts.hour * 60 + parts.minute;
  const dueTimes = settings.digest.times.filter((time) => {
    const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
    const targetMinutes = (hh || 0) * 60 + (mm || 0);
    return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + 5;
  });
  if (dueTimes.length === 0) return;

  const sentLogRef = db.doc(`sentLog/${uid}`);
  const sentLogSnap = await sentLogRef.get();
  const sentDigests: Record<string, boolean> = (sentLogSnap.data()?.digest as Record<string, boolean>) ?? {};
  const pending = dueTimes.filter((time) => !sentDigests[`${parts.dateStr}_${time}`]);
  if (pending.length === 0) return;

  const { start, end } = localDayBoundsUtc(now, TIMEZONE);
  const eventsSnap = await db.collection("events")
    .where("uid", "==", uid)
    .where("start", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("start", "<", admin.firestore.Timestamp.fromDate(end))
    .get();
  const events = eventsSnap.docs.map((d) => d.data() as EventDoc).filter((e) => e.status === "confirmed");
  const slackCount = await countTodaySlackAlerts(uid, start, end);
  const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "long" }).format(now);
  const message = buildDigestMessage(events, dateLabel, slackCount);

  const newlySent: Record<string, boolean> = {};
  for (const time of pending) {
    await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, message);
    newlySent[`${parts.dateStr}_${time}`] = true;
  }
  await sentLogRef.set({ digest: newlySent }, { merge: true });
}

export const whatsappSchedulerTick = functions.scheduler.onSchedule(
  { schedule: "*/5 * * * *", secrets: [greenApiUrl, greenApiInstance, greenApiToken] },
  async () => {
    const apiUrl = greenApiUrl.value();
    const instanceId = greenApiInstance.value();
    const token = greenApiToken.value();
    const now = new Date();

    const settingsSnap = await db.collection("settings").get();
    for (const doc of settingsSnap.docs) {
      const uid = doc.id;
      const settings = doc.data() as SettingsDoc;
      if (!settings.whatsapp?.enabled || !settings.whatsapp?.phone) continue;
      try {
        await processReminders(uid, settings, now, apiUrl, instanceId, token);
        await processDigest(uid, settings, now, apiUrl, instanceId, token);
      } catch (err) {
        console.error(`WhatsApp scheduler error for user ${uid}:`, err);
      }
    }
  }
);

export const sendTestWhatsAppCallable = functions.https.onCall(
  { secrets: [greenApiUrl, greenApiInstance, greenApiToken] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const kind = request.data?.kind as "reminder" | "digest";
    if (kind !== "reminder" && kind !== "digest") {
      throw new functions.https.HttpsError("invalid-argument", "kind must be 'reminder' or 'digest'");
    }

    const settingsSnap = await db.doc(`settings/${uid}`).get();
    const settings = (settingsSnap.data() as SettingsDoc | undefined) ?? DEFAULT_SETTINGS;
    if (!settings.whatsapp.phone) {
      throw new functions.https.HttpsError("failed-precondition", "לא הוגדר מספר WhatsApp בהגדרות");
    }

    const apiUrl = greenApiUrl.value();
    const instanceId = greenApiInstance.value();
    const token = greenApiToken.value();

    if (kind === "reminder") {
      const now = admin.firestore.Timestamp.now();
      const upcomingSnap = await db.collection("events")
        .where("uid", "==", uid)
        .where("start", ">=", now)
        .orderBy("start", "asc")
        .limit(5)
        .get();
      const upcoming = upcomingSnap.docs.map((d) => d.data() as EventDoc).find((e) => e.status === "confirmed");
      const message = upcoming
        ? buildReminderMessage(upcoming, settings.reminders.offsetsMinutes[0] ?? 15)
        : "⏰ תזכורת לדוגמה — אין פגישה קרובה ביומן כרגע, אך כך תיראה הודעת תזכורת.\n\n📌 פגישת דוגמה\n🕐 14:00\n🔗 https://meet.google.com/abc-defg-hij";
      await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, message);
    } else {
      const { start, end } = localDayBoundsUtc(new Date(), TIMEZONE);
      const eventsSnap = await db.collection("events")
        .where("uid", "==", uid)
        .where("start", ">=", admin.firestore.Timestamp.fromDate(start))
        .where("start", "<", admin.firestore.Timestamp.fromDate(end))
        .get();
      const events = eventsSnap.docs.map((d) => d.data() as EventDoc).filter((e) => e.status === "confirmed");
      const slackCount = await countTodaySlackAlerts(uid, start, end);
      const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "long" }).format(new Date());
      await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, buildDigestMessage(events, dateLabel, slackCount));
    }

    return { ok: true };
  }
);
