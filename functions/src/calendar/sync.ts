import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import axios from "axios";
import { google, calendar_v3 } from "googleapis";
import { db } from "../firebase";
import { ConnectedAccountDoc, EventDoc } from "../types";
import { getValidAccessToken, ReauthRequiredError } from "../accounts/tokenHelper";
import { extractJoinInfoGoogle, extractJoinInfoMicrosoft, GraphEvent } from "./meetingLink";
import { googleClientId, googleClientSecret } from "../oauth/google";
import { msClientId, msClientSecret } from "../oauth/microsoft";

const WINDOW_PAST_MS = 24 * 60 * 60 * 1000; // 1 day back
const WINDOW_FUTURE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days forward
const STALE_AFTER_MS = 25 * 60 * 1000; // survives 2+ ten-minute sync cycles

function eventDocId(connectedAccountId: string, externalEventId: string): string {
  return `${connectedAccountId}_${externalEventId}`;
}

/** Batches Firestore writes in chunks of 400 (below the 500 op/batch cap). */
class BatchWriter {
  private batch = db.batch();
  private count = 0;

  async set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) {
    this.batch.set(ref, data, { merge: true });
    this.count++;
    if (this.count >= 400) await this.flush();
  }

  async delete(ref: FirebaseFirestore.DocumentReference) {
    this.batch.delete(ref);
    this.count++;
    if (this.count >= 400) await this.flush();
  }

  async flush() {
    if (this.count === 0) return;
    await this.batch.commit();
    this.batch = db.batch();
    this.count = 0;
  }
}

function googleCalendarClient(accessToken: string): calendar_v3.Calendar {
  // Use googleapis' own bundled OAuth2 client (not the standalone
  // google-auth-library package) — the two ship slightly different
  // OAuth2Client types and googleapis rejects the standalone one.
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

async function syncGoogleAccount(
  accountId: string, account: ConnectedAccountDoc, accessToken: string,
  windowStart: Date, windowEnd: Date, writer: BatchWriter
): Promise<void> {
  const cal = googleCalendarClient(accessToken);
  const now = admin.firestore.FieldValue.serverTimestamp();

  let calendarPageToken: string | undefined;
  do {
    const calendarListResp = await cal.calendarList.list({ pageToken: calendarPageToken });
    for (const calListEntry of calendarListResp.data.items ?? []) {
      const calendarId = calListEntry.id;
      if (!calendarId) continue;

      let pageToken: string | undefined;
      do {
        const resp = await cal.events.list({
          calendarId,
          singleEvents: true, // required — otherwise recurring series return as un-expanded masters
          orderBy: "startTime",
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          maxResults: 250,
          pageToken,
        });
        for (const ev of resp.data.items ?? []) {
          if (!ev.id) continue;
          const startRaw = ev.start?.dateTime ?? ev.start?.date;
          const endRaw = ev.end?.dateTime ?? ev.end?.date;
          if (!startRaw || !endRaw) continue;
          const join = extractJoinInfoGoogle(ev);
          const docId = eventDocId(accountId, ev.id);
          const doc: EventDoc = {
            uid: account.uid,
            connectedAccountId: accountId,
            provider: "google",
            sourceCalendarId: calendarId,
            externalEventId: ev.id,
            title: ev.summary ?? "(ללא כותרת)",
            start: admin.firestore.Timestamp.fromDate(new Date(startRaw)),
            end: admin.firestore.Timestamp.fromDate(new Date(endRaw)),
            allDay: !!ev.start?.date,
            location: ev.location ?? null,
            description: ev.description ?? null,
            organizer: ev.organizer?.email ?? null,
            joinUrl: join.joinUrl,
            joinType: join.joinType,
            color: account.displayColor,
            status: ev.status === "cancelled" ? "cancelled" : "confirmed",
            lastSeenSyncAt: now,
            updatedAt: now,
          };
          await writer.set(db.doc(`events/${docId}`), doc as unknown as FirebaseFirestore.DocumentData);
        }
        pageToken = resp.data.nextPageToken ?? undefined;
      } while (pageToken);
    }
    calendarPageToken = calendarListResp.data.nextPageToken ?? undefined;
  } while (calendarPageToken);
}

async function fetchMicrosoftCalendars(accessToken: string): Promise<{ id: string; name: string }[]> {
  const { data } = await axios.get("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (data.value ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
}

async function fetchMicrosoftCalendarEvents(
  accessToken: string, calendarId: string, windowStart: Date, windowEnd: Date
): Promise<GraphEvent[]> {
  const events: GraphEvent[] = [];
  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?` +
    `startDateTime=${encodeURIComponent(windowStart.toISOString())}&endDateTime=${encodeURIComponent(windowEnd.toISOString())}&$top=50`;
  while (url) {
    const { data }: { data: { value: GraphEvent[]; "@odata.nextLink"?: string } } = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    events.push(...(data.value ?? []));
    url = data["@odata.nextLink"];
  }
  return events;
}

async function syncMicrosoftAccount(
  accountId: string, account: ConnectedAccountDoc, accessToken: string,
  windowStart: Date, windowEnd: Date, writer: BatchWriter
): Promise<void> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const calendars = await fetchMicrosoftCalendars(accessToken);

  for (const calendar of calendars) {
    const events = await fetchMicrosoftCalendarEvents(accessToken, calendar.id, windowStart, windowEnd);
    for (const ev of events) {
      if (!ev.id || !ev.start?.dateTime || !ev.end?.dateTime) continue;
      const join = extractJoinInfoMicrosoft(ev);
      const docId = eventDocId(accountId, ev.id);
      // Requested Prefer: outlook.timezone="UTC" above, so these dateTime
      // strings have no offset — append Z to parse them as UTC.
      const doc: EventDoc = {
        uid: account.uid,
        connectedAccountId: accountId,
        provider: "microsoft",
        sourceCalendarId: calendar.id,
        externalEventId: ev.id,
        title: ev.subject ?? "(ללא כותרת)",
        start: admin.firestore.Timestamp.fromDate(new Date(`${ev.start.dateTime}Z`)),
        end: admin.firestore.Timestamp.fromDate(new Date(`${ev.end.dateTime}Z`)),
        allDay: !!ev.isAllDay,
        location: ev.location?.displayName ?? null,
        description: ev.bodyPreview ?? ev.body?.content ?? null,
        organizer: ev.organizer?.emailAddress?.address ?? null,
        joinUrl: join.joinUrl,
        joinType: join.joinType,
        color: account.displayColor,
        status: ev.isCancelled ? "cancelled" : "confirmed",
        lastSeenSyncAt: now,
        updatedAt: now,
      };
      await writer.set(db.doc(`events/${docId}`), doc as unknown as FirebaseFirestore.DocumentData);
    }
  }
}

/** Deletes cached events for this account that the source no longer returned. */
async function cleanupStaleEvents(accountId: string, staleBefore: Date, writer: BatchWriter): Promise<void> {
  const snap = await db.collection("events").where("connectedAccountId", "==", accountId).get();
  for (const doc of snap.docs) {
    const lastSeen = (doc.data().lastSeenSyncAt as FirebaseFirestore.Timestamp | undefined)?.toDate();
    if (!lastSeen || lastSeen < staleBefore) {
      await writer.delete(doc.ref);
    }
  }
}

export const syncCalendarsScheduled = functions.scheduler.onSchedule(
  { schedule: "*/10 * * * *", secrets: [googleClientId, googleClientSecret, msClientId, msClientSecret] },
  async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_PAST_MS);
    const windowEnd = new Date(now.getTime() + WINDOW_FUTURE_MS);
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    const accountsSnap = await db.collection("connectedAccounts").where("status", "==", "active").get();
    for (const accountDoc of accountsSnap.docs) {
      const accountId = accountDoc.id;
      const account = accountDoc.data() as ConnectedAccountDoc;
      const writer = new BatchWriter();
      try {
        const accessToken = await getValidAccessToken(accountId);
        if (account.provider === "google") {
          await syncGoogleAccount(accountId, account, accessToken, windowStart, windowEnd, writer);
        } else {
          await syncMicrosoftAccount(accountId, account, accessToken, windowStart, windowEnd, writer);
        }
        await cleanupStaleEvents(accountId, staleBefore, writer);
        await writer.flush();
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          console.warn(`Skipping calendar sync for ${accountId} — reauth required`);
        } else {
          console.error(`Calendar sync error for account ${accountId}:`, err);
        }
      }
    }
  }
);
