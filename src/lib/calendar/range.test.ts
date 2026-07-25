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
  isDayInSyncWindow,
  syncWindowLabel,
} from "./range";

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

  it("startOfLocalDay is correct on spring-forward DST transition day", () => {
    // Israel spring forward 2026-03-27 (02:00 → 03:00). Noon local ≈ 10:00 UTC (IST, UTC+2).
    const start = startOfLocalDay(new Date("2026-03-27T10:00:00.000Z"));
    assert.equal(dayKey(start), "2026-03-27");
    assert.equal(start.toISOString(), "2026-03-26T22:00:00.000Z"); // midnight still IST (UTC+2)
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

  it("shiftAnchor month clamps to last day of short months", () => {
    const jan31 = startOfLocalDay(new Date("2026-01-31T10:00:00.000Z"));
    assert.equal(dayKey(jan31), "2026-01-31");
    const feb = shiftAnchor("month", jan31, 1);
    assert.equal(dayKey(feb), "2026-02-28"); // 2026 is not a leap year
    const backToJan = shiftAnchor("month", feb, -1);
    assert.equal(dayKey(backToJan), "2026-01-28"); // clamped anchor lands on Jan 28, not Jan 31
  });

  // Sync window for NOW is [2026-07-14, 2026-08-15). canNavigate uses *overlap*:
  // the neighbor range only has to intersect the window, not sit inside it.
  it("canNavigate week allows a neighbor that partially overlaps the window", () => {
    const early = startOfLocalDay(new Date("2026-07-08T09:00:00.000Z"));
    // Next week from Jul 8 is [Jul 12, Jul 19) — starts before the window but
    // overlaps Jul 14–18, so navigation is allowed.
    assert.equal(canNavigate("week", early, 1, NOW), true);
    // Prev week is [Jun 28, Jul 5) — entirely before the window → blocked.
    assert.equal(canNavigate("week", early, -1, NOW), false);
  });

  it("canNavigate week blocks a neighbor entirely past the window end", () => {
    // Window ends 2026-08-15 (exclusive). Week [Aug 9, Aug 16) still overlaps.
    const aug12 = startOfLocalDay(new Date("2026-08-12T09:00:00.000Z"));
    assert.equal(canNavigate("week", aug12, -1, NOW), true); // [Aug 2, Aug 9)
    // Next week [Aug 16, Aug 23) starts at/after window end → blocked.
    assert.equal(canNavigate("week", aug12, 1, NOW), false);
  });

  it("canNavigate week still allows fully contained neighbors", () => {
    const mid = startOfLocalDay(new Date("2026-07-28T09:00:00.000Z"));
    assert.equal(canNavigate("week", mid, -1, NOW), true);
    assert.equal(canNavigate("week", mid, 1, NOW), true);
  });

  it("canNavigate month allows next month because August overlaps the window", () => {
    // August is [Aug 1, Sep 1); the window covers Aug 1–14, so overlap → allowed.
    // Under the old containment rule this was false, which made month arrows
    // permanently disabled (a 31-day window can never contain a full month).
    assert.equal(canNavigate("month", NOW, 1, NOW), true);
    // June is [Jun 1, Jul 1) — ends before the window starts → blocked.
    assert.equal(canNavigate("month", NOW, -1, NOW), false);
  });

  it("canNavigate month stops one month past the window", () => {
    const aug = startOfLocalDay(new Date("2026-08-15T09:00:00.000Z"));
    // Back to July: [Jul 1, Aug 1) overlaps Jul 14–31 → allowed.
    assert.equal(canNavigate("month", aug, -1, NOW), true);
    // Forward to September: [Sep 1, Oct 1) starts after window end → blocked.
    assert.equal(canNavigate("month", aug, 1, NOW), false);
  });
});

describe("isDayInSyncWindow", () => {
  const day = (iso: string) => startOfLocalDay(new Date(iso));

  it("marks days inside [yesterday, today+30] as cached", () => {
    assert.equal(isDayInSyncWindow(day("2026-07-14T09:00:00.000Z"), NOW), true); // window start
    assert.equal(isDayInSyncWindow(day("2026-07-15T09:00:00.000Z"), NOW), true); // today
    assert.equal(isDayInSyncWindow(day("2026-08-14T09:00:00.000Z"), NOW), true); // last covered day
  });

  it("marks days outside the window as uncached", () => {
    assert.equal(isDayInSyncWindow(day("2026-07-13T09:00:00.000Z"), NOW), false);
    assert.equal(isDayInSyncWindow(day("2026-08-15T09:00:00.000Z"), NOW), false); // exclusive end
    assert.equal(isDayInSyncWindow(day("2026-09-01T09:00:00.000Z"), NOW), false);
  });

  it("accepts any instant within the day, not just local midnight", () => {
    // 2026-08-14 22:00 UTC is still 2026-08-15 01:00 Jerusalem → outside.
    assert.equal(isDayInSyncWindow(new Date("2026-08-14T22:00:00.000Z"), NOW), false);
    assert.equal(isDayInSyncWindow(new Date("2026-08-14T12:00:00.000Z"), NOW), true);
  });
});

describe("syncWindowLabel", () => {
  it("describes the cached window in Hebrew", () => {
    const label = syncWindowLabel(NOW);
    assert.match(label, /יולי/);
    assert.match(label, /אוגוסט/);
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
