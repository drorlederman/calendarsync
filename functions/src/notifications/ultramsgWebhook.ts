import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { db } from "../firebase";
import { ReminderDoc, SettingsDoc } from "../types";
import { defineSecret } from "firebase-functions/params";
import { sendWhatsApp, WhatsAppUnavailableError, whatsappSecrets, ultramsgInstance } from "./whatsapp";
import { parseCompletionReply, phonesMatch } from "./completionCode";

// UltraMsg webhooks carry no auth header or signature, so the webhook URL
// configured in the UltraMsg dashboard carries this secret as `?secret=`.
const webhookSecret = defineSecret("ULTRAMSG_WEBHOOK_SECRET");

const BARE_REPLY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// event_type "message_received" = a message sent to the instance's number;
// "message_create" = one created on it — including replies the user types on
// their own phone in the self-notify setup (and our own API sends, which are
// never a bare "בוצע [code]" so parseCompletionReply ignores them).
interface UltraMsgWebhook {
  event_type?: string;
  instanceId?: string | number;
  data?: {
    id?: string;
    from?: string;
    to?: string;
    type?: string;
    body?: string;
    fromMe?: boolean;
  };
}

function extractText(payload: UltraMsgWebhook): string | null {
  if (payload.data?.type && payload.data.type !== "chat") return null;
  return payload.data?.body || null;
}

function secretOk(given: unknown, expected: string): boolean {
  return typeof given === "string" && given.length > 0 && given === expected.trim();
}

async function findUidByPhone(senderChatId: string): Promise<{ uid: string; phone: string } | null> {
  const settingsSnap = await db.collection("settings").get();
  for (const doc of settingsSnap.docs) {
    const raw = doc.data() as Partial<SettingsDoc>;
    const phone = raw.whatsapp?.phone;
    if (!phone) continue;
    if (phonesMatch(phone, senderChatId)) {
      return { uid: doc.id, phone };
    }
  }
  return null;
}

type CompleteResult =
  | { ok: true; title: string }
  | { ok: false; reason: string };

async function markReminderDone(uid: string, reminderId: string): Promise<CompleteResult> {
  const reminderRef = db.doc(`reminders/${reminderId}`);
  const reminderSnap = await reminderRef.get();
  const reminder = reminderSnap.data() as ReminderDoc | undefined;
  if (!reminder || reminder.uid !== uid) return { ok: false, reason: "תזכורת לא נמצאה" };

  if (reminder.status === "done") {
    return { ok: true, title: reminder.title };
  }

  await reminderRef.update({
    status: "done",
    completedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  return { ok: true, title: reminder.title };
}

async function completeReminderByCode(uid: string, code: string): Promise<CompleteResult> {
  const indexSnap = await db.doc(`completionCodes/${code}`).get();
  if (!indexSnap.exists) return { ok: false, reason: "קוד לא נמצא" };

  const { uid: ownerUid, reminderId } = indexSnap.data() as { uid: string; reminderId: string };
  if (ownerUid !== uid) return { ok: false, reason: "קוד לא שייך למשתמש זה" };

  return markReminderDone(uid, reminderId);
}

/**
 * Completes a reminder for a bare "בוצע" reply (no code):
 * 1. the last reminder we notified this user about (if still open), else
 * 2. a single overdue open reminder, if there's exactly one overdue, else
 * 3. the single open reminder, if there's exactly one.
 * Otherwise asks the user to include the code.
 */
async function completeBare(uid: string): Promise<CompleteResult> {
  const sentLogSnap = await db.doc(`sentLog/${uid}`).get();
  const lastTask = sentLogSnap.data()?.lastTask as { reminderId?: string; at?: number } | undefined;

  if (lastTask?.reminderId && typeof lastTask.at === "number" && Date.now() - lastTask.at <= BARE_REPLY_MAX_AGE_MS) {
    const snap = await db.doc(`reminders/${lastTask.reminderId}`).get();
    const reminder = snap.data() as ReminderDoc | undefined;
    if (reminder && reminder.uid === uid && reminder.status === "open") {
      return markReminderDone(uid, lastTask.reminderId);
    }
  }

  const openSnap = await db.collection("reminders")
    .where("uid", "==", uid)
    .where("status", "==", "open")
    .get();

  if (openSnap.empty) {
    return { ok: false, reason: "אין תזכורות פתוחות" };
  }
  if (openSnap.size === 1) {
    return markReminderDone(uid, openSnap.docs[0].id);
  }

  const nowMs = Date.now();
  const overdue = openSnap.docs.filter((d) => {
    const due = (d.data() as ReminderDoc).dueAt;
    return due && due.toMillis() < nowMs;
  });
  if (overdue.length === 1) {
    return markReminderDone(uid, overdue[0].id);
  }

  return { ok: false, reason: "יש כמה תזכורות פתוחות — השב עם הקוד שמופיע בהודעה, למשל: בוצע AB12" };
}

export const ultramsgWebhook = functions.https.onRequest(
  {
    secrets: [...whatsappSecrets, webhookSecret],
    // UltraMsg calls us without a Google identity token. Persist public
    // invoker across deploys so we don't regress to Cloud Run 401s.
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method not allowed");
      return;
    }

    if (!secretOk(req.query.secret, webhookSecret.value())) {
      console.warn("ultramsgWebhook unauthorized", { hasSecret: Boolean(req.query.secret) });
      res.status(401).send("unauthorized");
      return;
    }

    // Gen2 sometimes delivers JSON as a string / Buffer — normalize first.
    let payload: UltraMsgWebhook = {};
    try {
      if (typeof req.body === "string") payload = JSON.parse(req.body);
      else if (Buffer.isBuffer(req.body)) payload = JSON.parse(req.body.toString("utf8"));
      else if (req.body && typeof req.body === "object") payload = req.body as UltraMsgWebhook;
      else if ((req as unknown as { rawBody?: Buffer }).rawBody) {
        payload = JSON.parse((req as unknown as { rawBody: Buffer }).rawBody.toString("utf8"));
      }
    } catch (err) {
      console.error("ultramsgWebhook body parse error", err);
      res.status(400).send("bad json");
      return;
    }

    // The secret holds "instance193947"; the payload carries just "193947".
    const instanceId = String(payload.instanceId ?? "").replace(/\D/g, "");
    if (instanceId && instanceId !== ultramsgInstance.value().replace(/\D/g, "")) {
      console.warn("ultramsgWebhook wrong instance", instanceId);
      res.status(403).send("wrong instance");
      return;
    }

    // Process BEFORE acking. Cloud Functions may freeze the request after
    // res.send(), which previously dropped completion side-effects silently.
    try {
      const type = payload.event_type;
      console.log("ultramsgWebhook event", {
        type,
        textPreview: extractText(payload)?.slice(0, 40) ?? null,
        from: payload.data?.from ?? null,
        fromMe: payload.data?.fromMe ?? null,
      });

      if (type !== "message_received" && type !== "message_create") {
        res.status(200).send("ok");
        return;
      }

      const text = extractText(payload);
      if (!text) {
        console.log("ultramsgWebhook skip: no text");
        res.status(200).send("ok");
        return;
      }

      const reply = parseCompletionReply(text);
      if (!reply) {
        console.log("ultramsgWebhook skip: not a completion reply", text.slice(0, 40));
        res.status(200).send("ok");
        return;
      }

      // Received: `from` is the user's phone. Created on the instance's own
      // phone: `from` is the instance number (also the user's phone in the
      // self-notify setup).
      const sender = payload.data?.from;
      if (!sender) {
        console.warn("ultramsgWebhook skip: no sender");
        res.status(200).send("ok");
        return;
      }

      const owner = await findUidByPhone(sender);
      if (!owner) {
        console.warn("WhatsApp completion reply from unknown phone:", sender);
        res.status(200).send("ok");
        return;
      }

      console.log("ultramsgWebhook completing", { uid: owner.uid, reply });

      const result = reply.kind === "code"
        ? await completeReminderByCode(owner.uid, reply.code)
        : await completeBare(owner.uid);
      const responseText = result.ok
        ? `✅ סומן כבוצע: ${result.title}`
        : `⚠️ לא הצלחתי לסמן כבוצע — ${result.reason}`;

      console.log("ultramsgWebhook result", result);
      try {
        await sendWhatsApp(owner.phone, responseText);
      } catch (err) {
        if (!(err instanceof WhatsAppUnavailableError)) throw err;
        // The reminder was still marked done above — only the confirmation
        // reply failed to deliver, so don't fail the whole webhook over it.
        console.warn("ultramsgWebhook: WhatsApp unavailable sending completion reply", err.detail);
      }
      res.status(200).send("ok");
    } catch (err) {
      console.error("UltraMsg webhook processing error:", err);
      if (!res.headersSent) res.status(500).send("error");
    }
  }
);
