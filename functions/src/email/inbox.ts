import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import axios from "axios";
import { google, gmail_v1 } from "googleapis";
import { db } from "../firebase";
import { ConnectedAccountDoc } from "../types";
import { getValidAccessToken } from "../accounts/tokenHelper";
import { googleClientId, googleClientSecret } from "../oauth/google";
import {
  buildGmailMetadataBatchBody,
  extractBatchBoundary,
  normalizeGmailMetadataMessage,
  parseGmailBatchResponse,
  type GmailMetadataPayload,
} from "./gmailBatch";

interface NormalizedMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  isRead: boolean;
}

function gmailClient(accessToken: string): gmail_v1.Gmail {
  // Use googleapis' own bundled OAuth2 client — see the comment in
  // calendar/sync.ts's googleCalendarClient for why.
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

async function fetchGmailMessages(
  accessToken: string, pageToken?: string
): Promise<{ items: NormalizedMessage[]; nextPageToken?: string }> {
  const gmail = gmailClient(accessToken);
  const listResp = await gmail.users.messages.list({
    userId: "me", labelIds: ["INBOX"], maxResults: 20, pageToken,
  });
  const ids = (listResp.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    return { items: [], nextPageToken: listResp.data.nextPageToken ?? undefined };
  }

  const boundary = `batch_${Date.now()}`;
  const body = buildGmailMetadataBatchBody(ids, boundary);
  const batchResp = await axios.post(
    "https://www.googleapis.com/batch/gmail/v1",
    body,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/mixed; boundary=${boundary}`,
      },
      // Gmail returns multipart text; do not force JSON parse
      responseType: "text",
      transformResponse: [(data) => data],
    },
  );

  const respBoundary =
    extractBatchBoundary(String(batchResp.headers["content-type"] ?? "")) ?? boundary;
  const byId = parseGmailBatchResponse(String(batchResp.data), respBoundary);

  const items: NormalizedMessage[] = [];
  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw || typeof raw !== "object") continue;
    items.push(normalizeGmailMetadataMessage(id, raw as GmailMetadataPayload));
  }

  return { items, nextPageToken: listResp.data.nextPageToken ?? undefined };
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime: string;
  bodyPreview?: string;
  isRead: boolean;
}

async function fetchGraphMessages(
  accessToken: string, pageToken?: string
): Promise<{ items: NormalizedMessage[]; nextPageToken?: string }> {
  const url = pageToken ??
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages" +
    "?$select=id,subject,from,receivedDateTime,bodyPreview,isRead&$top=20&$orderby=receivedDateTime desc";
  const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const items: NormalizedMessage[] = (data.value ?? []).map((m: GraphMessage) => ({
    id: m.id,
    from: m.from?.emailAddress?.address
      ? `${m.from.emailAddress.name ?? ""} <${m.from.emailAddress.address}>`.trim()
      : "",
    subject: m.subject || "(ללא נושא)",
    snippet: m.bodyPreview ?? "",
    date: m.receivedDateTime,
    isRead: !!m.isRead,
  }));
  return { items, nextPageToken: data["@odata.nextLink"] };
}

export const listInboxMessagesCallable = functions.https.onCall(
  { secrets: [googleClientId, googleClientSecret] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const requestedAccountIds = request.data?.accountIds as string[] | undefined;
    const pageTokens = (request.data?.pageTokens as Record<string, string>) ?? {};

    const accountsSnap = requestedAccountIds && requestedAccountIds.length > 0
      ? await db.collection("connectedAccounts")
          .where("uid", "==", uid)
          .where(admin.firestore.FieldPath.documentId(), "in", requestedAccountIds)
          .get()
      : await db.collection("connectedAccounts").where("uid", "==", uid).where("status", "==", "active").get();

    const results: Record<string, {
      items: NormalizedMessage[]; nextPageToken?: string; accountColor: string; error?: string;
    }> = {};

    await Promise.all(accountsSnap.docs.map(async (doc) => {
      const accountId = doc.id;
      const account = doc.data() as ConnectedAccountDoc;
      try {
        const accessToken = await getValidAccessToken(accountId);
        const result = account.provider === "google"
          ? await fetchGmailMessages(accessToken, pageTokens[accountId])
          : await fetchGraphMessages(accessToken, pageTokens[accountId]);
        results[accountId] = { ...result, accountColor: account.displayColor };
      } catch (err) {
        results[accountId] = {
          items: [],
          accountColor: account.displayColor,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));

    return { results };
  }
);

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findGmailPart(
  parts: gmail_v1.Schema$MessagePart[] | undefined, mimeType: string
): gmail_v1.Schema$MessagePart | undefined {
  if (!parts) return undefined;
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) return part;
    if (part.parts) {
      const found = findGmailPart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}

function extractGmailBody(message: gmail_v1.Schema$Message): string {
  const payload = message.payload;
  if (!payload) return message.snippet ?? "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);

  const htmlPart = findGmailPart(payload.parts, "text/html");
  if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);
  const textPart = findGmailPart(payload.parts, "text/plain");
  if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
  return message.snippet ?? "";
}

export const getMessageBodyCallable = functions.https.onCall(
  { secrets: [googleClientId, googleClientSecret] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const { accountId, messageId } = (request.data ?? {}) as { accountId?: string; messageId?: string };
    if (!accountId || !messageId) {
      throw new functions.https.HttpsError("invalid-argument", "accountId and messageId required");
    }

    const accountSnap = await db.doc(`connectedAccounts/${accountId}`).get();
    if (!accountSnap.exists || (accountSnap.data() as ConnectedAccountDoc).uid !== uid) {
      throw new functions.https.HttpsError("not-found", "Account not found");
    }
    const account = accountSnap.data() as ConnectedAccountDoc;
    const accessToken = await getValidAccessToken(accountId);

    if (account.provider === "google") {
      const gmail = gmailClient(accessToken);
      const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      return { body: extractGmailBody(msg.data), contentType: "text/html" };
    }

    const { data } = await axios.get(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=body`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return {
      body: data.body?.content ?? "",
      contentType: data.body?.contentType === "html" ? "text/html" : "text/plain",
    };
  }
);
