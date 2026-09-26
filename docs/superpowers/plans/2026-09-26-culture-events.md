# Culture Events — Daily Scan + WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user pick culture websites (by region and site type) from a managed catalog; scan the selected sites nightly with Claude, show the events on a new `/culture` page, and send a WhatsApp message with recommended events at a user-chosen frequency — without touching the calendar.

**Architecture:** A managed catalog lives in code (`functions/src/culture/catalog.ts`) and is synced into `cultureSources` at the start of every nightly run. `cultureDailyScan` scans each *selected* source once (shared across users) via Claude + `web_fetch`, validates the JSON, and upserts into `cultureEvents`; a second pass looks up reviews (Claude + `web_search`) only for new cinema/theater events. The existing 5-minute `whatsappSchedulerTick` gains a `processCulture` step that reads stored events — no Claude call at send time. Pure logic (ids, validation, scheduling, selection, message format) lives in small dependency-free modules with `node:test` tests.

**Tech Stack:** Firebase Cloud Functions v2 (Node 20, TypeScript, commonjs), Firestore Admin SDK, `@anthropic-ai/sdk` (new dependency), Green API WhatsApp (existing `sendWhatsApp`), Next.js 16 static export + React 19 + Tailwind 4 + lucide-react on the client. Tests: `node:test` + `node:assert/strict` on `tsc` output for functions (`npm run build && node --test lib/...`), `tsx --test` for `src/lib`.

## Global Constraints

- **No calendar writes, no calendar code changes.** OAuth scopes stay read-only. Nothing in `functions/src/calendar/`, `functions/src/oauth/`, or `src/components/calendar/` is modified.
- Timezone for all day/time math: **`Asia/Jerusalem`** (`TIMEZONE` from `functions/src/notifications/timezone.ts`).
- Week starts Sunday: `dayOfWeek` 0 = Sunday … 6 = Saturday (same as `zoneParts`).
- Catalog is **managed only** — users cannot add URLs.
- Regions (exact ids): `tel-aviv`, `sharon`, `center`, `jerusalem`, `haifa-north`, `south`.
- Source types (exact ids): `cinema`, `theater`, `music`, `venue`, `tickets`.
- Frequencies: `daily` | `twiceWeekly` | `weekly`. Defaults: `enabled:false`, `frequency:"weekly"`, `days:[0]`, `time:"09:00"`.
- WhatsApp message: **max 8 events**; recommended first, then `taste` keyword matches, then soonest. Empty period → **no message sent** (but the slot is marked sent).
- Scan horizon: **14 days**. Reviews only for `cinema` / `theater`, **once per event**.
- Claude model: constant `CULTURE_MODEL = "claude-opus-5"` in one place (`claudeScanner.ts`) with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Swapping to `claude-sonnet-5` is a one-line change.
- Nightly caps: `MAX_SOURCES_PER_RUN = 20`, `MAX_REVIEW_LOOKUPS_PER_RUN = 25`, concurrency 3, stop starting new work after 25 minutes (function timeout 1800 s).
- New secret: `ANTHROPIC_API_KEY` via `defineSecret`.
- All UI copy in Hebrew; follow the inline-style color tokens used by `DigestSection.tsx` (`#0D1321`, `#5B6477`, `#E8EDF5`, `#2563EB`, `#EFF4FF`, `#22C55E`, `#EF4444`, `#F8FAFC`).
- Functions region for callables: `us-central1` (client uses `getFunctions(app, "us-central1")`).

---

## File Structure

**Functions (new, `functions/src/culture/`):**
| File | Responsibility |
|---|---|
| `types.ts` | Culture enums, settings, source/event document types, `DEFAULT_CULTURE_SETTINGS` |
| `catalog.ts` | The managed source list (`CULTURE_CATALOG`) |
| `time.ts` | `zonedTimeToUtc`, `fmtEventDate` |
| `scanResult.ts` | `normalizeTitle`, `eventId`, `parseLocalDate`, `validateScanResult`, `pickSourcesToScan` |
| `schedule.ts` | `cultureDueKey`, `nextSendAfter` |
| `select.ts` | `tasteKeywords`, `selectForMessage` |
| `message.ts` | `buildCultureMessage` |
| `claudeScanner.ts` | The only module that talks to Claude: `scanSource`, `lookupReview`, secret, model constant |
| `scan.ts` | `cultureDailyScan` scheduled function (catalog sync, scan, upsert, reviews, cleanup) |
| `notify.ts` | `loadCultureEvents`, `processCulture` (called by tick), `sendTestCultureCallable` |
| `*.test.ts` | Tests for catalog, time, scanResult, schedule, select, message |

**Functions (modified):** `functions/src/types.ts` (SettingsDoc.culture), `functions/src/notifications/scheduler.ts` (tick defaults + call `processCulture`), `functions/src/index.ts` (exports), `functions/package.json` (SDK dep).

**Client (new):** `src/lib/culture.ts` (+ `culture.test.ts`), `src/components/settings/CultureSection.tsx`, `src/components/culture/CultureEventCard.tsx`, `app/(app)/culture/page.tsx`.

**Client (modified):** `src/lib/types.ts`, `app/(app)/settings/page.tsx`, `app/(app)/layout.tsx`, `package.json` (test script), `firestore.rules`.

---

### Task 1: Culture types, catalog, and settings shape

**Files:**
- Create: `functions/src/culture/types.ts`
- Create: `functions/src/culture/catalog.ts`
- Test: `functions/src/culture/catalog.test.ts`
- Modify: `functions/src/types.ts` (SettingsDoc + DEFAULT_SETTINGS)
- Modify: `functions/src/notifications/scheduler.ts` (tick's settings object)
- Modify: `src/lib/types.ts` (client SettingsDoc + DEFAULT_SETTINGS)
- Create: `src/lib/culture.ts` (client mirror — types + labels only in this task)

**Interfaces:**
- Produces (functions): `CULTURE_REGIONS`, `CultureRegion`, `CULTURE_TYPES`, `CultureType`, `CultureFrequency`, `CultureSettings`, `CatalogSource`, `CultureSourceDoc`, `CultureReview`, `CultureEventDoc`, `DEFAULT_CULTURE_SETTINGS` from `culture/types.ts`; `CULTURE_CATALOG: CatalogSource[]` from `culture/catalog.ts`; `SettingsDoc.culture: CultureSettings`.
- Produces (client): same enum/type names + `REGION_LABELS`, `TYPE_LABELS`, `WEEKDAY_LABELS`, `ClientCultureSource`, `ClientCultureEvent` from `src/lib/culture.ts`.

- [ ] **Step 1: Write `functions/src/culture/types.ts`**

```ts
export const CULTURE_REGIONS = ["tel-aviv", "sharon", "center", "jerusalem", "haifa-north", "south"] as const;
export type CultureRegion = (typeof CULTURE_REGIONS)[number];

export const CULTURE_TYPES = ["cinema", "theater", "music", "venue", "tickets"] as const;
export type CultureType = (typeof CULTURE_TYPES)[number];

export type CultureFrequency = "daily" | "twiceWeekly" | "weekly";

export interface CultureSettings {
  enabled: boolean;
  regions: CultureRegion[];
  types: CultureType[];
  sourceIds: string[];
  taste: string;
  frequency: CultureFrequency;
  days: number[]; // 0 = Sunday. daily: ignored; weekly: 1 day; twiceWeekly: 2 days
  time: string;   // "HH:MM", Asia/Jerusalem
}

export const DEFAULT_CULTURE_SETTINGS: CultureSettings = {
  enabled: false,
  regions: [],
  types: [],
  sourceIds: [],
  taste: "",
  frequency: "weekly",
  days: [0],
  time: "09:00",
};

/** One entry of the managed catalog, as written in code. */
export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  type: CultureType;
  regions: CultureRegion[];
}

export interface CultureSourceDoc {
  name: string;
  url: string;
  type: CultureType;
  regions: CultureRegion[];
  enabled: boolean;
  lastScan?: { at: FirebaseFirestore.Timestamp; ok: boolean; error?: string; eventCount: number };
  consecutiveFailures?: number;
}

export interface CultureReview {
  score: "positive" | "mixed" | "negative";
  summary: string;
  outlet: string;
}

export interface CultureEventDoc {
  sourceId: string;
  title: string;
  category: CultureType;
  venue: string;
  city: string;
  region: CultureRegion;
  dates: FirebaseFirestore.Timestamp[];
  firstDate: FirebaseFirestore.Timestamp;
  lastDate: FirebaseFirestore.Timestamp;
  url: string;
  description: string | null;
  review: CultureReview | null;
  reviewPending: boolean; // true on create for cinema/theater until lookupReview ran
  recommended: boolean;
  firstSeenAt: FirebaseFirestore.Timestamp;
  lastSeenAt: FirebaseFirestore.Timestamp;
}
```

- [ ] **Step 2: Write the failing catalog test `functions/src/culture/catalog.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CULTURE_CATALOG } from "./catalog";
import { CULTURE_REGIONS, CULTURE_TYPES } from "./types";

test("catalog ids are unique kebab-case", () => {
  const ids = CULTURE_CATALOG.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("catalog urls are https and parse", () => {
  for (const s of CULTURE_CATALOG) {
    const u = new URL(s.url);
    assert.equal(u.protocol, "https:", s.id);
  }
});

test("catalog regions and types are valid and non-empty", () => {
  for (const s of CULTURE_CATALOG) {
    assert.ok(s.regions.length > 0, s.id);
    for (const r of s.regions) assert.ok((CULTURE_REGIONS as readonly string[]).includes(r), `${s.id}:${r}`);
    assert.ok((CULTURE_TYPES as readonly string[]).includes(s.type), s.id);
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd functions && npm run build`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 4: Write `functions/src/culture/catalog.ts`**

```ts
import { CatalogSource } from "./types";

// Managed catalog. Synced into Firestore `cultureSources` at the start of every
// nightly scan (see scan.ts). To add/remove a site: edit this list and deploy.
// Removing an entry disables it (enabled:false) rather than deleting history.
export const CULTURE_CATALOG: CatalogSource[] = [
  { id: "zappa",            name: "זאפה",                    url: "https://www.zappa-club.co.il/",   type: "music",   regions: ["tel-aviv", "sharon", "jerusalem", "haifa-north"] },
  { id: "tzavta",           name: "צוותא",                   url: "https://www.tzavta.co.il/",       type: "venue",   regions: ["tel-aviv"] },
  { id: "barby",            name: "בארבי",                   url: "https://www.barby.co.il/",        type: "music",   regions: ["tel-aviv"] },
  { id: "hoh-herzliya",     name: "היכל אמנויות הבמה הרצליה", url: "https://www.hoh-herzliya.co.il/", type: "venue",   regions: ["sharon"] },
  { id: "habima",           name: "הבימה",                   url: "https://www.habima.co.il/",       type: "theater", regions: ["tel-aviv"] },
  { id: "cameri",           name: "הקאמרי",                  url: "https://www.cameri.co.il/",       type: "theater", regions: ["tel-aviv"] },
  { id: "gesher",           name: "תיאטרון גשר",             url: "https://www.gesher-theatre.co.il/", type: "theater", regions: ["tel-aviv"] },
  { id: "beit-lessin",      name: "בית ליסין",               url: "https://www.lessin.co.il/",       type: "theater", regions: ["tel-aviv"] },
  { id: "khan",             name: "תיאטרון החאן",            url: "https://www.khan.co.il/",         type: "theater", regions: ["jerusalem"] },
  { id: "haifa-theatre",    name: "תיאטרון חיפה",            url: "https://www.ht1.co.il/",          type: "theater", regions: ["haifa-north"] },
  { id: "beer-sheva-theatre", name: "תיאטרון באר שבע",       url: "https://www.b7t.co.il/",          type: "theater", regions: ["south"] },
  { id: "cinema-city",      name: "סינמה סיטי",              url: "https://www.cinema-city.co.il/",  type: "cinema",  regions: ["sharon", "center", "jerusalem", "haifa-north"] },
  { id: "yes-planet",       name: "יס פלאנט",                url: "https://www.yesplanet.co.il/",    type: "cinema",  regions: ["center", "jerusalem", "haifa-north", "south"] },
  { id: "lev-cinema",       name: "קולנוע לב",               url: "https://www.lev.co.il/",          type: "cinema",  regions: ["tel-aviv", "center"] },
  { id: "tlv-cinematheque", name: "סינמטק תל אביב",          url: "https://www.cinema.co.il/",       type: "cinema",  regions: ["tel-aviv"] },
  { id: "jlm-cinematheque", name: "סינמטק ירושלים",          url: "https://www.jer-cin.org.il/",     type: "cinema",  regions: ["jerusalem"] },
];
```

- [ ] **Step 5: Verify each catalog URL resolves**

Run (bash): `for u in $(grep -o 'https://[^"]*' functions/src/culture/catalog.ts); do echo "$u $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -L --max-time 15 "$u")"; done`
Expected: each line `200`. For any non-200 or a redirect to a different domain, open the site in a browser, find the correct homepage/events URL, and update the entry (keep `https://`). If a site cannot be found at all, delete its entry.

- [ ] **Step 6: Extend functions `SettingsDoc`** — in `functions/src/types.ts` add at the top:

```ts
import { CultureSettings, DEFAULT_CULTURE_SETTINGS } from "./culture/types";
```

and replace the `SettingsDoc` / `DEFAULT_SETTINGS` blocks with:

```ts
export interface SettingsDoc {
  whatsapp: { enabled: boolean; phone: string };
  reminders: { offsetsMinutes: number[] };
  digest: { enabled: boolean; frequency: "daily" | "weekdays"; times: string[] };
  culture: CultureSettings;
}

export const DEFAULT_SETTINGS: SettingsDoc = {
  whatsapp: { enabled: false, phone: "" },
  reminders: { offsetsMinutes: [15, 1440] },
  digest: { enabled: false, frequency: "daily", times: ["07:30"] },
  culture: DEFAULT_CULTURE_SETTINGS,
};
```

- [ ] **Step 7: Keep the tick compiling** — in `functions/src/notifications/scheduler.ts`, in `whatsappSchedulerTick`, change the settings object to:

```ts
      const settings: SettingsDoc = {
        whatsapp: raw.whatsapp ?? DEFAULT_SETTINGS.whatsapp,
        reminders: raw.reminders ?? DEFAULT_SETTINGS.reminders,
        digest: raw.digest ?? DEFAULT_SETTINGS.digest,
        culture: { ...DEFAULT_SETTINGS.culture, ...(raw.culture ?? {}) },
      };
```

- [ ] **Step 8: Write the client mirror `src/lib/culture.ts`**

```ts
import type { Timestamp } from "firebase/firestore";

export const CULTURE_REGIONS = ["tel-aviv", "sharon", "center", "jerusalem", "haifa-north", "south"] as const;
export type CultureRegion = (typeof CULTURE_REGIONS)[number];

export const CULTURE_TYPES = ["cinema", "theater", "music", "venue", "tickets"] as const;
export type CultureType = (typeof CULTURE_TYPES)[number];

export type CultureFrequency = "daily" | "twiceWeekly" | "weekly";

export interface CultureSettings {
  enabled: boolean;
  regions: CultureRegion[];
  types: CultureType[];
  sourceIds: string[];
  taste: string;
  frequency: CultureFrequency;
  days: number[];
  time: string;
}

export const DEFAULT_CULTURE_SETTINGS: CultureSettings = {
  enabled: false, regions: [], types: [], sourceIds: [], taste: "",
  frequency: "weekly", days: [0], time: "09:00",
};

export const REGION_LABELS: Record<CultureRegion, string> = {
  "tel-aviv": "תל אביב",
  sharon: "השרון",
  center: "המרכז",
  jerusalem: "ירושלים",
  "haifa-north": "חיפה והצפון",
  south: "הדרום",
};

export const TYPE_LABELS: Record<CultureType, string> = {
  cinema: "קולנוע",
  theater: "תיאטרון",
  music: "מוזיקה והופעות",
  venue: "מרכזי תרבות",
  tickets: "פורטלי כרטיסים",
};

export const TYPE_EMOJI: Record<CultureType, string> = {
  cinema: "🎬", theater: "🎭", music: "🎵", venue: "🎤", tickets: "🎟️",
};

export const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export interface ClientCultureSource {
  id: string;
  name: string;
  url: string;
  type: CultureType;
  regions: CultureRegion[];
  enabled: boolean;
  lastScan?: { at: Timestamp; ok: boolean; error?: string; eventCount: number };
  consecutiveFailures?: number;
}

export interface ClientCultureEvent {
  id: string;
  sourceId: string;
  title: string;
  category: CultureType;
  venue: string;
  city: string;
  region: CultureRegion;
  dates: Timestamp[];
  url: string;
  description: string | null;
  review: { score: "positive" | "mixed" | "negative"; summary: string; outlet: string } | null;
  recommended: boolean;
}
```

- [ ] **Step 9: Extend client `SettingsDoc`** — in `src/lib/types.ts` add `import { type CultureSettings, DEFAULT_CULTURE_SETTINGS } from "./culture";` below the existing import, add `culture: CultureSettings;` to `SettingsDoc`, and `culture: DEFAULT_CULTURE_SETTINGS,` to `DEFAULT_SETTINGS`.

- [ ] **Step 10: Build and run tests**

Run: `cd functions && npm run build && node --test lib/culture/catalog.test.js`
Expected: build succeeds; 3 tests pass.
Run (repo root): `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add functions/src/culture/types.ts functions/src/culture/catalog.ts functions/src/culture/catalog.test.ts functions/src/types.ts functions/src/notifications/scheduler.ts src/lib/culture.ts src/lib/types.ts
git commit -m "feat(culture): add culture types, managed catalog, and settings shape"
```

---

### Task 2: Timezone helpers and scan-result validation

**Files:**
- Create: `functions/src/culture/time.ts`
- Create: `functions/src/culture/scanResult.ts`
- Test: `functions/src/culture/time.test.ts`, `functions/src/culture/scanResult.test.ts`

**Interfaces:**
- Consumes: `zoneParts`, `fmtDateTime`, `TIMEZONE` from `../notifications/timezone`; `CultureRegion` from `./types`.
- Produces:
  - `zonedTimeToUtc(dateStr: string, time: string, timeZone: string): Date` (Invalid Date if the date is not real)
  - `fmtEventDate(date: Date, timeZone: string): string`
  - `normalizeTitle(title: string): string`
  - `eventId(sourceId: string, title: string): string` (24 hex chars)
  - `parseLocalDate(s: string, timeZone: string): Date | null`
  - `interface ValidEvent { id: string; title: string; venue: string; city: string; region: CultureRegion; dates: Date[]; url: string; description: string | null }`
  - `validateScanResult(raw: unknown, source: { id: string; url: string; regions: CultureRegion[] }, now: Date, horizonDays?: number): ValidEvent[]`
  - `pickSourcesToScan(sources: Array<{ id: string; enabled: boolean; lastScanAtMs: number | null }>, selectedIds: Set<string>, max: number): string[]`

- [ ] **Step 1: Write the failing test `functions/src/culture/time.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedTimeToUtc, fmtEventDate } from "./time";

const TZ = "Asia/Jerusalem";

test("zonedTimeToUtc converts summer local time (UTC+3)", () => {
  assert.equal(zonedTimeToUtc("2026-07-01", "20:30", TZ).toISOString(), "2026-07-01T17:30:00.000Z");
});

test("zonedTimeToUtc converts winter local time (UTC+2)", () => {
  assert.equal(zonedTimeToUtc("2026-12-01", "09:00", TZ).toISOString(), "2026-12-01T07:00:00.000Z");
});

test("zonedTimeToUtc returns Invalid Date for impossible dates", () => {
  assert.ok(isNaN(zonedTimeToUtc("2026-02-30", "10:00", TZ).getTime()));
});

test("fmtEventDate omits the time at local midnight", () => {
  const dateOnly = fmtEventDate(zonedTimeToUtc("2026-10-01", "00:00", TZ), TZ);
  const timed = fmtEventDate(zonedTimeToUtc("2026-10-01", "20:30", TZ), TZ);
  assert.ok(!dateOnly.includes(":"), dateOnly);
  assert.ok(timed.includes("20:30"), timed);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && npm run build`
Expected: FAIL — `Cannot find module './time'`.

- [ ] **Step 3: Write `functions/src/culture/time.ts`**

```ts
import { zoneParts, fmtDateTime } from "../notifications/timezone";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Local wall-clock time in `timeZone` → UTC instant. Same guess-and-correct
 * approach as localDayBoundsUtc: read the zone's offset at the naive UTC guess
 * and subtract it. Returns an Invalid Date for impossible dates (e.g. Feb 30).
 */
export function zonedTimeToUtc(dateStr: string, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  const guess = new Date(`${dateStr}T${pad(hh || 0)}:${pad(mm || 0)}:00Z`);
  if (isNaN(guess.getTime()) || guess.toISOString().slice(0, 10) !== dateStr) return new Date(NaN);
  const p = zoneParts(guess, timeZone);
  const asUtc = Date.UTC(
    parseInt(p.dateStr.slice(0, 4), 10), parseInt(p.dateStr.slice(5, 7), 10) - 1,
    parseInt(p.dateStr.slice(8, 10), 10), p.hour, p.minute,
  );
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

/** Cinema dates are stored at local midnight (day only) — format those without a time. */
export function fmtEventDate(date: Date, timeZone: string): string {
  const p = zoneParts(date, timeZone);
  if (p.hour === 0 && p.minute === 0) {
    return new Intl.DateTimeFormat("he-IL", { timeZone, weekday: "short", day: "numeric", month: "long" }).format(date);
  }
  return fmtDateTime(date, timeZone);
}
```

Note: `new Date("2026-02-30T...Z")` rolls over to March 2 rather than failing, which is why the `toISOString().slice(0,10) !== dateStr` check exists.

- [ ] **Step 4: Run time tests**

Run: `cd functions && npm run build && node --test lib/culture/time.test.js`
Expected: 4 pass.

- [ ] **Step 5: Write the failing test `functions/src/culture/scanResult.test.ts`**

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd functions && npm run build`
Expected: FAIL — `Cannot find module './scanResult'`.

- [ ] **Step 7: Write `functions/src/culture/scanResult.ts`**

```ts
import { createHash } from "crypto";
import { CultureRegion } from "./types";
import { zonedTimeToUtc } from "./time";

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function eventId(sourceId: string, title: string): string {
  return createHash("sha1").update(`${sourceId}|${normalizeTitle(title)}`).digest("hex").slice(0, 24);
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;

/** "YYYY-MM-DD" (stored at local midnight) or "YYYY-MM-DDTHH:mm" local → UTC Date. */
export function parseLocalDate(s: string, timeZone: string): Date | null {
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  const d = zonedTimeToUtc(m[1], m[2] ?? "00:00", timeZone);
  return isNaN(d.getTime()) ? null : d;
}

export interface ValidEvent {
  id: string;
  title: string;
  venue: string;
  city: string;
  region: CultureRegion;
  dates: Date[];
  url: string;
  description: string | null;
}

const MAX_DATES = 30;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

export function validateScanResult(
  raw: unknown,
  source: { id: string; url: string; regions: CultureRegion[] },
  now: Date,
  horizonDays = 14,
): ValidEvent[] {
  const list = (raw as { events?: unknown } | null)?.events;
  if (!Array.isArray(list)) return [];

  const sourceHost = bareHost(new URL(source.url).hostname);
  // Keep shows that started up to 12h ago (tonight's show scanned at 03:00 is still "today").
  const minMs = now.getTime() - 12 * 60 * 60 * 1000;
  const maxMs = now.getTime() + horizonDays * 24 * 60 * 60 * 1000;
  const byId = new Map<string, ValidEvent>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title, 200);
    if (!title) continue;

    let region = o.region as CultureRegion;
    if (!source.regions.includes(region)) {
      if (source.regions.length !== 1) continue;
      region = source.regions[0];
    }

    let url = source.url;
    try {
      const u = new URL(str(o.url, 1000));
      const h = bareHost(u.hostname);
      if (u.protocol === "https:" && (h === sourceHost || h.endsWith(`.${sourceHost}`))) url = u.toString();
    } catch { /* keep source.url */ }

    const rawDates = Array.isArray(o.dates) ? o.dates : [];
    const dates = rawDates
      .map((d) => (typeof d === "string" ? parseLocalDate(d, "Asia/Jerusalem") : null))
      .filter((d): d is Date => d !== null && d.getTime() >= minMs && d.getTime() <= maxMs);
    if (dates.length === 0) continue;

    const id = eventId(source.id, title);
    const existing = byId.get(id);
    const allMs = new Set([...(existing?.dates ?? []), ...dates].map((d) => d.getTime()));
    const merged = [...allMs].sort((a, b) => a - b).slice(0, MAX_DATES).map((ms) => new Date(ms));

    byId.set(id, {
      id,
      title: existing?.title ?? title,
      venue: existing?.venue || str(o.venue, 200),
      city: existing?.city || str(o.city, 100),
      region,
      dates: merged,
      url: existing?.url ?? url,
      description: existing?.description ?? (str(o.description, 500) || null),
    });
  }
  return [...byId.values()];
}

export function pickSourcesToScan(
  sources: Array<{ id: string; enabled: boolean; lastScanAtMs: number | null }>,
  selectedIds: Set<string>,
  max: number,
): string[] {
  return sources
    .filter((s) => s.enabled && selectedIds.has(s.id))
    .sort((a, b) => (a.lastScanAtMs ?? -1) - (b.lastScanAtMs ?? -1))
    .slice(0, max)
    .map((s) => s.id);
}
```

- [ ] **Step 8: Run tests**

Run: `cd functions && npm run build && node --test lib/culture/time.test.js lib/culture/scanResult.test.js`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add functions/src/culture/time.ts functions/src/culture/time.test.ts functions/src/culture/scanResult.ts functions/src/culture/scanResult.test.ts
git commit -m "feat(culture): add timezone helpers and scan-result validation"
```

---

### Task 3: Send schedule logic

**Files:**
- Create: `functions/src/culture/schedule.ts`
- Test: `functions/src/culture/schedule.test.ts`

**Interfaces:**
- Consumes: `zoneParts` from `../notifications/timezone`; `zonedTimeToUtc` from `./time`; `CultureSettings` from `./types`.
- Produces:
  - `cultureDueKey(culture: CultureSettings, now: Date, timeZone: string): string | null` — `"YYYY-MM-DD_HH:MM"` when a send is due in this 5-minute tick, else `null`.
  - `nextSendAfter(culture: CultureSettings, now: Date, timeZone: string): Date` — the next scheduled send after today (end of the message's period).

- [ ] **Step 1: Write the failing test `functions/src/culture/schedule.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cultureDueKey, nextSendAfter } from "./schedule";
import { DEFAULT_CULTURE_SETTINGS, CultureSettings } from "./types";

const TZ = "Asia/Jerusalem";
const base: CultureSettings = { ...DEFAULT_CULTURE_SETTINGS, enabled: true, sourceIds: ["tzavta"] };
// 2026-09-27 is a Sunday.
const SUN_0902 = new Date("2026-09-27T09:02:00+03:00");

test("weekly: due inside the 5-minute window on the chosen day", () => {
  assert.equal(cultureDueKey({ ...base, days: [0], time: "09:00" }, SUN_0902, TZ), "2026-09-27_09:00");
});

test("weekly: not due on another day or outside the window", () => {
  assert.equal(cultureDueKey({ ...base, days: [1], time: "09:00" }, SUN_0902, TZ), null);
  assert.equal(cultureDueKey({ ...base, days: [0], time: "08:55" }, SUN_0902, TZ), null);
  assert.equal(cultureDueKey({ ...base, days: [0], time: "09:05" }, SUN_0902, TZ), null);
});

test("daily ignores days", () => {
  assert.equal(cultureDueKey({ ...base, frequency: "daily", days: [], time: "09:00" }, SUN_0902, TZ), "2026-09-27_09:00");
});

test("not due when disabled or no sources", () => {
  assert.equal(cultureDueKey({ ...base, enabled: false }, SUN_0902, TZ), null);
  assert.equal(cultureDueKey({ ...base, sourceIds: [] }, SUN_0902, TZ), null);
});

test("nextSendAfter weekly is 7 days later at the same local time", () => {
  assert.equal(nextSendAfter({ ...base, days: [0], time: "09:00" }, SUN_0902, TZ).toISOString(), "2026-10-04T06:00:00.000Z");
});

test("nextSendAfter twiceWeekly picks the next chosen day", () => {
  assert.equal(
    nextSendAfter({ ...base, frequency: "twiceWeekly", days: [0, 3], time: "09:00" }, SUN_0902, TZ).toISOString(),
    "2026-09-30T06:00:00.000Z",
  );
});

test("nextSendAfter daily is tomorrow", () => {
  assert.equal(
    nextSendAfter({ ...base, frequency: "daily", days: [], time: "09:00" }, SUN_0902, TZ).toISOString(),
    "2026-09-28T06:00:00.000Z",
  );
});

test("nextSendAfter handles the DST change (Israel leaves DST 2026-10-25)", () => {
  const sun = new Date("2026-10-18T09:01:00+03:00");
  assert.equal(nextSendAfter({ ...base, days: [0], time: "09:00" }, sun, TZ).toISOString(), "2026-10-25T07:00:00.000Z");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && npm run build`
Expected: FAIL — `Cannot find module './schedule'`.

- [ ] **Step 3: Write `functions/src/culture/schedule.ts`**

```ts
import { zoneParts } from "../notifications/timezone";
import { zonedTimeToUtc } from "./time";
import { CultureSettings } from "./types";

const TICK_MINUTES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function includesDay(culture: CultureSettings, dayOfWeek: number): boolean {
  return culture.frequency === "daily" || culture.days.includes(dayOfWeek);
}

function toMinutes(time: string): number {
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  return (hh || 0) * 60 + (mm || 0);
}

export function cultureDueKey(culture: CultureSettings, now: Date, timeZone: string): string | null {
  if (!culture.enabled || culture.sourceIds.length === 0) return null;
  const p = zoneParts(now, timeZone);
  if (!includesDay(culture, p.dayOfWeek)) return null;
  const nowMin = p.hour * 60 + p.minute;
  const target = toMinutes(culture.time);
  if (nowMin < target || nowMin >= target + TICK_MINUTES) return null;
  return `${p.dateStr}_${culture.time}`;
}

export function nextSendAfter(culture: CultureSettings, now: Date, timeZone: string): Date {
  // Step by ~24h and read the local date; noon anchor keeps DST shifts from
  // skipping or repeating a calendar day.
  const todayNoon = zonedTimeToUtc(zoneParts(now, timeZone).dateStr, "12:00", timeZone);
  for (let d = 1; d <= 7; d++) {
    const p = zoneParts(new Date(todayNoon.getTime() + d * DAY_MS), timeZone);
    if (includesDay(culture, p.dayOfWeek)) return zonedTimeToUtc(p.dateStr, culture.time, timeZone);
  }
  return new Date(now.getTime() + 7 * DAY_MS);
}
```

- [ ] **Step 4: Run tests**

Run: `cd functions && npm run build && node --test lib/culture/schedule.test.js`
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/culture/schedule.ts functions/src/culture/schedule.test.ts
git commit -m "feat(culture): add WhatsApp send schedule logic"
```

---

### Task 4: Event selection and WhatsApp message

**Files:**
- Create: `functions/src/culture/select.ts`
- Create: `functions/src/culture/message.ts`
- Test: `functions/src/culture/select.test.ts`, `functions/src/culture/message.test.ts`

**Interfaces:**
- Consumes: `CultureSettings`, `CultureType`, `CultureRegion`, `CultureReview` from `./types`; `fmtEventDate` from `./time`.
- Produces:
  - `interface SelectableEvent { id: string; sourceId: string; title: string; category: CultureType; region: CultureRegion; venue: string; city: string; url: string; description: string | null; dates: Date[]; recommended: boolean; review: CultureReview | null }`
  - `type SelectedEvent = SelectableEvent & { nextDate: Date }`
  - `tasteKeywords(taste: string): string[]`
  - `selectForMessage(events: SelectableEvent[], culture: CultureSettings, from: Date, to: Date, limit?: number): SelectedEvent[]`
  - `buildCultureMessage(items: SelectedEvent[], from: Date, to: Date, timeZone: string, appUrl: string): string`

- [ ] **Step 1: Write the failing test `functions/src/culture/select.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectForMessage, tasteKeywords, SelectableEvent } from "./select";
import { DEFAULT_CULTURE_SETTINGS, CultureSettings } from "./types";

const FROM = new Date("2026-09-27T09:00:00+03:00");
const TO = new Date("2026-10-04T09:00:00+03:00");
const culture: CultureSettings = {
  ...DEFAULT_CULTURE_SETTINGS, enabled: true, sourceIds: ["a", "b"], regions: ["tel-aviv"], types: [],
};

function e(id: string, over: Partial<SelectableEvent> = {}): SelectableEvent {
  return {
    id, sourceId: "a", title: `Event ${id}`, category: "theater", region: "tel-aviv", venue: "V", city: "TLV",
    url: "https://x.co.il", description: null, dates: [new Date("2026-09-29T20:00:00+03:00")],
    recommended: false, review: null, ...over,
  };
}

test("tasteKeywords splits and drops short words", () => {
  assert.deepEqual(tasteKeywords("דרמות אירופיות, לא מחזמר; jazz"), ["דרמות", "אירופיות", "מחזמר", "jazz"]);
});

test("filters by source, region, type and period", () => {
  const out = selectForMessage([
    e("ok"),
    e("other-source", { sourceId: "z" }),
    e("other-region", { region: "south" }),
    e("past", { dates: [new Date("2026-09-20T20:00:00+03:00")] }),
    e("later", { dates: [new Date("2026-10-10T20:00:00+03:00")] }),
  ], culture, FROM, TO);
  assert.deepEqual(out.map((x) => x.id), ["ok"]);
  const typed = selectForMessage([e("t"), e("c", { category: "cinema" })], { ...culture, types: ["cinema"] }, FROM, TO);
  assert.deepEqual(typed.map((x) => x.id), ["c"]);
});

test("empty regions/types means all", () => {
  const out = selectForMessage([e("x", { region: "south" })], { ...culture, regions: [] }, FROM, TO);
  assert.equal(out.length, 1);
});

test("recommended first, then taste match, then soonest; capped", () => {
  const soon = new Date("2026-09-28T20:00:00+03:00");
  const late = new Date("2026-10-02T20:00:00+03:00");
  const out = selectForMessage([
    e("plain-soon", { dates: [soon] }),
    e("taste", { title: "ג'אז בצוותא", dates: [late] }),
    e("rec", { recommended: true, dates: [late] }),
  ], { ...culture, taste: "ג'אז" }, FROM, TO, 2);
  assert.deepEqual(out.map((x) => x.id), ["rec", "taste"]);
});

test("nextDate is the first date inside the period", () => {
  const out = selectForMessage([e("m", { dates: [new Date("2026-09-20T20:00:00+03:00"), new Date("2026-09-30T20:00:00+03:00")] })], culture, FROM, TO);
  assert.equal(out[0].nextDate.toISOString(), "2026-09-30T17:00:00.000Z");
});
```

- [ ] **Step 2: Write the failing test `functions/src/culture/message.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCultureMessage } from "./message";
import { SelectedEvent } from "./select";

const d = new Date("2026-09-29T20:00:00+03:00");
const item = (over: Partial<SelectedEvent> = {}): SelectedEvent => ({
  id: "1", sourceId: "habima", title: "המלט", category: "theater", region: "tel-aviv", venue: "הבימה", city: "תל אביב",
  url: "https://www.habima.co.il/show/1", description: null, dates: [d], nextDate: d,
  recommended: true, review: { score: "positive", summary: "הפקה מרשימה", outlet: "הארץ" }, ...over,
});

test("message has header, event lines, review, link and footer", () => {
  const msg = buildCultureMessage([item()], new Date("2026-09-27T09:00:00+03:00"), new Date("2026-10-04T09:00:00+03:00"), "Asia/Jerusalem", "https://app.example");
  assert.ok(msg.startsWith("🎭 מה כדאי לראות"), msg);
  assert.ok(msg.includes("*המלט*"));
  assert.ok(msg.includes("📍 הבימה, תל אביב"));
  assert.ok(msg.includes("⭐ הפקה מרשימה (הארץ)"));
  assert.ok(msg.includes("🔗 https://www.habima.co.il/show/1"));
  assert.ok(msg.trimEnd().endsWith("https://app.example/culture"));
});

test("no review line for events without a positive review", () => {
  const msg = buildCultureMessage([item({ recommended: false, review: { score: "mixed", summary: "x", outlet: "y" } })],
    new Date(), new Date(), "Asia/Jerusalem", "https://app.example");
  assert.ok(!msg.includes("⭐"));
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `cd functions && npm run build`
Expected: FAIL — `Cannot find module './select'` / `'./message'`.

- [ ] **Step 4: Write `functions/src/culture/select.ts`**

```ts
import { CultureRegion, CultureReview, CultureSettings, CultureType } from "./types";

export interface SelectableEvent {
  id: string;
  sourceId: string;
  title: string;
  category: CultureType;
  region: CultureRegion;
  venue: string;
  city: string;
  url: string;
  description: string | null;
  dates: Date[];
  recommended: boolean;
  review: CultureReview | null;
}

export type SelectedEvent = SelectableEvent & { nextDate: Date };

export function tasteKeywords(taste: string): string[] {
  return taste.split(/[\s,;.]+/).map((w) => w.trim()).filter((w) => w.length >= 3);
}

export function selectForMessage(
  events: SelectableEvent[], culture: CultureSettings, from: Date, to: Date, limit = 8,
): SelectedEvent[] {
  const sources = new Set(culture.sourceIds);
  const keywords = tasteKeywords(culture.taste).map((k) => k.toLowerCase());
  const scored: Array<{ ev: SelectedEvent; score: number }> = [];

  for (const ev of events) {
    if (!sources.has(ev.sourceId)) continue;
    if (culture.regions.length > 0 && !culture.regions.includes(ev.region)) continue;
    if (culture.types.length > 0 && !culture.types.includes(ev.category)) continue;
    const nextDate = ev.dates.find((d) => d >= from && d < to);
    if (!nextDate) continue;
    const haystack = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
    const tasteHits = keywords.filter((k) => haystack.includes(k)).length;
    scored.push({ ev: { ...ev, nextDate }, score: (ev.recommended ? 100 : 0) + tasteHits * 10 });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.ev.nextDate.getTime() - b.ev.nextDate.getTime())
    .slice(0, limit)
    .map((s) => s.ev);
}
```

- [ ] **Step 5: Write `functions/src/culture/message.ts`**

```ts
import { SelectedEvent } from "./select";
import { fmtEventDate } from "./time";
import { CultureType } from "./types";

const EMOJI: Record<CultureType, string> = { cinema: "🎬", theater: "🎭", music: "🎵", venue: "🎤", tickets: "🎟️" };

function fmtDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, day: "numeric", month: "numeric" }).format(date);
}

export function buildCultureMessage(
  items: SelectedEvent[], from: Date, to: Date, timeZone: string, appUrl: string,
): string {
  const lines: string[] = [`🎭 מה כדאי לראות — ${fmtDay(from, timeZone)}–${fmtDay(to, timeZone)}`, ""];
  for (const ev of items) {
    lines.push(`${EMOJI[ev.category]} *${ev.title}*`);
    const place = [ev.venue, ev.city].filter(Boolean).join(", ");
    lines.push(`📍 ${place} · 🗓️ ${fmtEventDate(ev.nextDate, timeZone)}`);
    if (ev.review && ev.review.score === "positive") lines.push(`⭐ ${ev.review.summary} (${ev.review.outlet})`);
    lines.push(`🔗 ${ev.url}`);
    lines.push("");
  }
  lines.push(`לכל האירועים: ${appUrl}/culture`);
  return lines.join("\n");
}
```

- [ ] **Step 6: Run tests**

Run: `cd functions && npm run build && node --test lib/culture/select.test.js lib/culture/message.test.js`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add functions/src/culture/select.ts functions/src/culture/select.test.ts functions/src/culture/message.ts functions/src/culture/message.test.ts
git commit -m "feat(culture): add event selection and WhatsApp message builder"
```

---

### Task 5: Claude scanner module

**Files:**
- Modify: `functions/package.json` (add `@anthropic-ai/sdk`)
- Create: `functions/src/culture/claudeScanner.ts`

**Interfaces:**
- Consumes: `CatalogSource`, `CultureReview`, `CultureType` from `./types`.
- Produces:
  - `anthropicApiKey` (secret param `ANTHROPIC_API_KEY`)
  - `CULTURE_MODEL = "claude-opus-5"`
  - `createCultureClient(): Anthropic`
  - `scanSource(client: Anthropic, source: CatalogSource, todayStr: string, endStr: string): Promise<unknown>` — parsed JSON `{ events: [...] }` (validated later by `validateScanResult`)
  - `lookupReview(client: Anthropic, ev: { title: string; category: CultureType; venue: string }): Promise<CultureReview | null>`

This module is the only Claude-facing code. It has no unit test (it is a thin network wrapper); it is exercised end-to-end in Task 10.

- [ ] **Step 1: Install the SDK**

Run: `cd functions && npm install @anthropic-ai/sdk@latest`
Expected: `functions/package.json` dependencies gain `"@anthropic-ai/sdk"`.

- [ ] **Step 2: Write `functions/src/culture/claudeScanner.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { defineSecret } from "firebase-functions/params";
import { CatalogSource, CultureReview, CultureType } from "./types";

export const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// Single place to change the model (e.g. "claude-sonnet-5" to cut cost).
export const CULTURE_MODEL = "claude-opus-5";
const MAX_CONTINUATIONS = 3;

export function createCultureClient(): Anthropic {
  return new Anthropic({ apiKey: anthropicApiKey.value(), timeout: 5 * 60 * 1000 });
}

/**
 * One structured-output request with server tools. Server tools can end a turn
 * with `pause_turn`; resume by re-sending the assistant content (no extra user
 * message). Returns the parsed JSON from the final text block.
 */
async function runJsonTask(
  client: Anthropic,
  opts: { system: string; prompt: string; tools: Anthropic.Beta.BetaToolUnion[]; schema: Record<string, unknown> },
): Promise<unknown> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const res = await client.beta.messages.create({
      model: CULTURE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      tools: opts.tools,
      output_config: { effort: "medium", format: { type: "json_schema", schema: opts.schema } },
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "refusal") throw new Error(`Claude refused: ${JSON.stringify(res.stop_details)}`);
    if (res.stop_reason === "max_tokens") throw new Error("Claude output truncated (max_tokens)");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return JSON.parse(text);
  }
  throw new Error(`Claude still paused after ${MAX_CONTINUATIONS} continuations`);
}

const SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "venue", "city", "region", "dates", "url", "description"],
        properties: {
          title: { type: "string" },
          venue: { type: "string" },
          city: { type: "string" },
          region: { type: "string" },
          dates: { type: "array", items: { type: "string" } },
          url: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
};

const SCAN_SYSTEM =
  "You extract upcoming cultural events from an Israeli venue or ticketing website. " +
  "Report only what the site itself lists; never invent events, dates or links. " +
  "Keep titles exactly as shown on the site (usually Hebrew).";

export async function scanSource(client: Anthropic, source: CatalogSource, todayStr: string, endStr: string): Promise<unknown> {
  const host = new URL(source.url).hostname.replace(/^www\./, "");
  const prompt = [
    `Site: ${source.name}`,
    `Start page: ${source.url}`,
    `Today (Asia/Jerusalem): ${todayStr}`,
    `Allowed regions for "region": ${source.regions.join(", ")}`,
    "",
    `Fetch the start page, and at most 3 further pages on the same site if needed to reach the events / shows / movies listing.`,
    `Return every event with a performance or screening between ${todayStr} and ${endStr} inclusive.`,
    `- dates: live shows as "YYYY-MM-DDTHH:mm" (local time); cinemas as "YYYY-MM-DD" per screening day, no times. At most 30 dates per event.`,
    `- region: one of the allowed regions, based on the branch / city of the performance.`,
    `- url: the event's own page on this site if shown, otherwise the listing page.`,
    `- description: one short sentence in Hebrew, or "" if unknown.`,
    `If the listing cannot be read, return {"events": []}.`,
  ].join("\n");

  return runJsonTask(client, {
    system: SCAN_SYSTEM,
    prompt,
    schema: SCAN_SCHEMA,
    tools: [
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, allowed_domains: [host], max_content_tokens: 40000 },
      { type: "web_search_20260209", name: "web_search", max_uses: 2, allowed_domains: [host] },
    ],
  });
}

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "score", "summary", "outlet"],
  properties: {
    found: { type: "boolean" },
    score: { type: "string", enum: ["positive", "mixed", "negative"] },
    summary: { type: "string" },
    outlet: { type: "string" },
  },
};

export async function lookupReview(
  client: Anthropic, ev: { title: string; category: CultureType; venue: string },
): Promise<CultureReview | null> {
  const kind = ev.category === "cinema" ? "film" : "theater production";
  const prompt = [
    `Find professional critics' reviews of the ${kind} "${ev.title}"${ev.venue ? ` (${ev.venue})` : ""}, currently showing in Israel.`,
    "Prefer Israeli outlets (Haaretz, Ynet, Walla, Mako, Time Out Israel, Globes, Calcalist); for international films also Rotten Tomatoes or Metacritic.",
    `score: "positive" only if most reviews clearly recommend it; "mixed" if divided; "negative" otherwise.`,
    "summary: one Hebrew sentence with the critics' verdict. outlet: the main outlet(s), comma-separated.",
    `If you find no professional reviews, return found=false, score="mixed", summary="", outlet="".`,
  ].join("\n");

  const out = (await runJsonTask(client, {
    system: "You research critics' reviews of films and plays. Report only what published reviews actually say.",
    prompt,
    schema: REVIEW_SCHEMA,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 },
    ],
  })) as { found: boolean; score: CultureReview["score"]; summary: string; outlet: string };

  if (!out.found || !out.summary) return null;
  return { score: out.score, summary: out.summary.slice(0, 300), outlet: out.outlet.slice(0, 100) };
}
```

- [ ] **Step 3: Build**

Run: `cd functions && npm run build`
Expected: success. If `tsc` reports a type error:
- On `fallbacks` or the `betas` value: confirm the SDK is the latest (`npm ls @anthropic-ai/sdk`, re-run Step 1). If the installed latest still lacks the field, remove both `betas` and `fallbacks` lines and note it in the commit message.
- On a type name (`BetaToolUnion`, `BetaMessageParam`): use the name `tsc` suggests (the SDK exports them under `Anthropic.Beta`). Do not change the request shape.

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/culture/claudeScanner.ts
git commit -m "feat(culture): add Claude scanner for event listings and reviews"
```

---

### Task 6: Nightly scan function

**Files:**
- Create: `functions/src/culture/scan.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `db` (`../firebase`); `CULTURE_CATALOG`; `CultureSourceDoc`, `CultureEventDoc`, `CultureSettings`, `CatalogSource` (`./types`); `validateScanResult`, `pickSourcesToScan`, `ValidEvent` (`./scanResult`); `anthropicApiKey`, `createCultureClient`, `scanSource`, `lookupReview` (`./claudeScanner`); `zoneParts`, `TIMEZONE` (`../notifications/timezone`).
- Produces: exported scheduled function `cultureDailyScan`.

The pure parts are already tested (Tasks 2); this task is Firestore orchestration, verified end-to-end in Task 10.

- [ ] **Step 1: Write `functions/src/culture/scan.ts`**

```ts
import * as functions from "firebase-functions/v2";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase";
import { TIMEZONE, zoneParts } from "../notifications/timezone";
import { CULTURE_CATALOG } from "./catalog";
import { CatalogSource, CultureSettings, CultureSourceDoc } from "./types";
import { pickSourcesToScan, validateScanResult, ValidEvent } from "./scanResult";
import { anthropicApiKey, createCultureClient, lookupReview, scanSource } from "./claudeScanner";

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
    secrets: [anthropicApiKey],
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
```

- [ ] **Step 2: Export it** — append to `functions/src/index.ts`:

```ts
export * from "./culture/scan";
```

- [ ] **Step 3: Build and re-run all culture tests**

Run: `cd functions && npm run build && node --test lib/culture/catalog.test.js lib/culture/time.test.js lib/culture/scanResult.test.js lib/culture/schedule.test.js lib/culture/select.test.js lib/culture/message.test.js`
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add functions/src/culture/scan.ts functions/src/index.ts
git commit -m "feat(culture): add nightly cultureDailyScan function"
```

---

### Task 7: WhatsApp delivery, test callable, and Firestore rules

**Files:**
- Create: `functions/src/culture/notify.ts`
- Modify: `functions/src/notifications/scheduler.ts` (call `processCulture` in the tick)
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `db`; `SettingsDoc`, `DEFAULT_SETTINGS` (`../types`); `sendWhatsApp`, `WhatsAppQuotaExceededError`, `greenApiUrl`, `greenApiInstance`, `greenApiToken` (`../notifications/whatsapp`); `TIMEZONE` (`../notifications/timezone`); `APP_URL` (`../config`); `cultureDueKey`, `nextSendAfter` (`./schedule`); `selectForMessage`, `SelectableEvent` (`./select`); `buildCultureMessage` (`./message`); `CultureEventDoc` (`./types`).
- Produces:
  - `loadCultureEvents(sourceIds: string[]): Promise<SelectableEvent[]>`
  - `processCulture(uid: string, settings: SettingsDoc, now: Date, apiUrl: string, instanceId: string, token: string): Promise<boolean>` — `true` iff WhatsApp quota was hit (same contract as `processDigest`)
  - exported callable `sendTestCultureCallable` (no input; returns `{ ok: true, count: number }`)

- [ ] **Step 1: Write `functions/src/culture/notify.ts`**

```ts
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
```

- [ ] **Step 2: Call it from the tick** — in `functions/src/notifications/scheduler.ts` add the import:

```ts
import { processCulture } from "../culture/notify";
```

and replace the line `if (!tasksQuota) await processDigest(uid, settings, now, apiUrl, instanceId, token);` with:

```ts
        const digestQuota = tasksQuota || await processDigest(uid, settings, now, apiUrl, instanceId, token);
        if (!digestQuota) await processCulture(uid, settings, now, apiUrl, instanceId, token);
```

- [ ] **Step 3: Export the callable** — append to `functions/src/index.ts`:

```ts
export * from "./culture/notify";
```

(`loadCultureEvents`/`processCulture` are plain functions; Firebase only deploys exported function triggers, so exporting them is harmless.)

- [ ] **Step 4: Firestore rules** — in `firestore.rules`, add before the `/oauthState/{stateId}` block:

```
    // ─── /cultureSources/{id} , /cultureEvents/{id} ─────────────────────────
    // Shared culture catalog and scanned events — any signed-in user may read;
    // written only by the cultureDailyScan Cloud Function.
    match /cultureSources/{id} {
      allow read:  if isAuth();
      allow write: if false;
    }
    match /cultureEvents/{id} {
      allow read:  if isAuth();
      allow write: if false;
    }

    // ─── /cultureSentLog/{uid} ──────────────────────────────────────────────
    // Culture WhatsApp dedup log — Cloud Functions only.
    match /cultureSentLog/{uid} {
      allow read, write: if false;
    }
```

- [ ] **Step 5: Build and run all culture tests**

Run: `cd functions && npm run build && node --test lib/culture/catalog.test.js lib/culture/time.test.js lib/culture/scanResult.test.js lib/culture/schedule.test.js lib/culture/select.test.js lib/culture/message.test.js lib/notifications/nag.test.js`
Expected: build succeeds (this is what verifies the scheduler wiring type-checks); all tests pass.

- [ ] **Step 6: Commit**

```bash
git add functions/src/culture/notify.ts functions/src/notifications/scheduler.ts functions/src/index.ts firestore.rules
git commit -m "feat(culture): send culture picks on WhatsApp schedule and add test callable"
```

---

### Task 8: Client helpers and settings section

**Files:**
- Modify: `src/lib/culture.ts` (add `filterSources`, `nextDateInRange`)
- Test: `src/lib/culture.test.ts`
- Modify: `package.json` (script `test:culture`)
- Create: `src/components/settings/CultureSection.tsx`
- Modify: `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: types/labels from Task 1 `src/lib/culture.ts`; `useAuth` (`@/lib/firebase/auth-context`); `DEFAULT_SETTINGS` (`@/lib/types`).
- Produces:
  - `filterSources(sources: ClientCultureSource[], regions: CultureRegion[], types: CultureType[]): ClientCultureSource[]` — enabled only; empty regions/types = all.
  - `nextDateInRange(dates: Date[], from: Date, to: Date | null): Date | null`
  - Default-exported React component `CultureSection`.

- [ ] **Step 1: Write the failing test `src/lib/culture.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSources, nextDateInRange, type ClientCultureSource } from "./culture";

const src = (id: string, over: Partial<ClientCultureSource> = {}): ClientCultureSource => ({
  id, name: id, url: `https://${id}.co.il/`, type: "theater", regions: ["tel-aviv"], enabled: true, ...over,
});

test("filterSources: empty filters return all enabled sources", () => {
  const out = filterSources([src("a"), src("b", { enabled: false })], [], []);
  assert.deepEqual(out.map((s) => s.id), ["a"]);
});

test("filterSources: region intersects, type matches", () => {
  const all = [src("a"), src("b", { regions: ["south"] }), src("c", { type: "cinema", regions: ["tel-aviv", "south"] })];
  assert.deepEqual(filterSources(all, ["south"], []).map((s) => s.id), ["b", "c"]);
  assert.deepEqual(filterSources(all, ["south"], ["cinema"]).map((s) => s.id), ["c"]);
});

test("nextDateInRange returns first date in [from, to)", () => {
  const d = (s: string) => new Date(s);
  const dates = [d("2026-09-20T10:00:00Z"), d("2026-09-28T10:00:00Z"), d("2026-10-10T10:00:00Z")];
  assert.equal(nextDateInRange(dates, d("2026-09-26T00:00:00Z"), d("2026-10-01T00:00:00Z"))?.toISOString(), "2026-09-28T10:00:00.000Z");
  assert.equal(nextDateInRange(dates, d("2026-10-11T00:00:00Z"), null), null);
  assert.equal(nextDateInRange(dates, d("2026-10-01T00:00:00Z"), null)?.toISOString(), "2026-10-10T10:00:00.000Z");
});
```

- [ ] **Step 2: Add the test script** — in root `package.json` `"scripts"`, add after `test:calendar-range`:

```json
    "test:culture": "tsx --test src/lib/culture.test.ts"
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:culture`
Expected: FAIL — `filterSources` is not exported.

- [ ] **Step 4: Append to `src/lib/culture.ts`**

```ts
export function filterSources(
  sources: ClientCultureSource[], regions: CultureRegion[], types: CultureType[],
): ClientCultureSource[] {
  return sources.filter((s) =>
    s.enabled &&
    (regions.length === 0 || s.regions.some((r) => regions.includes(r))) &&
    (types.length === 0 || types.includes(s.type)),
  );
}

export function nextDateInRange(dates: Date[], from: Date, to: Date | null): Date | null {
  return dates.find((d) => d >= from && (to === null || d < to)) ?? null;
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test:culture`
Expected: 3 pass.

- [ ] **Step 6: Write `src/components/settings/CultureSection.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { DEFAULT_SETTINGS } from "@/lib/types";
import {
  CULTURE_REGIONS, CULTURE_TYPES, REGION_LABELS, TYPE_LABELS, WEEKDAY_LABELS, filterSources,
  type ClientCultureSource, type CultureFrequency, type CultureRegion, type CultureType,
} from "@/lib/culture";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-sm transition"
      style={{
        background: active ? "#EFF4FF" : "#F8FAFC",
        color: active ? "#2563EB" : "#5B6477",
        border: `1px solid ${active ? "#2563EB55" : "#E8EDF5"}`,
      }}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function normalizeDays(frequency: CultureFrequency, days: number[]): number[] {
  if (frequency === "daily") return [];
  if (frequency === "weekly") return [days[0] ?? 0];
  const uniq = [...new Set(days)].slice(0, 2);
  return uniq.length === 2 ? uniq.sort() : [0, 3];
}

export default function CultureSection() {
  const { user } = useAuth();
  const d = DEFAULT_SETTINGS.culture;
  const [enabled, setEnabled] = useState(d.enabled);
  const [regions, setRegions] = useState<CultureRegion[]>(d.regions);
  const [types, setTypes] = useState<CultureType[]>(d.types);
  const [sourceIds, setSourceIds] = useState<string[]>(d.sourceIds);
  const [taste, setTaste] = useState(d.taste);
  const [frequency, setFrequency] = useState<CultureFrequency>(d.frequency);
  const [days, setDays] = useState<number[]>(d.days);
  const [time, setTime] = useState(d.time);
  const [sources, setSources] = useState<ClientCultureSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { doc, onSnapshot, collection, getDocs }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const srcSnap = await getDocs(collection(db, "cultureSources"));
      setSources(srcSnap.docs.map((s) => ({ id: s.id, ...(s.data() as Omit<ClientCultureSource, "id">) }))
        .sort((a, b) => a.name.localeCompare(b.name, "he")));
      unsubscribe = onSnapshot(doc(db, "settings", user.uid), (snap) => {
        if (!loadedOnce.current) {
          const c = snap.data()?.culture;
          if (c) {
            setEnabled(!!c.enabled);
            if (c.regions) setRegions(c.regions);
            if (c.types) setTypes(c.types);
            if (c.sourceIds) setSourceIds(c.sourceIds);
            if (typeof c.taste === "string") setTaste(c.taste);
            if (c.frequency) setFrequency(c.frequency);
            if (c.days) setDays(c.days);
            if (c.time) setTime(c.time);
          }
          loadedOnce.current = true;
        }
        setLoading(false);
      });
    })();
    return () => unsubscribe?.();
  }, [user]);

  const visible = useMemo(() => filterSources(sources, regions, types), [sources, regions, types]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const [{ db }, { doc, setDoc }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const visibleIds = new Set(visible.map((s) => s.id));
      const culture = {
        enabled, regions, types, taste: taste.trim(), frequency, time,
        sourceIds: sourceIds.filter((id) => visibleIds.has(id)),
        days: normalizeDays(frequency, days),
      };
      await setDoc(doc(db, "settings", user.uid), { culture }, { merge: true });
      setSourceIds(culture.sourceIds);
      setDays(culture.days);
      setSaveMsg("נשמר");
    } catch {
      setSaveMsg("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const [app, { getFunctions, httpsCallable }] = await Promise.all([
        import("@/lib/firebase/client").then((m) => m.default),
        import("firebase/functions"),
      ]);
      const fns = getFunctions(app, "us-central1");
      const res = await httpsCallable<void, { ok: boolean; count: number }>(fns, "sendTestCultureCallable")();
      setTestMsg(`נשלח ✓ (${res.data.count} אירועים)`);
    } catch (err) {
      setTestMsg(`שגיאה: ${err instanceof Error ? err.message : "לא ידוע"}`);
    } finally {
      setTesting(false);
    }
  };

  const selectStyle = "bg-[#F8FAFC] border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]";
  const dayFor = (i: number) => days[i] ?? (i === 0 ? 0 : 3);

  return (
    <div className="bg-white rounded-2xl p-6 space-y-4" style={{ border: "1px solid #E8EDF5" }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "#0D1321" }}>🎭 אירועי תרבות</h2>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
          בחרו אזורים ואתרים לסריקה. האירועים מתעדכנים כל לילה ומוצגים בעמוד &quot;תרבות&quot;, והמומלצים נשלחים ב-WhatsApp.
        </p>
      </div>

      {loading ? (
        <div className="h-10 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
      ) : (
        <>
          <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setEnabled((v) => !v)}>
            <div className="relative w-11 h-6 rounded-full transition-colors" style={{ background: enabled ? "#22C55E" : "#E8EDF5" }}>
              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-sm font-medium" style={{ color: enabled ? "#22C55E" : "#5B6477" }}>
              {enabled ? "הודעות תרבות מופעלות" : "הודעות תרבות כבויות"}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>אזורים (ללא בחירה = הכל)</label>
            <div className="flex flex-wrap gap-2">
              {CULTURE_REGIONS.map((r) => (
                <Chip key={r} active={regions.includes(r)} onClick={() => setRegions((p) => toggle(p, r))}>{REGION_LABELS[r]}</Chip>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>סוגי אתרים (ללא בחירה = הכל)</label>
            <div className="flex flex-wrap gap-2">
              {CULTURE_TYPES.map((t) => (
                <Chip key={t} active={types.includes(t)} onClick={() => setTypes((p) => toggle(p, t))}>{TYPE_LABELS[t]}</Chip>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>אתרים לסריקה</label>
            {visible.length === 0 ? (
              <p className="text-sm" style={{ color: "#5B6477" }}>
                {sources.length === 0 ? "רשימת האתרים תופיע אחרי הסריקה הראשונה." : "אין אתרים שמתאימים לסינון."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {visible.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#0D1321" }}>
                    <input type="checkbox" checked={sourceIds.includes(s.id)} onChange={() => setSourceIds((p) => toggle(p, s.id))} />
                    <span>{s.name}</span>
                    <span className="text-xs" style={{ color: "#5B6477" }}>· {TYPE_LABELS[s.type]}</span>
                    {(s.consecutiveFailures ?? 0) >= 3 && (
                      <span className="text-xs" style={{ color: "#EF4444" }}>· סריקה לא זמינה כרגע</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>טעם אישי (לא חובה)</label>
            <input
              value={taste}
              onChange={(e) => setTaste(e.target.value)}
              placeholder="למשל: דרמות אירופיות, ג'אז, בלי מחזות זמר"
              className={`w-full ${selectStyle}`}
              style={{ color: "#0D1321" }}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>תדירות</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as CultureFrequency)} className={selectStyle} style={{ color: "#0D1321" }}>
                <option value="daily">כל יום</option>
                <option value="twiceWeekly">פעמיים בשבוע</option>
                <option value="weekly">פעם בשבוע</option>
              </select>
            </div>
            {frequency !== "daily" && [0, 1].slice(0, frequency === "weekly" ? 1 : 2).map((i) => (
              <div key={i}>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>{i === 0 ? "יום" : "יום נוסף"}</label>
                <select
                  value={dayFor(i)}
                  onChange={(e) => setDays(() => { const next = [dayFor(0), dayFor(1)]; next[i] = Number(e.target.value); return next; })}
                  className={selectStyle}
                  style={{ color: "#0D1321" }}
                >
                  {WEEKDAY_LABELS.map((label, idx) => <option key={idx} value={idx}>{label}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "#5B6477" }}>שעה</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={selectStyle} style={{ color: "#0D1321" }} />
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "#2563EB" }}>
          {saving ? "שומר..." : "שמור"}
        </button>
        <button onClick={sendTest} disabled={testing || sourceIds.length === 0} className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50" style={{ borderColor: "#E8EDF5", color: "#0D1321" }}>
          {testing ? "שולח..." : "שלח הודעת בדיקה"}
        </button>
        {saveMsg && <span className="text-sm" style={{ color: saveMsg === "נשמר" ? "#22C55E" : "#EF4444" }}>{saveMsg}</span>}
        {testMsg && <span className="text-sm" style={{ color: testMsg.startsWith("נשלח") ? "#22C55E" : "#EF4444" }}>{testMsg}</span>}
      </div>
    </div>
  );
}
```

Note: the test button uses the *saved* settings (the callable reads Firestore), so save first.

- [ ] **Step 7: Mount it** — in `app/(app)/settings/page.tsx` add `import CultureSection from "@/components/settings/CultureSection";` next to the other section imports, and render `<CultureSection />` between `<DigestSection />` and `<WhatsAppSection />`.

- [ ] **Step 8: Type-check and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/culture.ts src/lib/culture.test.ts package.json src/components/settings/CultureSection.tsx "app/(app)/settings/page.tsx"
git commit -m "feat(culture): add culture settings section"
```

---

### Task 9: `/culture` page and navigation

**Files:**
- Create: `src/components/culture/CultureEventCard.tsx`
- Create: `app/(app)/culture/page.tsx`
- Modify: `app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `ClientCultureEvent`, `ClientCultureSource`, `CultureSettings`, `DEFAULT_CULTURE_SETTINGS`, `REGION_LABELS`, `TYPE_LABELS`, `TYPE_EMOJI`, `CULTURE_REGIONS`, `CULTURE_TYPES`, `nextDateInRange` from `@/lib/culture`; `useAuth`.
- Produces: default-exported `CultureEventCard({ event, nextDate, sourceName })` and the `/culture` page.

- [ ] **Step 1: Write `src/components/culture/CultureEventCard.tsx`**

```tsx
import { TYPE_EMOJI, REGION_LABELS, type ClientCultureEvent } from "@/lib/culture";

const TZ = "Asia/Jerusalem";

function fmtNext(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const dateOnly = parts === "00:00";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "long",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}

export default function CultureEventCard({
  event, nextDate, sourceName,
}: { event: ClientCultureEvent; nextDate: Date; sourceName: string }) {
  const more = event.dates.length - 1;
  return (
    <a
      href={event.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-2xl p-4 transition hover:shadow-sm"
      style={{ border: `1px solid ${event.recommended ? "#22C55E66" : "#E8EDF5"}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold" style={{ color: "#0D1321" }}>
          {TYPE_EMOJI[event.category]} {event.title}
        </h3>
        {event.recommended && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "#DCFCE7", color: "#15803D" }}>
            מומלץ
          </span>
        )}
      </div>
      <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
        📍 {[event.venue, event.city].filter(Boolean).join(", ") || REGION_LABELS[event.region]} · {sourceName}
      </p>
      <p className="text-sm mt-0.5" style={{ color: "#0D1321" }}>
        🗓️ {fmtNext(nextDate)}{more > 0 ? ` (+${more} מועדים)` : ""}
      </p>
      {event.review && event.review.score === "positive" && (
        <p className="text-sm mt-2" style={{ color: "#15803D" }}>⭐ {event.review.summary} ({event.review.outlet})</p>
      )}
      {event.description && <p className="text-sm mt-2" style={{ color: "#5B6477" }}>{event.description}</p>}
    </a>
  );
}
```

- [ ] **Step 2: Write `app/(app)/culture/page.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import CultureEventCard from "@/components/culture/CultureEventCard";
import {
  CULTURE_REGIONS, CULTURE_TYPES, DEFAULT_CULTURE_SETTINGS, REGION_LABELS, TYPE_LABELS, nextDateInRange,
  type ClientCultureEvent, type ClientCultureSource, type CultureRegion, type CultureSettings, type CultureType,
} from "@/lib/culture";

type Range = "today" | "week" | "all";
const DAY_MS = 24 * 60 * 60 * 1000;

function rangeEnd(range: Range, now: Date): Date | null {
  if (range === "all") return null;
  if (range === "week") return new Date(now.getTime() + 7 * DAY_MS);
  // End of today in Asia/Jerusalem.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const noonLocalHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(noonUtc));
  const offsetH = noonLocalHour - 12;
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - offsetH * 3600000 + DAY_MS);
}

export default function CulturePage() {
  const { user } = useAuth();
  const [culture, setCulture] = useState<CultureSettings>(DEFAULT_CULTURE_SETTINGS);
  const [sources, setSources] = useState<Map<string, ClientCultureSource>>(new Map());
  const [events, setEvents] = useState<ClientCultureEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<CultureType | "all">("all");
  const [region, setRegion] = useState<CultureRegion | "all">("all");
  const [range, setRange] = useState<Range>("week");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ db }, { doc, getDoc, collection, getDocs, query, where }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const settingsSnap = await getDoc(doc(db, "settings", user.uid));
      const c: CultureSettings = { ...DEFAULT_CULTURE_SETTINGS, ...(settingsSnap.data()?.culture ?? {}) };
      const srcSnap = await getDocs(collection(db, "cultureSources"));
      const srcMap = new Map(srcSnap.docs.map((s) => [s.id, { id: s.id, ...(s.data() as Omit<ClientCultureSource, "id">) }]));
      const loaded: ClientCultureEvent[] = [];
      for (let i = 0; i < c.sourceIds.length; i += 30) {
        const snap = await getDocs(query(collection(db, "cultureEvents"), where("sourceId", "in", c.sourceIds.slice(i, i + 30))));
        snap.docs.forEach((d) => loaded.push({ id: d.id, ...(d.data() as Omit<ClientCultureEvent, "id">) }));
      }
      if (cancelled) return;
      setCulture(c);
      setSources(srcMap);
      setEvents(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const list = useMemo(() => {
    const now = new Date();
    const end = rangeEnd(range, now);
    return events
      .filter((e) => (culture.regions.length === 0 || culture.regions.includes(e.region)))
      .filter((e) => (culture.types.length === 0 || culture.types.includes(e.category)))
      .filter((e) => (type === "all" || e.category === type) && (region === "all" || e.region === region))
      .map((e) => ({ e, next: nextDateInRange(e.dates.map((t) => t.toDate()), now, end) }))
      .filter((x): x is { e: ClientCultureEvent; next: Date } => x.next !== null)
      .sort((a, b) => Number(b.e.recommended) - Number(a.e.recommended) || a.next.getTime() - b.next.getTime());
  }, [events, culture, type, region, range]);

  const selectStyle = "bg-white border border-[#E8EDF5] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#2563EB]";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>תרבות</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>אירועים מהאתרים והאזורים שבחרת · מתעדכן כל לילה</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={range} onChange={(e) => setRange(e.target.value as Range)} className={selectStyle} style={{ color: "#0D1321" }}>
          <option value="today">היום</option>
          <option value="week">השבוע</option>
          <option value="all">הכל</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as CultureType | "all")} className={selectStyle} style={{ color: "#0D1321" }}>
          <option value="all">כל הסוגים</option>
          {CULTURE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value as CultureRegion | "all")} className={selectStyle} style={{ color: "#0D1321" }}>
          <option value="all">כל האזורים</option>
          {CULTURE_REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: "#E8EDF5" }} />)}
        </div>
      ) : culture.sourceIds.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-sm" style={{ border: "1px solid #E8EDF5", color: "#5B6477" }}>
          עוד לא בחרת אתרים. <Link href="/settings" style={{ color: "#2563EB" }}>לבחירה בהגדרות</Link>
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-sm" style={{ border: "1px solid #E8EDF5", color: "#5B6477" }}>
          לא נמצאו אירועים בטווח שנבחר. אתרים חדשים נסרקים בלילה הקרוב.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map(({ e, next }) => (
            <CultureEventCard key={e.id} event={e} nextDate={next} sourceName={sources.get(e.sourceId)?.name ?? e.sourceId} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the nav item** — in `app/(app)/layout.tsx` add `Ticket` to the lucide import list and insert into `NAV` before the settings entry:

```ts
  { href: "/culture",   label: "תרבות",    Icon: Ticket },
```

- [ ] **Step 4: Type-check, lint, build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: no errors; static export includes `out/culture.html` (or `out/culture/index.html`).

- [ ] **Step 5: Commit**

```bash
git add src/components/culture/CultureEventCard.tsx "app/(app)/culture/page.tsx" "app/(app)/layout.tsx"
git commit -m "feat(culture): add culture events page and nav item"
```

---

### Task 10: Deploy and verify end-to-end

**Files:** none (operational). Record any catalog URL fixes as a follow-up commit.

- [ ] **Step 1: Set the secret**

Run: `firebase functions:secrets:set ANTHROPIC_API_KEY`
Expected: prompt for the value; `✔ Created a new secret version`.

- [ ] **Step 2: Deploy functions and rules**

Run: `firebase deploy --only functions,firestore:rules`
Expected: `cultureDailyScan(us-central1)` and `sendTestCultureCallable(us-central1)` created; `whatsappSchedulerTick` updated; rules released.

- [ ] **Step 3: Seed the catalog and run a first scan now**

Run: `gcloud scheduler jobs run firebase-schedule-cultureDailyScan-us-central1 --location=us-central1 --project=calendarsync-dror`
Then: `firebase functions:log --only cultureDailyScan`
Expected: `cultureDailyScan: 0 sources (0 selected)` on this first run (no one has selected sources yet) and the `cultureSources` collection exists in the Firestore console with one doc per catalog entry.

- [ ] **Step 4: Deploy hosting**

Run: `npm run build && firebase deploy --only hosting`
Expected: deploy complete.

- [ ] **Step 5: Select sources in the app** — open `https://calendarsync-dror.web.app/settings`, in "🎭 אירועי תרבות": enable, pick region תל אביב and השרון, select צוותא, זאפה, הקאמרי, סינמה סיטי, set frequency and time, click שמור.
Expected: "נשמר"; Firestore `settings/{uid}.culture.sourceIds` has the 4 ids.

- [ ] **Step 6: Scan the selected sources**

Run: `gcloud scheduler jobs run firebase-schedule-cultureDailyScan-us-central1 --location=us-central1 --project=calendarsync-dror` then `firebase functions:log --only cultureDailyScan`
Expected: `cultureDailyScan: 4 sources (4 selected)`, one `→ N events` line per source (N > 0 for most), `reviewed K`. For any source with `failed` or `→ 0 events`, open `cultureSources/{id}.lastScan.error` in the console; if the URL is wrong, fix it in `catalog.ts` and redeploy. Sites that render listings only via JavaScript may legitimately return 0 events — note them; they can be removed from the catalog or pointed at a static listing page.

- [ ] **Step 7: Check the page** — open `/culture`.
Expected: event cards from the selected sources; cinema/theater events with positive reviews show "מומלץ" and a ⭐ line; filters change the list.

- [ ] **Step 8: Test WhatsApp** — in settings click "שלח הודעת בדיקה".
Expected: "נשלח ✓ (N אירועים)" and a WhatsApp message starting with `🎭 מה כדאי לראות` with at most 8 events and the `/culture` link.

- [ ] **Step 9: Verify scheduled delivery** — set the culture time to ~10 minutes from now on today's weekday, save, wait, then `firebase functions:log --only whatsappSchedulerTick`.
Expected: the message arrives once; `cultureSentLog/{uid}.sent` has `"<today>_<time>": true`; no second message on the next tick.

- [ ] **Step 10: Commit any catalog fixes**

```bash
git add functions/src/culture/catalog.ts
git commit -m "fix(culture): correct catalog URLs after first live scan"
```

---

## Cost note (for the operator)

Rough order of magnitude with `claude-opus-5` ($5 / $25 per MTok): a source scan is dominated by fetched page content (capped at 40K tokens per fetch) — roughly $0.15–0.40 per source per night; a review lookup roughly $0.05–0.15, once per new cinema/theater event. With ~15 selected sources that is on the order of a few dollars per night. Changing `CULTURE_MODEL` to `claude-sonnet-5` ($2 / $10) cuts this by ~60%. Measure real spend from the Anthropic console after the first week before tuning caps.
