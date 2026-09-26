import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { db } from "../firebase";
import { ReminderDoc, SettingsDoc } from "../types";
import { sendWhatsApp, WhatsAppQuotaExceededError, greenApiUrl, greenApiInstance, greenApiToken } from "./whatsapp";
import { parseCompletionReply, phonesMatch } from "./completionCode";

const BARE_REPLY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface GreenIncomingWebhook {
  typeWebhook?: string;
  instanceData?: { idInstance?: number | string; wid?: string };
  idMessage?: string;
  senderData?: {
    chatId?: string;
    sender?: string;
  };
  messageData?: {
    typeMessage?: string;
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string };
  };
  // Present on typeWebhook "quotaExceeded" — tells us which Developer-plan
  // limit was hit (e.g. the 3-correspondents/month cap) and current usage.
  quotaData?: { method?: string; used?: number; total?: number; status?: string; description?: string };
}

function extractText(payload: GreenIncomingWebhook): string | null {
  const md = payload.messageData;
  if (!md) return null;
  return md.textMessageData?.textMessage
    ?? md.extendedTextMessageData?.text
    ?? null;
}

function authorizationOk(header: string | undefined, expectedToken: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (trimmed === expectedToken) return true;
  if (trimmed === `Bearer ${expectedToken}`) return true;
  return false;
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

export const greenApiWebhook = functions.https.onRequest(
  {
    secrets: [greenApiUrl, greenApiInstance, greenApiToken],
    // Green API calls us without a Google identity token. Persist public
    // invoker across deploys so we don't regress to Cloud Run 401s.
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method not allowed");
      return;
    }

    const expectedToken = greenApiToken.value();
    const auth = req.header("Authorization") ?? req.header("authorization");
    if (!authorizationOk(auth, expectedToken)) {
      console.warn("greenApiWebhook unauthorized", { hasAuth: Boolean(auth) });
      res.status(401).send("unauthorized");
      return;
    }

    // Gen2 sometimes delivers JSON as a string / Buffer — normalize first.
    let payload: GreenIncomingWebhook = {};
    try {
      if (typeof req.body === "string") payload = JSON.parse(req.body);
      else if (Buffer.isBuffer(req.body)) payload = JSON.parse(req.body.toString("utf8"));
      else if (req.body && typeof req.body === "object") payload = req.body as GreenIncomingWebhook;
      else if ((req as unknown as { rawBody?: Buffer }).rawBody) {
        payload = JSON.parse((req as unknown as { rawBody: Buffer }).rawBody.toString("utf8"));
      }
    } catch (err) {
      console.error("greenApiWebhook body parse error", err);
      res.status(400).send("bad json");
      return;
    }

    const instanceId = String(payload.instanceData?.idInstance ?? "");
    if (instanceId && instanceId !== String(greenApiInstance.value())) {
      console.warn("greenApiWebhook wrong instance", instanceId);
      res.status(403).send("wrong instance");
      return;
    }

    // Process BEFORE acking. Cloud Functions may freeze the request after
    // res.send(), which previously dropped completion side-effects silently.
    try {
      // When the Green API WhatsApp is the user's own phone, replies typed on
      // the device arrive as outgoingMessageReceived (not incoming).
      const type = payload.typeWebhook;
      console.log("greenApiWebhook event", {
        type,
        textPreview: extractText(payload)?.slice(0, 40) ?? null,
        sender: payload.senderData?.sender ?? null,
        chatId: payload.senderData?.chatId ?? null,
      });

      if (type === "quotaExceeded") {
        // Surface the actual usage so it's visible in logs without having to
        // cross-reference the Green API console — see WhatsAppQuotaExceededError
        // for where sends themselves are detected and skipped.
        console.warn("greenApiWebhook quota exceeded", payload.quotaData ?? null);
        res.status(200).send("ok");
        return;
      }

      if (type !== "incomingMessageReceived" && type !== "outgoingMessageReceived") {
        res.status(200).send("ok");
        return;
      }

      const text = extractText(payload);
      if (!text) {
        console.log("greenApiWebhook skip: no text");
        res.status(200).send("ok");
        return;
      }

      const reply = parseCompletionReply(text);
      if (!reply) {
        console.log("greenApiWebhook skip: not a completion reply", text.slice(0, 40));
        res.status(200).send("ok");
        return;
      }

      // Incoming: sender is the user's phone. Outgoing-from-phone: sender is
      // the instance WID (also the user's phone in the self-notify setup).
      const sender = payload.senderData?.sender
        ?? payload.senderData?.chatId
        ?? payload.instanceData?.wid;
      if (!sender) {
        console.warn("greenApiWebhook skip: no sender");
        res.status(200).send("ok");
        return;
      }

      const owner = await findUidByPhone(sender);
      if (!owner) {
        console.warn("WhatsApp completion reply from unknown phone:", sender);
        res.status(200).send("ok");
        return;
      }

      console.log("greenApiWebhook completing", { uid: owner.uid, reply });

      const result = reply.kind === "code"
        ? await completeReminderByCode(owner.uid, reply.code)
        : await completeBare(owner.uid);
      const responseText = result.ok
        ? `✅ סומן כבוצע: ${result.title}`
        : `⚠️ לא הצלחתי לסמן כבוצע — ${result.reason}`;

      console.log("greenApiWebhook result", result);
      try {
        await sendWhatsApp(
          greenApiUrl.value(),
          greenApiInstance.value(),
          greenApiToken.value(),
          owner.phone,
          responseText,
        );
      } catch (err) {
        if (!(err instanceof WhatsAppQuotaExceededError)) throw err;
        // The reminder was still marked done above — only the confirmation
        // reply failed to deliver, so don't fail the whole webhook over it.
        console.warn("greenApiWebhook: quota exceeded sending completion reply", err.detail);
      }
      res.status(200).send("ok");
    } catch (err) {
      console.error("Green API webhook processing error:", err);
      if (!res.headersSent) res.status(500).send("error");
    }
  }
);
