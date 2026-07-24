import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { db } from "../firebase";
import { ConnectedAccountDoc } from "../types";
import { accountId } from "../accounts/connect";
import { getValidAccessToken } from "../accounts/tokenHelper";
import { verifySlackSignature } from "./signature";
import { isMention, isDirectMessage } from "./mentionDetection";
import { getSlackChannelName, getSlackUserName } from "./client";
import { sendWhatsApp, greenApiUrl, greenApiInstance, greenApiToken } from "../notifications/whatsapp";

export const slackSigningSecret = defineSecret("SLACK_SIGNING_SECRET");

interface SlackMessageEvent {
  type: string;
  channel: string;
  channel_type?: string;
  user?: string;
  text?: string;
  ts: string;
  bot_id?: string;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  team_id?: string;
  event?: SlackMessageEvent;
}

async function handleAccountRevoked(teamId: string): Promise<void> {
  const id = accountId("slack", teamId);
  const ref = db.doc(`connectedAccounts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({
    status: "reauth_required",
    errorMessage: "Slack access was revoked or the app was uninstalled",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleMessageEvent(teamId: string, event: SlackMessageEvent): Promise<void> {
  if (event.bot_id || !event.user) return; // ignore bot messages and messages with no author

  const id = accountId("slack", teamId);
  const accountRef = db.doc(`connectedAccounts/${id}`);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) return; // event for a workspace we no longer track — safe no-op

  const account = accountSnap.data() as ConnectedAccountDoc;
  if (!account.slackUserId || account.status !== "active") return;

  const accessToken = await getValidAccessToken(id);
  const isDM = isDirectMessage(event.channel_type ?? "");
  const mentioned = isMention(event.text ?? "", account.slackUserId);

  const [channelName, fromUserName] = await Promise.all([
    getSlackChannelName(accessToken, event.channel),
    getSlackUserName(accessToken, event.user),
  ]);

  const msgId = `${id}_${event.channel}_${event.ts}`;
  const msgRef = db.doc(`slackMessages/${msgId}`);
  await msgRef.set(
    {
      uid: account.uid,
      connectedAccountId: id,
      channelId: event.channel,
      channelName,
      isDM,
      fromUserName,
      text: event.text ?? "",
      isMention: mentioned,
      timestamp: admin.firestore.Timestamp.fromMillis(Math.floor(parseFloat(event.ts) * 1000)),
      color: account.displayColor,
      notifiedViaWhatsApp: false,
    },
    { merge: true }
  );

  if (!isDM && !mentioned) return;

  // Idempotency: re-read the doc's own flag rather than a separate dedup
  // collection — Slack redelivers events on timeout, and this makes a
  // redelivery a safe no-op. Mirrors the accepted "rare duplicate over rare
  // miss" trade-off already used for calendar reminders in notifications/scheduler.ts.
  const freshSnap = await msgRef.get();
  if (freshSnap.data()?.notifiedViaWhatsApp) return;

  const settingsSnap = await db.doc(`settings/${account.uid}`).get();
  const settings = settingsSnap.data();
  if (!settings?.whatsapp?.enabled || !settings.whatsapp.phone) return;

  const kind = isDM ? "הודעה ישירה" : `אזכור בערוץ ${channelName}`;
  const message = `💬 [Slack] ${kind} מ-${fromUserName}:\n${event.text ?? ""}`;
  await sendWhatsApp(greenApiUrl.value(), greenApiInstance.value(), greenApiToken.value(), settings.whatsapp.phone, message);
  await msgRef.update({ notifiedViaWhatsApp: true });
}

export const slackEventsWebhook = functions.https.onRequest(
  { secrets: [slackSigningSecret, greenApiUrl, greenApiInstance, greenApiToken] },
  async (req, res) => {
    const timestamp = req.header("X-Slack-Request-Timestamp") ?? "";
    const signature = req.header("X-Slack-Signature") ?? "";
    const rawBody = (req as unknown as { rawBody: Buffer }).rawBody?.toString("utf8") ?? "";

    if (!verifySlackSignature(slackSigningSecret.value(), timestamp, rawBody, signature)) {
      res.status(401).send("invalid signature");
      return;
    }

    const payload = req.body as SlackEventPayload;

    if (payload.type === "url_verification") {
      res.json({ challenge: payload.challenge });
      return;
    }

    // Ack immediately — Slack retries aggressively if it doesn't get a fast 200.
    res.status(200).send("ok");

    try {
      if (!payload.team_id) return;
      const eventType = payload.event?.type;

      if (eventType === "app_uninstalled" || eventType === "tokens_revoked") {
        await handleAccountRevoked(payload.team_id);
        return;
      }
      if (eventType === "message" && payload.event) {
        await handleMessageEvent(payload.team_id, payload.event);
      }
    } catch (err) {
      console.error("Slack webhook processing error:", err);
    }
  }
);
