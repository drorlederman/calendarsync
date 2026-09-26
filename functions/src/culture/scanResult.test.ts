import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, eventId, parseLocalDate, validateScanResult, pickSourcesToScan } from "./scanResult";

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-09-26T09:00:00+03:00");
const SOURCE = { id: "tzavta", url: "https://www.tzavta.co.il/", regions: ["tel-aviv" as const] };

function ev(over: Record<string, unknown> = {}) {
  return {
    title: "ערב שירי משוררים", venue: "צוותא 1", city: "תל אביב", region: "tel-aviv",
    dates: ["2026-09-28T20:30"], url: "https://www.tzavta.co.il/event/123", description: "ערב מוזיקלי",
    ...over,
  };
}

test("normalizeTitle ignores case, quotes, punctuation and extra spaces", () => {
  assert.equal(normalizeTitle('  "Hamlet" — Live!  '), normalizeTitle("hamlet live"));
  assert.equal(normalizeTitle("הגשר  הצר״"), normalizeTitle("הגשר הצר"));
});

test("eventId is stable and source-scoped", () => {
  assert.equal(eventId("a", "Hamlet"), eventId("a", " hamlet! "));
  assert.notEqual(eventId("a", "Hamlet"), eventId("b", "Hamlet"));
  assert.match(eventId("a", "Hamlet"), /^[0-9a-f]{24}$/);
});

test("parseLocalDate accepts date and date-time, rejects junk", () => {
  assert.equal(parseLocalDate("2026-09-28T20:30", TZ)?.toISOString(), "2026-09-28T17:30:00.000Z");
  assert.equal(parseLocalDate("2026-09-28", TZ)?.toISOString(), "2026-09-27T21:00:00.000Z");
  assert.equal(parseLocalDate("28/09/2026", TZ), null);
  assert.equal(parseLocalDate("2026-02-30", TZ), null);
});

test("validateScanResult keeps a valid event", () => {
  const out = validateScanResult({ events: [ev()] }, SOURCE, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, eventId("tzavta", "ערב שירי משוררים"));
  assert.equal(out[0].region, "tel-aviv");
  assert.equal(out[0].dates.length, 1);
});

test("validateScanResult drops events without title or usable dates", () => {
  const out = validateScanResult({ events: [
    ev({ title: "" }),
    ev({ dates: ["garbage"] }),
    ev({ dates: ["2026-09-01T20:00"] }),  // past
    ev({ dates: ["2026-12-01T20:00"] }),  // beyond 14-day horizon
  ] }, SOURCE, NOW);
  assert.equal(out.length, 0);
});

test("validateScanResult replaces foreign-domain urls with the source url", () => {
  const out = validateScanResult({ events: [ev({ url: "https://evil.example.com/x" })] }, SOURCE, NOW);
  assert.equal(out[0].url, SOURCE.url);
});

test("validateScanResult coerces region for single-region sources, drops bad region otherwise", () => {
  assert.equal(validateScanResult({ events: [ev({ region: "mars" })] }, SOURCE, NOW)[0].region, "tel-aviv");
  const multi = { ...SOURCE, regions: ["tel-aviv" as const, "sharon" as const] };
  assert.equal(validateScanResult({ events: [ev({ region: "mars" })] }, multi, NOW).length, 0);
});

test("validateScanResult merges duplicate titles and sorts dates", () => {
  const out = validateScanResult({ events: [
    ev({ dates: ["2026-09-30T20:30"] }),
    ev({ title: "ערב שירי משוררים!", dates: ["2026-09-28T20:30", "2026-09-30T20:30"] }),
  ] }, SOURCE, NOW);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].dates.map((d) => d.toISOString()), ["2026-09-28T17:30:00.000Z", "2026-09-30T17:30:00.000Z"]);
});

test("validateScanResult returns [] for non-object input", () => {
  assert.deepEqual(validateScanResult(null, SOURCE, NOW), []);
  assert.deepEqual(validateScanResult({ events: "x" }, SOURCE, NOW), []);
});

test("pickSourcesToScan filters to selected+enabled and scans the stalest first", () => {
  const ids = pickSourcesToScan([
    { id: "a", enabled: true, lastScanAtMs: 300 },
    { id: "b", enabled: true, lastScanAtMs: null },
    { id: "c", enabled: false, lastScanAtMs: 100 },
    { id: "d", enabled: true, lastScanAtMs: 200 },
    { id: "e", enabled: true, lastScanAtMs: 50 },
  ], new Set(["a", "b", "c", "d"]), 2);
  assert.deepEqual(ids, ["b", "d"]);
});
