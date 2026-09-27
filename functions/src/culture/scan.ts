import * as functions from "firebase-functions/v2";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase";
import { TIMEZONE, zoneParts } from "../notifications/timezone";
import { CULTURE_CATALOG } from "./catalog";
import { CatalogSource, CultureSettings, CultureSourceDoc } from "./types";
import { pickSourcesToScan, validateScanResult, ValidEvent } from "./scanResult";
import { geminiApiKey, createCultureClient, lookupReview, scanSource } from "./geminiScanner";

const MAX_SOURCES_PER_RUN = 20;
const MAX_REVIEW_LOOKUPS_PER_RUN = 25;
const CONCURRENCY = 3;
const HORIZON_DAYS = 14;
const WORK_BUDGET_MS = 25 * 60 * 1000;
const REVIEWED_TYPES = new Set(["cinema", "theater"]);

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/** Upsert the code catalog into Firestore; disable docs no longer in the catalog. */
async function syncCatalog(): Promise<Map<string, CultureSourceDoc & { id: string }>> {
  const batch = db.batch();
  const catalogIds = new Set(CULTURE_CATALOG.map((s) => s.id));
  for (const s of CULTURE_CATALOG) {
    batch.set(db.doc(`cultureSources/${s.id}`),
      { name: s.name, url: s.url, type: s.type, regions: s.regions, enabled: true }, { merge: true });
  }
  const existing = await db.collection("cultureSources").get();
  for (const doc of existing.docs) {
    if (!catalogIds.has(doc.id)) batch.set(doc.ref, { enabled: false }, { merge: true });
  }
  await batch.commit();
  const after = await db.collection("cultureSources").get();
  return new Map(after.docs.map((d) => [d.id, { id: d.id, ...(d.data() as CultureSourceDoc) }]));
}

async function selectedSourceIds(): Promise<Set<string>> {
  const snap = await db.collection("settings").get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const culture = doc.data().culture as Partial<CultureSettings> | undefined;
    if (culture?.enabled) for (const id of culture.sourceIds ?? []) ids.add(id);
  }
  return ids;
}

async function upsertEvents(source: CatalogSource, events: ValidEvent[]): Promise<void> {
  if (events.length === 0) return;
  const refs = events.map((e) => db.doc(`cultureEvents/${e.id}`));
  const existing = await db.getAll(...refs);
  const exists = new Set(existing.filter((s) => s.exists).map((s) => s.id));
  const now = Timestamp.now();
  // Firestore batches cap at 500 writes.
  for (let i = 0; i < events.length; i += 400) {
    const batch = db.batch();
    for (const e of events.slice(i, i + 400)) {
      const dates = e.dates.map((d) => Timestamp.fromDate(d));
      const common = {
        sourceId: source.id, title: e.title, category: source.type, venue: e.venue, city: e.city,
        region: e.region, dates, firstDate: dates[0], lastDate: dates[dates.length - 1],
        url: e.url, description: e.description, lastSeenAt: now,
      };
      const ref = db.doc(`cultureEvents/${e.id}`);
      if (exists.has(e.id)) {
        batch.set(ref, common, { merge: true });
      } else {
        batch.set(ref, {
          ...common, review: null, recommended: false,
          reviewPending: REVIEWED_TYPES.has(source.type), firstSeenAt: now,
        });
      }
    }
    await batch.commit();
  }
}

async function deletePastEvents(now: Date): Promise<number> {
  const snap = await db.collection("cultureEvents").where("lastDate", "<", Timestamp.fromDate(now)).limit(400).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

export const cultureDailyScan = functions.scheduler.onSchedule(
  {
    schedule: "0 3 * * *", timeZone: TIMEZONE, timeoutSeconds: 1800, memory: "512MiB",
    secrets: [geminiApiKey],
  },
  async () => {
    const startedAt = Date.now();
    const outOfTime = () => Date.now() - startedAt > WORK_BUDGET_MS;
    const now = new Date();
    const todayStr = zoneParts(now, TIMEZONE).dateStr;
    const endStr = zoneParts(new Date(now.getTime() + HORIZON_DAYS * 86400000), TIMEZONE).dateStr;

    const sources = await syncCatalog();
    const selected = await selectedSourceIds();
    const toScan = pickSourcesToScan(
      [...sources.values()].map((s) => ({ id: s.id, enabled: s.enabled, lastScanAtMs: s.lastScan?.at?.toMillis() ?? null })),
      selected, MAX_SOURCES_PER_RUN,
    );
    const client = createCultureClient();
    console.log(`cultureDailyScan: ${toScan.length} sources (${selected.size} selected)`);

    await mapLimit(toScan, CONCURRENCY, async (id) => {
      if (outOfTime()) return;
      const doc = sources.get(id)!;
      const source: CatalogSource = { id, name: doc.name, url: doc.url, type: doc.type, regions: doc.regions };
      const ref = db.doc(`cultureSources/${id}`);
      try {
        const raw = await scanSource(client, source, todayStr, endStr);
        const events = validateScanResult(raw, source, now, HORIZON_DAYS);
        await upsertEvents(source, events);
        await ref.set({ lastScan: { at: Timestamp.now(), ok: true, eventCount: events.length }, consecutiveFailures: 0 }, { merge: true });
        console.log(`cultureDailyScan: ${id} → ${events.length} events`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`cultureDailyScan: ${id} failed`, err);
        await ref.set({
          lastScan: { at: Timestamp.now(), ok: false, error: message.slice(0, 500), eventCount: 0 },
          consecutiveFailures: FieldValue.increment(1),
        }, { merge: true });
      }
    });

    const pending = await db.collection("cultureEvents").where("reviewPending", "==", true).limit(MAX_REVIEW_LOOKUPS_PER_RUN).get();
    await mapLimit(pending.docs, CONCURRENCY, async (doc) => {
      if (outOfTime()) return;
      const e = doc.data();
      try {
        const review = await lookupReview(client, { title: e.title, category: e.category, venue: e.venue });
        await doc.ref.set({ review, recommended: review?.score === "positive", reviewPending: false }, { merge: true });
      } catch (err) {
        // Leave reviewPending=true so it retries next night.
        console.error(`cultureDailyScan: review for ${doc.id} failed`, err);
      }
    });

    const deleted = await deletePastEvents(now);
    console.log(`cultureDailyScan: reviewed ${pending.size}, deleted ${deleted} past events, ${Math.round((Date.now() - startedAt) / 1000)}s`);
  },
);
