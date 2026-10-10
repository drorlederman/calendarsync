import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { db } from "../firebase";
import { EventDoc, ReminderDoc, SettingsDoc, DEFAULT_SETTINGS, resolveReminderLevel } from "../types";
import { sendWhatsApp, WhatsAppUnavailableError, whatsappSecrets } from "./whatsapp";
import { TIMEZONE, zoneParts, localDayBoundsUtc, fmtTime, fmtDateTime } from "./timezone";
import { pruneNagKeys, shouldFireNag } from "./nag";
import { ensureCompletionCode } from "./ensureCompletionCode";
import { processCulture } from "../culture/notify";

const TICK_WINDOW_MS = 5 * 60 * 1000;
// Task alerts fire on the first tick at-or-after their due moment (grace
// window), so a missed tick still delivers — but never for moments more than
// this stale, to avoid a flood of ancient alerts after a long outage.
const TASK_GRACE_MS = 24 * 60 * 60 * 1000;

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

// Task/reminder alert — deliberately distinct from the meeting reminder above:
// 🔔 (not ⏰) plus a colour dot (🔴 high / 🟠 normal) so it reads as its own
// kind at a glance, matching the accent colour the reminders screen uses.
function reminderDot(reminder: ReminderDoc): string {
  const urgency = resolveReminderLevel(reminder.urgency, reminder.priority);
  const importance = resolveReminderLevel(reminder.importance, reminder.priority);
  return urgency === "high" || importance === "high" ? "🔴" : "🟠";
}

function buildTaskMessage(
  reminder: ReminderDoc,
  kind: "remindAt" | "lead" | "nag",
  opts?: { offsetMinutes?: number; completionCode?: string },
): string {
  const offsetMinutes = opts?.offsetMinutes;
  const completionCode = opts?.completionCode ?? reminder.completionCode;
  const dot = reminderDot(reminder);
  const header = kind === "nag"
    ? `🔔 ${dot} נודניק יומי — עדיין פתוח`
    : kind === "lead" && offsetMinutes && offsetMinutes > 0
      ? `🔔 ${dot} תזכורת משימה — ${fmtOffset(offsetMinutes)} לפני היעד`
      : `🔔 ${dot} תזכורת משימה`;
  const lines: string[] = [header, "", `📌 ${reminder.title}`];
  if (reminder.dueAt) lines.push(`🗓️ יעד: ${fmtDateTime(reminder.dueAt.toDate(), TIMEZONE)}`);
  if (reminder.notes) lines.push(`📝 ${reminder.notes}`);
  if (reminder.source?.link) lines.push(`🔗 ${reminder.source.link}`);
  else if (reminder.source?.label) lines.push(`↩️ ${reminder.source.label}`);
  if (completionCode) {
    lines.push("");
    lines.push(`לסיום השב: בוצע ${completionCode}`);
  }
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

// Returns true when WhatsApp turned out to be unavailable mid-batch — the
// caller uses that to skip the rest of this tick's sends for this user
// rather than throwing more of the same failure at UltraMsg.
async function processReminders(
  uid: string, settings: SettingsDoc, now: Date
): Promise<boolean> {
  const offsets = settings.reminders.offsetsMinutes;
  if (offsets.length === 0) return false;
  const maxOffset = Math.max(...offsets);
  const windowEnd = new Date(now.getTime() + maxOffset * 60 * 1000 + TICK_WINDOW_MS);

  const eventsSnap = await db.collection("events")
    .where("uid", "==", uid)
    .where("start", ">=", admin.firestore.Timestamp.fromDate(now))
    .where("start", "<=", admin.firestore.Timestamp.fromDate(windowEnd))
    .get();
  if (eventsSnap.empty) return false;

  const sentLogRef = db.doc(`sentLog/${uid}`);
  const sentLogSnap = await sentLogRef.get();
  const sentReminders: Record<string, boolean> = (sentLogSnap.data()?.reminders as Record<string, boolean>) ?? {};
  const newlySent: Record<string, boolean> = {};
  let unavailable = false;

  outer:
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

      try {
        await sendWhatsApp(settings.whatsapp.phone, buildReminderMessage(event, offsetMinutes));
      } catch (err) {
        if (!(err instanceof WhatsAppUnavailableError)) throw err;
        console.warn(`WhatsApp unavailable (uid=${uid}) — reminder "${key}" not delivered, will retry later`, err.detail);
        unavailable = true;
        break outer;
      }
      newlySent[key] = true;
    }
  }

  // Persist whatever did go out before WhatsApp became unavailable — only the failed one
  // (and anything not yet attempted) is left unmarked, so it retries later.
  if (Object.keys(newlySent).length > 0) {
    await sentLogRef.set({ reminders: newlySent }, { merge: true });
  }
  return unavailable;
}

type TaskFire = { key: string; at: number; kind: "remindAt" | "lead"; offsetMinutes?: number };

// All the moments a reminder should alert at: its explicit "remind me at"
// instant, plus dueAt minus each configured lead offset. The dueMs/remindMs
// baked into each key means editing a date yields fresh keys automatically —
// same reschedule-safety trick as processReminders.
function taskFireTimes(id: string, r: ReminderDoc): TaskFire[] {
  const out: TaskFire[] = [];
  if (r.remindAt) {
    const ms = r.remindAt.toMillis();
    out.push({ key: `${id}_remindAt_${ms}`, at: ms, kind: "remindAt" });
  }
  if (r.dueAt) {
    const dueMs = r.dueAt.toMillis();
    for (const off of r.leadOffsetsMinutes ?? []) {
      out.push({ key: `${id}_lead_${off}_${dueMs}`, at: dueMs - off * 60 * 1000, kind: "lead", offsetMinutes: off });
    }
  }
  return out;
}

async function processTaskReminders(
  uid: string, settings: SettingsDoc, now: Date
): Promise<boolean> {
  const snap = await db.collection("reminders")
    .where("uid", "==", uid)
    .where("status", "==", "open")
    .get();
  if (snap.empty) return false;

  const sentLogRef = db.doc(`sentLog/${uid}`);
  const sentLogSnap = await sentLogRef.get();
  const sentTasks: Record<string, boolean> = (sentLogSnap.data()?.tasks as Record<string, boolean>) ?? {};
  const newlySent: Record<string, boolean> = {};
  const nowMs = now.getTime();
  const todayStr = zoneParts(now, TIMEZONE).dateStr;
  // Track the last reminder we actually messaged about this tick, so a bare
  // "בוצע" reply (no code) can complete the reminder the user was just nudged on.
  let lastNotifiedReminderId: string | null = null;
  let unavailable = false;

  outer:
  for (const doc of snap.docs) {
    const reminder = doc.data() as ReminderDoc;
    let code: string | undefined = reminder.completionCode;
    const ensureCode = async () => {
      if (code) return code;
      code = await ensureCompletionCode(doc.id, reminder);
      return code;
    };

    for (const fire of taskFireTimes(doc.id, reminder)) {
      if (fire.at > nowMs) continue;                 // not due yet
      if (nowMs - fire.at > TASK_GRACE_MS) continue; // too stale to alert about now
      if (sentTasks[fire.key] || newlySent[fire.key]) continue;
      const completionCode = await ensureCode();
      try {
        await sendWhatsApp(
          settings.whatsapp.phone,
          buildTaskMessage(reminder, fire.kind, { offsetMinutes: fire.offsetMinutes, completionCode })
        );
      } catch (err) {
        if (!(err instanceof WhatsAppUnavailableError)) throw err;
        console.warn(`WhatsApp unavailable (uid=${uid}) — task "${fire.key}" not delivered, will retry later`, err.detail);
        unavailable = true;
        break outer;
      }
      newlySent[fire.key] = true;
      lastNotifiedReminderId = doc.id;
    }

    const nag = shouldFireNag({
      reminderId: doc.id,
      reminder: {
        nagEnabled: reminder.nagEnabled,
        status: reminder.status,
        remindAt: reminder.remindAt,
        dueAt: reminder.dueAt,
        createdAt: reminder.createdAt as { toDate?: () => Date } | null,
      },
      now,
      timeZone: TIMEZONE,
    });
    if (nag.fire && nag.key && !sentTasks[nag.key] && !newlySent[nag.key]) {
      const completionCode = await ensureCode();
      try {
        await sendWhatsApp(
          settings.whatsapp.phone,
          buildTaskMessage(reminder, "nag", { completionCode })
        );
      } catch (err) {
        if (!(err instanceof WhatsAppUnavailableError)) throw err;
        console.warn(`WhatsApp unavailable (uid=${uid}) — nag "${nag.key}" not delivered, will retry later`, err.detail);
        unavailable = true;
        break outer;
      }
      newlySent[nag.key] = true;
      lastNotifiedReminderId = doc.id;
    }
  }

  if (lastNotifiedReminderId) {
    await sentLogRef.set(
      { lastTask: { reminderId: lastNotifiedReminderId, at: nowMs } },
      { merge: true }
    );
  }

  if (Object.keys(newlySent).length > 0) {
    const merged = pruneNagKeys({ ...sentTasks, ...newlySent }, todayStr);
    await sentLogRef.set({ tasks: merged }, { merge: true });
  }
  return unavailable;
}

// "weekdays" follows the Israeli work week (Sunday–Thursday), not the
// international Mon–Fri convention — Friday/Saturday are skipped.
function isIsraeliWorkday(dayOfWeek: number): boolean {
  return dayOfWeek !== 5 && dayOfWeek !== 6;
}

async function processDigest(
  uid: string, settings: SettingsDoc, now: Date
): Promise<boolean> {
  if (!settings.digest.enabled || settings.digest.times.length === 0) return false;
  const parts = zoneParts(now, TIMEZONE);
  if (settings.digest.frequency === "weekdays" && !isIsraeliWorkday(parts.dayOfWeek)) return false;

  const nowMinutes = parts.hour * 60 + parts.minute;
  const dueTimes = settings.digest.times.filter((time) => {
    const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
    const targetMinutes = (hh || 0) * 60 + (mm || 0);
    return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + 5;
  });
  if (dueTimes.length === 0) return false;

  const sentLogRef = db.doc(`sentLog/${uid}`);
  const sentLogSnap = await sentLogRef.get();
  const sentDigests: Record<string, boolean> = (sentLogSnap.data()?.digest as Record<string, boolean>) ?? {};
  const pending = dueTimes.filter((time) => !sentDigests[`${parts.dateStr}_${time}`]);
  if (pending.length === 0) return false;

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
  let unavailable = false;
  for (const time of pending) {
    try {
      await sendWhatsApp(settings.whatsapp.phone, message);
    } catch (err) {
      if (!(err instanceof WhatsAppUnavailableError)) throw err;
      console.warn(`WhatsApp unavailable (uid=${uid}) — digest for ${time} not delivered, will retry later`, err.detail);
      unavailable = true;
      break;
    }
    newlySent[`${parts.dateStr}_${time}`] = true;
  }
  if (Object.keys(newlySent).length > 0) {
    await sentLogRef.set({ digest: newlySent }, { merge: true });
  }
  return unavailable;
}

export const whatsappSchedulerTick = functions.scheduler.onSchedule(
  { schedule: "*/5 * * * *", secrets: whatsappSecrets },
  async () => {
    const now = new Date();

    const settingsSnap = await db.collection("settings").get();
    for (const doc of settingsSnap.docs) {
      const uid = doc.id;
      // Settings docs written by individual UI sections only contain that
      // section's field (e.g. WhatsAppSection writes just `whatsapp`), so
      // `reminders`/`digest` can be missing or null. Fill from defaults so the
      // processors never dereference undefined.
      const raw = doc.data() as Partial<SettingsDoc>;
      const settings: SettingsDoc = {
        whatsapp: raw.whatsapp ?? DEFAULT_SETTINGS.whatsapp,
        reminders: raw.reminders ?? DEFAULT_SETTINGS.reminders,
        digest: raw.digest ?? DEFAULT_SETTINGS.digest,
        culture: { ...DEFAULT_SETTINGS.culture, ...(raw.culture ?? {}) },
      };
      if (!settings.whatsapp.enabled || !settings.whatsapp.phone) continue;
      try {
        // Each processor returns true once WhatsApp turns out to be
        // unavailable — skip the rest of this user's sends for the tick rather than
        // repeating the same failure (and log spam) against every remaining
        // reminder/digest. Nothing already sent is lost; the rest retries
        // on the next tick once the instance is linked again.
        const remindersBlocked = await processReminders(uid, settings, now);
        const tasksBlocked = remindersBlocked || await processTaskReminders(uid, settings, now);
        const digestBlocked = tasksBlocked || await processDigest(uid, settings, now);
        if (!digestBlocked) await processCulture(uid, settings, now);
      } catch (err) {
        console.error(`WhatsApp scheduler error for user ${uid}:`, err);
      }
    }
  }
);

export const sendTestWhatsAppCallable = functions.https.onCall(
  { secrets: whatsappSecrets },
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

    try {
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
        await sendWhatsApp(settings.whatsapp.phone, message);
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
        await sendWhatsApp(settings.whatsapp.phone, buildDigestMessage(events, dateLabel, slackCount));
      }
    } catch (err) {
      if (err instanceof WhatsAppUnavailableError) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "חיבור ה-WhatsApp (UltraMsg) מנותק — יש לסרוק מחדש את קוד ה-QR בלוח הבקרה של UltraMsg"
        );
      }
      throw err;
    }

    return { ok: true };
  }
);

// Sends one reminder to WhatsApp immediately — powers the "send now" action on
// a reminder card, and lets the user verify delivery without waiting for the
// 5-minute tick.
export const sendReminderNowCallable = functions.https.onCall(
  { secrets: whatsappSecrets },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const reminderId = request.data?.reminderId as string | undefined;
    if (!reminderId) throw new functions.https.HttpsError("invalid-argument", "reminderId required");

    const settingsSnap = await db.doc(`settings/${uid}`).get();
    const settings = (settingsSnap.data() as SettingsDoc | undefined) ?? DEFAULT_SETTINGS;
    if (!settings.whatsapp.enabled || !settings.whatsapp.phone) {
      throw new functions.https.HttpsError("failed-precondition", "עדכוני WhatsApp כבויים או שלא הוגדר מספר בהגדרות");
    }

    const reminderSnap = await db.doc(`reminders/${reminderId}`).get();
    const reminder = reminderSnap.data() as ReminderDoc | undefined;
    if (!reminder || reminder.uid !== uid) {
      throw new functions.https.HttpsError("not-found", "תזכורת לא נמצאה");
    }

    const completionCode = await ensureCompletionCode(reminderId, reminder);
    try {
      await sendWhatsApp(
        settings.whatsapp.phone, buildTaskMessage(reminder, "remindAt", { completionCode })
      );
    } catch (err) {
      if (err instanceof WhatsAppUnavailableError) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "חיבור ה-WhatsApp (UltraMsg) מנותק — יש לסרוק מחדש את קוד ה-QR בלוח הבקרה של UltraMsg"
        );
      }
      throw err;
    }
    await db.doc(`sentLog/${uid}`).set(
      { lastTask: { reminderId, at: Date.now() } },
      { merge: true }
    );
    return { ok: true };
  }
);
