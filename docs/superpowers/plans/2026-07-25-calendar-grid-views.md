# Calendar Week/Month Grid Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hand-built Week and Month grid views to the Calendar page, with a segmented toggle (רשימה | שבוע | חודש), prev/next clamped to the existing sync window, and a shared event-detail modal that reuses `AddReminderModal`.

**Architecture:** Pure date-math helpers in `src/lib/calendar/range.ts` drive both Firestore query bounds and nav clamping. `CalendarPage` owns `view` + `anchorDate` state and switches between the existing Agenda query (unchanged) and a bounded week/month query. New presentational components (`CalendarViewToggle`, `WeekView`, `MonthView`, `EventDetailModal`) stay dumb — they receive events + callbacks, no Firestore.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Firebase Firestore client SDK, Tailwind CSS 4, lucide-react. No calendar UI library. Unit tests for pure date helpers via Node's built-in `node:test` + `node:assert` (zero new deps), matching the Slack plan's test strategy.

## Global Constraints

- Default view on page load: **`agenda`** — Agenda query and `AgendaView` behavior stay unchanged.
- Week is **Sunday–Saturday** (Israeli week convention; same as digest `isIsraeliWorkday`).
- All day-boundary math uses **`Asia/Jerusalem`** (same timezone already hardcoded in `AgendaView` and `functions/src/notifications/timezone.ts`).
- Navigation clamps to the backend sync window: **yesterday → today+30 days** (`WINDOW_PAST_MS` / `WINDOW_FUTURE_MS` in `functions/src/calendar/sync.ts`). No backend changes.
- Event click in Week/Month opens **`EventDetailModal`**; its "הוסף לתזכורות" button opens the existing **`AddReminderModal`** with the same prefill shape Agenda already uses.
- Read-only: no event create/edit/drag.
- **Test strategy for this codebase**: no frontend test framework. Pure date helpers get real unit tests with `node:test`. UI pieces verify with `npm run build && npm run lint`, then manual browser checks listed in each task.
- Visual language: match existing Calendar/Agenda tokens (`#0D1321`, `#5B6477`, `#E8EDF5`, `#F8FAFC`, event `color` dots, rounded-2xl white panels). RTL layout (app is Hebrew).

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/calendar/range.ts` | Pure helpers: week/month bounds, sync-window bounds, canNavigatePrev/Next, period label, day cells for month grid |
| `src/lib/calendar/range.test.ts` | `node:test` coverage for the helpers |
| `src/components/calendar/CalendarViewToggle.tsx` | Segmented control + prev/next + "היום" |
| `src/components/calendar/WeekView.tsx` | 7 day-columns of event chips |
| `src/components/calendar/MonthView.tsx` | 7×N day-cell grid with overflow "+N" |
| `src/components/calendar/EventDetailModal.tsx` | Shared popup for Week/Month event clicks |
| `app/(app)/calendar/page.tsx` | Wire view/anchorDate state, dual query, compose components |
| `package.json` | Add `"test:calendar-range"` script |

---

### Task 1: Date-range helpers + unit tests

**Files:**
- Create: `src/lib/calendar/range.ts`
- Create: `src/lib/calendar/range.test.ts`
- Modify: `package.json` (add script)

**Interfaces:**
- Produces:
  - `TIMEZONE = "Asia/Jerusalem"`
  - `CalendarView = "agenda" | "week" | "month"`
  - `SyncWindow = { start: Date; end: Date }`
  - `VisibleRange = { start: Date; end: Date }` — half-open `[start, end)`
  - `getSyncWindow(now: Date): SyncWindow`
  - `getWeekRange(anchor: Date): VisibleRange`
  - `getMonthRange(anchor: Date): VisibleRange`
  - `getVisibleRange(view: CalendarView, anchor: Date): VisibleRange | null` — `null` for agenda
  - `shiftAnchor(view: "week" | "month", anchor: Date, direction: -1 | 1): Date`
  - `canNavigate(view: "week" | "month", anchor: Date, direction: -1 | 1, now?: Date): boolean`
  - `periodLabel(view: "week" | "month", anchor: Date): string`
  - `getMonthGridDays(anchor: Date): Date[]` — Sunday-start padded cells covering the month
  - `dayKey(date: Date): string` — `YYYY-MM-DD` in Asia/Jerusalem
  - `startOfLocalDay(date: Date): Date` — midnight of that Jerusalem calendar day as a UTC instant
  - `addLocalDays(date: Date, days: number): Date` — exported; used by WeekView to build the 7 columns

- [ ] **Step 1: Write the failing tests**

Create `src/lib/calendar/range.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSyncWindow,
  getWeekRange,
  getMonthRange,
  shiftAnchor,
  canNavigate,
  periodLabel,
  getMonthGridDays,
  dayKey,
  startOfLocalDay,
} from "./range.ts";

// Fixed "now": Wednesday 2026-07-15 12:00 Asia/Jerusalem ≈ 09:00 UTC
const NOW = new Date("2026-07-15T09:00:00.000Z");

describe("dayKey / startOfLocalDay", () => {
  it("dayKey formats in Asia/Jerusalem", () => {
    // 2026-07-15 23:30 UTC = 2026-07-16 02:30 Asia/Jerusalem
    assert.equal(dayKey(new Date("2026-07-15T23:30:00.000Z")), "2026-07-16");
  });

  it("startOfLocalDay returns Jerusalem midnight as UTC instant", () => {
    const start = startOfLocalDay(new Date("2026-07-15T09:00:00.000Z"));
    assert.equal(dayKey(start), "2026-07-15");
    assert.equal(start.toISOString(), "2026-07-14T21:00:00.000Z"); // IDT = UTC+3 in July
  });
});

describe("getWeekRange", () => {
  it("returns Sunday–Saturday week containing the anchor", () => {
    // Wed 2026-07-15 → Sun 2026-07-12 .. Sun 2026-07-19
    const { start, end } = getWeekRange(NOW);
    assert.equal(dayKey(start), "2026-07-12");
    assert.equal(dayKey(end), "2026-07-19");
  });

  it("anchor already on Sunday stays on that Sunday", () => {
    const sunday = startOfLocalDay(new Date("2026-07-12T09:00:00.000Z"));
    const { start, end } = getWeekRange(sunday);
    assert.equal(dayKey(start), "2026-07-12");
    assert.equal(dayKey(end), "2026-07-19");
  });
});

describe("getMonthRange", () => {
  it("returns [1st of month, 1st of next month)", () => {
    const { start, end } = getMonthRange(NOW);
    assert.equal(dayKey(start), "2026-07-01");
    assert.equal(dayKey(end), "2026-08-01");
  });
});

describe("getSyncWindow", () => {
  it("spans yesterday through today+30 days (half-open end = startOf day after +30)", () => {
    const { start, end } = getSyncWindow(NOW);
    assert.equal(dayKey(start), "2026-07-14"); // yesterday
    // today+30 = 2026-08-14; half-open end is start of 2026-08-15
    assert.equal(dayKey(end), "2026-08-15");
  });
});

describe("shiftAnchor / canNavigate", () => {
  it("shiftAnchor week moves by 7 days", () => {
    const next = shiftAnchor("week", NOW, 1);
    assert.equal(dayKey(next), "2026-07-22");
    const prev = shiftAnchor("week", NOW, -1);
    assert.equal(dayKey(prev), "2026-07-08");
  });

  it("shiftAnchor month moves by calendar month", () => {
    const next = shiftAnchor("month", NOW, 1);
    assert.equal(dayKey(next), "2026-08-15");
    const prev = shiftAnchor("month", NOW, -1);
    assert.equal(dayKey(prev), "2026-06-15");
  });

  it("canNavigate prev week is false when previous week starts before sync window", () => {
    // Window starts 2026-07-14. Week of Jul 5–11 starts before that.
    const early = startOfLocalDay(new Date("2026-07-08T09:00:00.000Z"));
    assert.equal(canNavigate("week", early, -1, NOW), false);
    assert.equal(canNavigate("week", early, 1, NOW), true);
  });

  it("canNavigate next month is false when next month ends past sync window", () => {
    // Window half-open end = 2026-08-15. August range is [08-01, 09-01) which extends past.
    // From July, next month (August) should be blocked because August's rangeEnd > window.end.
    assert.equal(canNavigate("month", NOW, 1, NOW), false);
    assert.equal(canNavigate("month", NOW, -1, NOW), false); // June starts before window
  });

  it("canNavigate allows current week prev/next when both neighbor weeks fit", () => {
    // Pick an anchor whose prev and next weeks both sit inside [Jul 14, Aug 15)
    // Week of Jul 19–25: prev = Jul 12–19 starts Jul 12 < Jul 14 → prev false
    // Week of Jul 26 – Aug 1: start Jul 26 >= Jul 14, end Aug 2 < Aug 15 → both? 
    //   prev week Jul 19–26: start Jul 19 OK; next week Aug 2–9: end Aug 9 OK
    const mid = startOfLocalDay(new Date("2026-07-28T09:00:00.000Z"));
    assert.equal(canNavigate("week", mid, -1, NOW), true);
    assert.equal(canNavigate("week", mid, 1, NOW), true);
  });
});

describe("periodLabel", () => {
  it("formats week and month labels in Hebrew", () => {
    const week = periodLabel("week", NOW);
    assert.match(week, /יולי/);
    const month = periodLabel("month", NOW);
    assert.match(month, /יולי/);
    assert.match(month, /2026/);
  });
});

describe("getMonthGridDays", () => {
  it("pads to Sunday-start and covers full weeks", () => {
    // July 2026: 1st is Wednesday → grid starts Sun Jun 28
    const days = getMonthGridDays(NOW);
    assert.ok(days.length === 35 || days.length === 42);
    assert.equal(dayKey(days[0]), "2026-06-28");
    assert.equal(days.length % 7, 0);
    // last cell is the Saturday of the last week that includes Jul 31 (Fri)
    assert.equal(dayKey(days[days.length - 1]), "2026-08-01");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd calendarsync
npx --yes tsx --test src/lib/calendar/range.test.ts
```

Expected: FAIL with `Cannot find module './range.ts'` (or equivalent module-not-found).

- [ ] **Step 3: Implement `src/lib/calendar/range.ts`**

```ts
export const TIMEZONE = "Asia/Jerusalem";

export type CalendarView = "agenda" | "week" | "month";

export type SyncWindow = { start: Date; end: Date };
export type VisibleRange = { start: Date; end: Date };

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function zoneParts(date: Date): { dateStr: string; dayOfWeek: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAY_MAP[parts.weekday] ?? 0,
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
  };
}

/** Midnight of the Jerusalem calendar day containing `date`, as a UTC Date. */
export function startOfLocalDay(date: Date): Date {
  const { dateStr } = zoneParts(date);
  // Probe: interpret dateStr as UTC midnight, then subtract the Jerusalem offset at that instant.
  const utcMidnightGuess = new Date(`${dateStr}T00:00:00Z`);
  const guess = zoneParts(utcMidnightGuess);
  // Re-read hour/minute of that guess in Jerusalem to find the offset.
  const offsetFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const op = Object.fromEntries(offsetFmt.formatToParts(utcMidnightGuess).map((p) => [p.type, p.value]));
  const guessMinutes = (parseInt(op.hour, 10) % 24) * 60 + parseInt(op.minute, 10);
  return new Date(utcMidnightGuess.getTime() - guessMinutes * 60 * 1000);
}

export function dayKey(date: Date): string {
  return zoneParts(date).dateStr;
}

export function addLocalDays(date: Date, days: number): Date {
  // Advance by calendar days in Jerusalem by reconstructing from Y-M-D parts.
  const p = zoneParts(date);
  // Use UTC noon on a Date built from parts, then re-snap — avoids DST edge issues for day arithmetic.
  const utcNoon = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0));
  return startOfLocalDay(utcNoon);
}

export function getWeekRange(anchor: Date): VisibleRange {
  const p = zoneParts(anchor);
  const start = addLocalDays(startOfLocalDay(anchor), -p.dayOfWeek); // back to Sunday
  const end = addLocalDays(start, 7);
  return { start, end };
}

export function getMonthRange(anchor: Date): VisibleRange {
  const p = zoneParts(anchor);
  const start = startOfLocalDay(new Date(Date.UTC(p.year, p.month - 1, 1, 12, 0, 0)));
  const end = startOfLocalDay(new Date(Date.UTC(p.year, p.month, 1, 12, 0, 0))); // month is 1-indexed; Date.UTC month is 0-indexed so p.month == next month index
  return { start, end };
}

export function getVisibleRange(view: CalendarView, anchor: Date): VisibleRange | null {
  if (view === "agenda") return null;
  return view === "week" ? getWeekRange(anchor) : getMonthRange(anchor);
}

/**
 * Sync window matching functions/src/calendar/sync.ts:
 * windowStart = now - 1 day, windowEnd = now + 30 days.
 * We expose half-open [startOf(yesterday), startOf(today+31)) so day-level
 * comparisons stay clean and match "events through the end of today+30".
 */
export function getSyncWindow(now: Date = new Date()): SyncWindow {
  const todayStart = startOfLocalDay(now);
  const start = addLocalDays(todayStart, -1);
  const end = addLocalDays(todayStart, 31); // exclusive end after the +30th day
  return { start, end };
}

export function shiftAnchor(view: "week" | "month", anchor: Date, direction: -1 | 1): Date {
  if (view === "week") return addLocalDays(startOfLocalDay(anchor), direction * 7);
  const p = zoneParts(anchor);
  // Land on the same day-of-month in the neighbor month (clamp via Date.UTC overflow is fine for anchor).
  const shifted = new Date(Date.UTC(p.year, p.month - 1 + direction, p.day, 12, 0, 0));
  return startOfLocalDay(shifted);
}

/**
 * Prev/next is allowed only when the *entire* neighbor visible range sits
 * inside the sync window [window.start, window.end).
 */
export function canNavigate(
  view: "week" | "month",
  anchor: Date,
  direction: -1 | 1,
  now: Date = new Date()
): boolean {
  const neighborAnchor = shiftAnchor(view, anchor, direction);
  const range = view === "week" ? getWeekRange(neighborAnchor) : getMonthRange(neighborAnchor);
  const window = getSyncWindow(now);
  return range.start.getTime() >= window.start.getTime() && range.end.getTime() <= window.end.getTime();
}

export function periodLabel(view: "week" | "month", anchor: Date): string {
  if (view === "month") {
    return new Intl.DateTimeFormat("he-IL", {
      timeZone: TIMEZONE,
      month: "long",
      year: "numeric",
    }).format(anchor);
  }
  const { start, end } = getWeekRange(anchor);
  const lastDay = addLocalDays(end, -1);
  const fmt = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
  });
  return `${fmt.format(start)} – ${fmt.format(lastDay)}`;
}

/** Sunday-start padded grid of local midnights covering the month of `anchor`. */
export function getMonthGridDays(anchor: Date): Date[] {
  const { start: monthStart, end: monthEnd } = getMonthRange(anchor);
  const gridStart = getWeekRange(monthStart).start;
  // Last day of month is the day before monthEnd; take that day's week end.
  const lastDay = addLocalDays(monthEnd, -1);
  const gridEnd = getWeekRange(lastDay).end;
  const days: Date[] = [];
  for (let d = gridStart; d.getTime() < gridEnd.getTime(); d = addLocalDays(d, 1)) {
    days.push(d);
  }
  return days;
}
```

- [ ] **Step 4: Add npm script and run tests**

In `package.json`, add to `"scripts"`:

```json
"test:calendar-range": "tsx --test src/lib/calendar/range.test.ts"
```

(`tsx` is invoked via `npx` in CI/local if not installed — prefer adding it as a devDependency:)

```bash
cd calendarsync
npm install -D tsx
npm run test:calendar-range
```

Expected: all tests PASS. If the month-navigation assertion in Step 1 disagrees with July's window math, fix the **test expectation** to match the documented rule ("entire neighbor range ⊆ sync window") — do not loosen `canNavigate`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/range.ts src/lib/calendar/range.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(calendar): add Asia/Jerusalem week/month range helpers

Pure date math for grid views and sync-window nav clamping, with node:test coverage.
EOF
)"
```

---

### Task 2: CalendarViewToggle

**Files:**
- Create: `src/components/calendar/CalendarViewToggle.tsx`

**Interfaces:**
- Consumes: `CalendarView`, `canNavigate`, `periodLabel` from `src/lib/calendar/range.ts`
- Produces: `<CalendarViewToggle view anchorDate onViewChange onAnchorChange />`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { ChevronRight, ChevronLeft } from "lucide-react";
import {
  CalendarView,
  canNavigate,
  periodLabel,
  shiftAnchor,
  startOfLocalDay,
} from "@/lib/calendar/range";

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "agenda", label: "רשימה" },
  { id: "week", label: "שבוע" },
  { id: "month", label: "חודש" },
];

export default function CalendarViewToggle({
  view,
  anchorDate,
  onViewChange,
  onAnchorChange,
}: {
  view: CalendarView;
  anchorDate: Date;
  onViewChange: (v: CalendarView) => void;
  onAnchorChange: (d: Date) => void;
}) {
  const showNav = view === "week" || view === "month";
  const canPrev = showNav && canNavigate(view, anchorDate, -1);
  const canNext = showNav && canNavigate(view, anchorDate, 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        className="inline-flex rounded-full p-1"
        style={{ background: "#F1F5F9" }}
        role="tablist"
        aria-label="תצוגת יומן"
      >
        {VIEWS.map(({ id, label }) => {
          const active = view === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(id)}
              className="px-3.5 py-1.5 rounded-full text-sm font-medium transition"
              style={{
                background: active ? "#ffffff" : "transparent",
                color: active ? "#0D1321" : "#5B6477",
                boxShadow: active ? "0 1px 2px rgba(13,19,33,0.06)" : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {showNav && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAnchorChange(startOfLocalDay(new Date()))}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
            style={{ background: "#EFF4FF", color: "#2563EB" }}
          >
            היום
          </button>
          <span className="text-sm font-medium min-w-[9rem] text-center" style={{ color: "#0D1321" }}>
            {periodLabel(view, anchorDate)}
          </span>
          {/* RTL: ChevronRight visually points toward earlier dates (prev) */}
          <button
            type="button"
            aria-label="הקודם"
            disabled={!canPrev}
            onClick={() => canPrev && onAnchorChange(shiftAnchor(view, anchorDate, -1))}
            className="p-1.5 rounded-lg transition disabled:opacity-30"
            style={{ color: "#0D1321" }}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            aria-label="הבא"
            disabled={!canNext}
            onClick={() => canNext && onAnchorChange(shiftAnchor(view, anchorDate, 1))}
            className="p-1.5 rounded-lg transition disabled:opacity-30"
            style={{ color: "#0D1321" }}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck via build (component not wired yet — skip full page verify)**

No standalone compile for one file. Proceed; Task 5 wires it and runs `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/CalendarViewToggle.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): add view toggle with clamped prev/next nav

Segmented רשימה/שבוע/חודש control plus היום button for grid periods.
EOF
)"
```

---

### Task 3: EventDetailModal

**Files:**
- Create: `src/components/calendar/EventDetailModal.tsx`

**Interfaces:**
- Consumes: `EventDoc` from `@/lib/types`
- Produces: `<EventDetailModal event onClose onAddReminder />` — `onAddReminder` mirrors Agenda's callback so the page can open `AddReminderModal`

- [ ] **Step 1: Create the modal**

```tsx
"use client";

import { X, Video, MapPin, BellPlus, Link2 } from "lucide-react";
import { EventDoc } from "@/lib/types";
import { TIMEZONE } from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

function timeRangeLabel(event: EventRow): string {
  if (event.allDay) return "כל היום";
  const fmt = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = fmt.format(event.start.toDate());
  const endTime = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(event.end.toDate());
  return `${start} – ${endTime}`;
}

export default function EventDetailModal({
  event,
  onClose,
  onAddReminder,
}: {
  event: EventRow;
  onClose: () => void;
  onAddReminder?: (event: EventRow) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(13,19,33,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-lg"
        style={{ border: "1px solid #E8EDF5" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0 mt-1.5"
              style={{ background: event.color }}
            />
            <h2 className="text-lg font-semibold leading-snug" style={{ color: "#0D1321" }}>
              {event.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור" className="p-1 shrink-0">
            <X size={18} color="#5B6477" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          <p className="text-sm" style={{ color: "#5B6477" }}>{timeRangeLabel(event)}</p>

          {event.location && (
            <p className="text-sm flex items-center gap-1.5" style={{ color: "#5B6477" }}>
              <MapPin size={14} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </p>
          )}

          {event.joinUrl && (
            <a
              href={event.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
              style={{ background: "#EFF4FF", color: "#2563EB" }}
            >
              <Video size={12} /> הצטרף
              <Link2 size={11} />
            </a>
          )}

          {onAddReminder && (
            <button
              type="button"
              onClick={() => onAddReminder(event)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition hover:opacity-80"
              style={{ background: "#FEF6E7", color: "#92651A" }}
            >
              <BellPlus size={12} /> הוסף לתזכורות
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calendar/EventDetailModal.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): add shared event detail modal for grid views

Shows title, time, location, join link, and reminder CTA matching Agenda.
EOF
)"
```

---

### Task 4: WeekView + MonthView

**Files:**
- Create: `src/components/calendar/WeekView.tsx`
- Create: `src/components/calendar/MonthView.tsx`

**Interfaces:**
- Consumes: `dayKey`, `getWeekRange`, `getMonthGridDays`, `getMonthRange`, `TIMEZONE` from range helpers; `EventDoc`
- Produces: `<WeekView events anchorDate onEventClick />`, `<MonthView events anchorDate onEventClick />`

- [ ] **Step 1: Create WeekView**

```tsx
"use client";

import { EventDoc } from "@/lib/types";
import { TIMEZONE, dayKey, getWeekRange, addLocalDays } from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function weekdayShort(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, weekday: "short" }).format(date);
}

function dayNum(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric" }).format(date);
}

export default function WeekView({
  events,
  anchorDate,
  onEventClick,
}: {
  events: EventRow[];
  anchorDate: Date;
  onEventClick: (event: EventRow) => void;
}) {
  const { start } = getWeekRange(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addLocalDays(start, i));
  const todayKey = dayKey(new Date());

  const byDay = new Map<string, EventRow[]>();
  for (const d of days) byDay.set(dayKey(d), []);
  for (const event of events) {
    const key = dayKey(event.start.toDate());
    if (byDay.has(key)) byDay.get(key)!.push(event);
  }

  return (
    <div
      className="bg-white rounded-2xl overflow-hidden"
      style={{ border: "1px solid #E8EDF5" }}
    >
      {/* direction:ltr → Sunday on the left (Google Calendar-style grids), chip text stays RTL */}
      <div className="grid grid-cols-7 divide-x" style={{ borderColor: "#E8EDF5", direction: "ltr" }}>
        {days.map((d) => {
          const key = dayKey(d);
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div key={key} className="min-h-[12rem] flex flex-col" style={{ borderColor: "#E8EDF5" }}>
              <div
                className="px-2 py-2 text-center"
                style={{ borderBottom: "1px solid #E8EDF5", background: isToday ? "#EFF4FF" : undefined }}
              >
                <div className="text-[11px]" style={{ color: "#5B6477" }}>{weekdayShort(d)}</div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: isToday ? "#2563EB" : "#0D1321" }}
                >
                  {dayNum(d)}
                </div>
              </div>
              <div className="flex-1 p-1 space-y-1 overflow-y-auto max-h-[28rem]">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="w-full text-right rounded-md px-1.5 py-1 text-[11px] leading-snug transition hover:opacity-80"
                    style={{ background: `${event.color}22`, color: "#0D1321" }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle"
                      style={{ background: event.color }}
                    />
                    <span className="font-medium">
                      {event.allDay ? "כל היום" : timeLabel(event.start.toDate())}
                    </span>
                    {" "}
                    <span className="opacity-80">{event.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```


- [ ] **Step 2: Create MonthView**

```tsx
"use client";

import { EventDoc } from "@/lib/types";
import {
  TIMEZONE,
  dayKey,
  getMonthGridDays,
  getMonthRange,
} from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

const MAX_CHIPS = 3;

function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const WEEKDAYS_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]; // Sun→Sat headers

export default function MonthView({
  events,
  anchorDate,
  onEventClick,
}: {
  events: EventRow[];
  anchorDate: Date;
  onEventClick: (event: EventRow) => void;
}) {
  const days = getMonthGridDays(anchorDate);
  const { start: monthStart, end: monthEnd } = getMonthRange(anchorDate);
  const todayKey = dayKey(new Date());
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();

  const byDay = new Map<string, EventRow[]>();
  for (const d of days) byDay.set(dayKey(d), []);
  for (const event of events) {
    const key = dayKey(event.start.toDate());
    if (byDay.has(key)) byDay.get(key)!.push(event);
  }

  return (
    <div
      className="bg-white rounded-2xl overflow-hidden"
      style={{ border: "1px solid #E8EDF5" }}
    >
      <div
        className="grid grid-cols-7"
        style={{ borderBottom: "1px solid #E8EDF5", direction: "ltr" }}
      >
        {WEEKDAYS_HE.map((label) => (
          <div
            key={label}
            className="px-1 py-2 text-center text-[11px] font-medium"
            style={{ color: "#5B6477" }}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr" style={{ direction: "ltr" }}>
        {days.map((d) => {
          const key = dayKey(d);
          const inMonth = d.getTime() >= monthStartMs && d.getTime() < monthEndMs;
          const dayEvents = byDay.get(key) ?? [];
          const overflow = Math.max(0, dayEvents.length - MAX_CHIPS);
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className="min-h-[5.5rem] p-1"
              style={{
                borderTop: "1px solid #E8EDF5",
                borderLeft: "1px solid #E8EDF5",
                background: isToday ? "#F8FAFF" : undefined,
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div
                className="text-[11px] font-semibold mb-0.5 px-0.5"
                style={{ color: isToday ? "#2563EB" : "#0D1321" }}
              >
                {new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric" }).format(d)}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="w-full text-right truncate rounded px-1 py-0.5 text-[10px] leading-tight transition hover:opacity-80"
                    style={{ background: `${event.color}22`, color: "#0D1321" }}
                    title={event.title}
                  >
                    {!event.allDay && (
                      <span className="opacity-70">{timeLabel(event.start.toDate())} </span>
                    )}
                    {event.title}
                  </button>
                ))}
                {overflow > 0 && (
                  <div className="text-[10px] px-1" style={{ color: "#5B6477" }}>
                    +{overflow} עוד
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/WeekView.tsx src/components/calendar/MonthView.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): add WeekView and MonthView grid components

Color-coded event chips with click handlers; month cells cap at 3 with +N overflow.
EOF
)"
```

---

### Task 5: Wire CalendarPage (view state, dual query, compose)

**Files:**
- Modify: `app/(app)/calendar/page.tsx` (replace contents)

**Interfaces:**
- Consumes: all new components + `getVisibleRange`, `CalendarView`, `startOfLocalDay` from range helpers
- Produces: working page with Agenda default, Week/Month queries bounded to visible range

- [ ] **Step 1: Replace `app/(app)/calendar/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { EventDoc } from "@/lib/types";
import AgendaView from "@/components/calendar/AgendaView";
import WeekView from "@/components/calendar/WeekView";
import MonthView from "@/components/calendar/MonthView";
import CalendarViewToggle from "@/components/calendar/CalendarViewToggle";
import EventDetailModal from "@/components/calendar/EventDetailModal";
import AddReminderModal from "@/components/reminders/AddReminderModal";
import {
  CalendarView,
  getVisibleRange,
  startOfLocalDay,
} from "@/lib/calendar/range";

type EventRow = EventDoc & { id: string };

export default function CalendarPage() {
  const { user } = useAuth();
  const [view, setView] = useState<CalendarView>("agenda");
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminderEvent, setReminderEvent] = useState<EventRow | null>(null);
  const [detailEvent, setDetailEvent] = useState<EventRow | null>(null);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    setError(null);

    (async () => {
      const [{ db }, { collection, query, where, orderBy, onSnapshot, Timestamp }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);

      const range = getVisibleRange(view, anchorDate);
      const constraints = range
        ? [
            where("uid", "==", user.uid),
            where("start", ">=", Timestamp.fromDate(range.start)),
            where("start", "<", Timestamp.fromDate(range.end)),
            orderBy("start", "asc"),
          ]
        : [
            // Agenda: unchanged — from local start-of-today, unbounded upper end
            where("uid", "==", user.uid),
            where("start", ">=", Timestamp.fromDate(startOfLocalDay(new Date()))),
            orderBy("start", "asc"),
          ];

      const q = query(collection(db, "events"), ...constraints);
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setEvents(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as EventDoc) }))
              .filter((e) => e.status === "confirmed")
          );
          setLoading(false);
        },
        (err) => {
          console.error("events onSnapshot error:", err);
          setError(`שגיאה בטעינת היומן: ${err.message}`);
          setLoading(false);
        }
      );
    })();

    return () => unsubscribe?.();
  }, [user, view, anchorDate]);

  const openReminder = (event: EventRow) => {
    setDetailEvent(null);
    setReminderEvent(event);
  };

  const wide = view !== "agenda";

  return (
    <div className={`space-y-5 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>יומן</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>
          כל הפגישות מכל החשבונות המחוברים, במקום אחד
        </p>
      </div>

      <CalendarViewToggle
        view={view}
        anchorDate={anchorDate}
        onViewChange={setView}
        onAnchorChange={setAnchorDate}
      />

      {error ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FEF2F2", color: "#EF4444" }}>
          {error}
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
          ))}
        </div>
      ) : view === "agenda" ? (
        <AgendaView events={events} onAddReminder={openReminder} />
      ) : view === "week" ? (
        <WeekView events={events} anchorDate={anchorDate} onEventClick={setDetailEvent} />
      ) : (
        <MonthView events={events} anchorDate={anchorDate} onEventClick={setDetailEvent} />
      )}

      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onAddReminder={openReminder}
        />
      )}

      {reminderEvent && (
        <AddReminderModal
          onClose={() => setReminderEvent(null)}
          prefill={{
            title: reminderEvent.title,
            dueAt: reminderEvent.start.toDate(),
            source: {
              type: "event",
              eventId: reminderEvent.id,
              label: reminderEvent.title,
              link: reminderEvent.joinUrl,
            },
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + lint**

```bash
cd calendarsync
npm run lint
npm run build
```

Expected: both exit 0. Fix any TypeScript/ESLint errors before committing.

- [ ] **Step 3: Manual verification checklist**

With `npm run dev` and a logged-in account that has synced events:

1. Calendar loads on **רשימה** (Agenda); events look identical to before.
2. Switch to **שבוע** — today's events appear in the correct Sunday–Saturday column; period label shows.
3. Switch to **חודש** — chips render; days with >3 events show `+N עוד`.
4. Prev/next: arrows disable at the yesterday / +30d edges (try hammering prev from current week — should stop; try next into a month past the window — disabled).
5. **היום** resets to the current week/month.
6. Click an event in Week → detail modal → **הוסף לתזכורות** opens `AddReminderModal` prefilled.
7. Same click path from Month.
8. Agenda row **תזכורת** still works.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/calendar/page.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): wire week/month grids into Calendar page

View toggle, bounded Firestore queries, shared detail modal, Agenda unchanged as default.
EOF
)"
```

---

### Task 6: Final polish + regression pass

**Files:**
- Modify only if Step 1 finds gaps (likely small CSS/RTL tweaks in WeekView/MonthView/Toggle)

- [ ] **Step 1: Re-run automated gates**

```bash
npm run test:calendar-range
npm run lint
npm run build
```

Expected: all green.

- [ ] **Step 2: Spec coverage spot-check**

Confirm against `docs/superpowers/specs/2026-07-25-calendar-grid-views-design.md`:

| Spec requirement | Task |
|------------------|------|
| Default Agenda | Task 5 (`useState("agenda")`) |
| Week + Month toggle | Tasks 2 + 5 |
| Prev/next navigation | Tasks 1 + 2 |
| Clamp to sync window | Task 1 `canNavigate` + Task 2 disabled arrows |
| Event click → shared modal + reminder | Tasks 3 + 5 |
| Hand-built, no calendar library | all tasks |
| Reuse `(uid, start)` index | Task 5 query shape |
| No backend window change | none touch `functions/src/calendar/sync.ts` |

- [ ] **Step 3: Commit only if polish edits were made**

```bash
git add -A
git status   # review — do not include unrelated files
git commit -m "$(cat <<'EOF'
fix(calendar): polish grid view layout after QA
EOF
)"
```

If nothing changed, skip the commit.

---

## Self-Review

**1. Spec coverage:** All six confirmed requirements + verification plan map to tasks above. Out-of-scope items (extend sync window, DnD, day view) have no tasks.

**2. Placeholder scan:** No TBD/TODO/`require()` hacks. `addLocalDays` is exported in Task 1 and imported cleanly by WeekView in Task 4.

**3. Type consistency:** `CalendarView`, `EventRow`, `onAddReminder` / `onEventClick` signatures are consistent across Toggle → Page → Week/Month → DetailModal → AddReminderModal prefill.
