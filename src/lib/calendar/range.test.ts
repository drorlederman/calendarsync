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
    // Next week from Jul 8 anchor is Jul 12–19; start Jul 12 is also before window.
    assert.equal(canNavigate("week", early, 1, NOW), false);
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
