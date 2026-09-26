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
