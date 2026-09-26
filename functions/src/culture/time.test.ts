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
