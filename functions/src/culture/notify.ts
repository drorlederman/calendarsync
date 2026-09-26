import * as functions from "firebase-functions/v2";
import { db } from "../firebase";
import { APP_URL } from "../config";
import { DEFAULT_SETTINGS, SettingsDoc } from "../types";
import { TIMEZONE } from "../notifications/timezone";
import { sendWhatsApp, WhatsAppQuotaExceededError, greenApiUrl, greenApiInstance, greenApiToken } from "../notifications/whatsapp";
import { cultureDueKey, nextSendAfter } from "./schedule";
import { selectForMessage, SelectableEvent } from "./select";
import { buildCultureMessage } from "./message";
import { CultureEventDoc } from "./types";

export async function loadCultureEvents(sourceIds: string[]): Promise<SelectableEvent[]> {
  const out: SelectableEvent[] = [];
  // Firestore `in` accepts at most 30 values.
  for (let i = 0; i < sourceIds.length; i += 30) {
    const snap = await db.collection("cultureEvents").where("sourceId", "in", sourceIds.slice(i, i + 30)).get();
    for (const doc of snap.docs) {
      const e = doc.data() as CultureEventDoc;
      out.push({
        id: doc.id, sourceId: e.sourceId, title: e.title, category: e.category, region: e.region,
        venue: e.venue, city: e.city, url: e.url, description: e.description,
        dates: e.dates.map((t) => t.toDate()), recommended: e.recommended, review: e.review,
      });
    }
  }
  return out;
}

export async function processCulture(
  uid: string, settings: SettingsDoc, now: Date, apiUrl: string, instanceId: string, token: string,
): Promise<boolean> {
  const culture = settings.culture;
  const key = cultureDueKey(culture, now, TIMEZONE);
  if (!key) return false;

  const logRef = db.doc(`cultureSentLog/${uid}`);
  const sent = ((await logRef.get()).data()?.sent as Record<string, boolean> | undefined) ?? {};
  if (sent[key]) return false;

  const to = nextSendAfter(culture, now, TIMEZONE);
  const picks = selectForMessage(await loadCultureEvents(culture.sourceIds), culture, now, to);
  if (picks.length > 0) {
    try {
      await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, buildCultureMessage(picks, now, to, TIMEZONE, APP_URL));
    } catch (err) {
      if (!(err instanceof WhatsAppQuotaExceededError)) throw err;
      console.warn(`WhatsApp quota exceeded (uid=${uid}) — culture "${key}" not delivered, will retry later`, err.detail);
      return true;
    }
  }
  // Mark even when empty: an empty period sends nothing and must not retry every tick.
  await logRef.set({ sent: { [key]: true } }, { merge: true });
  return false;
}

export const sendTestCultureCallable = functions.https.onCall(
  { secrets: [greenApiUrl, greenApiInstance, greenApiToken] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const raw = ((await db.doc(`settings/${uid}`).get()).data() ?? {}) as Partial<SettingsDoc>;
    const whatsapp = raw.whatsapp ?? DEFAULT_SETTINGS.whatsapp;
    const culture = { ...DEFAULT_SETTINGS.culture, ...(raw.culture ?? {}) };
    if (!whatsapp.phone) throw new functions.https.HttpsError("failed-precondition", "לא הוגדר מספר WhatsApp בהגדרות");
    if (culture.sourceIds.length === 0) throw new functions.https.HttpsError("failed-precondition", "לא נבחרו אתרים");

    const now = new Date();
    const to = nextSendAfter(culture, now, TIMEZONE);
    const picks = selectForMessage(await loadCultureEvents(culture.sourceIds), culture, now, to);
    const message = picks.length > 0
      ? buildCultureMessage(picks, now, to, TIMEZONE, APP_URL)
      : `🎭 הודעת בדיקה — עדיין לא נמצאו אירועים באתרים ובאזורים שבחרת לתקופה הקרובה.\nהסריקה רצה כל לילה ב-03:00.\n\n${APP_URL}/culture`;
    try {
      await sendWhatsApp(greenApiUrl.value(), greenApiInstance.value(), greenApiToken.value(), whatsapp.phone, message);
    } catch (err) {
      if (err instanceof WhatsAppQuotaExceededError) {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "מכסת ה-WhatsApp (Green API, תוכנית Developer) נגמרה החודש — שדרגו תוכנית או המתינו לאיפוס בתחילת החודש",
        );
      }
      throw err;
    }
    return { ok: true, count: picks.length };
  },
);
