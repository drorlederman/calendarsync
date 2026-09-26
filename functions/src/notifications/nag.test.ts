import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nagClockParts,
  nagStartDateStr,
  shouldFireNag,
  pruneNagKeys,
  nagDedupKey,
} from "./nag";

const TZ = "Asia/Jerusalem";

function ts(iso: string) {
  const d = new Date(iso);
  return { toMillis: () => d.getTime(), toDate: () => d };
}

test("nagClockParts prefers remindAt over dueAt", () => {
  const clock = nagClockParts({
    remindAt: ts("2026-07-20T07:30:00+03:00"),
    dueAt: ts("2026-07-25T18:00:00+03:00"),
  }, TZ);
  assert.equal(clock.source, "remindAt");
  assert.equal(clock.hour, 7);
  assert.equal(clock.minute, 30);
});

test("nagClockParts falls back to dueAt then 09:00", () => {
  const fromDue = nagClockParts({ dueAt: ts("2026-07-25T18:15:00+03:00") }, TZ);
  assert.equal(fromDue.source, "dueAt");
  assert.equal(fromDue.hour, 18);
  assert.equal(fromDue.minute, 15);

  const def = nagClockParts({}, TZ);
  assert.equal(def.source, "default");
  assert.equal(def.hour, 9);
  assert.equal(def.minute, 0);
});

test("nagStartDateStr is the day after remindAt/dueAt", () => {
  assert.equal(
    nagStartDateStr({ remindAt: ts("2026-07-20T07:30:00+03:00") }, TZ, "2026-07-25"),
    "2026-07-21",
  );
});

test("shouldFireNag fires once in the 5-minute window after start date", () => {
  const reminder = {
    nagEnabled: true,
    status: "open",
    remindAt: ts("2026-07-20T07:30:00+03:00"),
  };
  // Day after remindAt, inside the 07:30 window
  const hit = shouldFireNag({
    reminderId: "r1",
    reminder,
    now: new Date("2026-07-21T07:32:00+03:00"),
    timeZone: TZ,
  });
  assert.equal(hit.fire, true);
  assert.equal(hit.key, nagDedupKey("r1", "2026-07-21"));

  // Same clock on the remindAt day itself — one-shots cover it, no nag
  const sameDay = shouldFireNag({
    reminderId: "r1",
    reminder,
    now: new Date("2026-07-20T07:32:00+03:00"),
    timeZone: TZ,
  });
  assert.equal(sameDay.fire, false);

  // Outside the window
  const miss = shouldFireNag({
    reminderId: "r1",
    reminder,
    now: new Date("2026-07-21T08:00:00+03:00"),
    timeZone: TZ,
  });
  assert.equal(miss.fire, false);
});

test("shouldFireNag respects nagEnabled and status", () => {
  const base = { remindAt: ts("2026-07-20T07:30:00+03:00") };
  const now = new Date("2026-07-21T07:32:00+03:00");
  assert.equal(shouldFireNag({
    reminderId: "r1", reminder: { ...base, nagEnabled: false, status: "open" }, now, timeZone: TZ,
  }).fire, false);
  assert.equal(shouldFireNag({
    reminderId: "r1", reminder: { ...base, nagEnabled: true, status: "done" }, now, timeZone: TZ,
  }).fire, false);
});

test("pruneNagKeys keeps last 7 days of nag keys and all non-nag keys", () => {
  const pruned = pruneNagKeys({
    "lead_1": true,
    "nag_r1_2026-07-10": true,
    "nag_r1_2026-07-20": true,
    "nag_r1_2026-07-25": true,
  }, "2026-07-25", 7);
  assert.equal(pruned["lead_1"], true);
  assert.equal(pruned["nag_r1_2026-07-25"], true);
  assert.equal(pruned["nag_r1_2026-07-20"], true);
  assert.equal(pruned["nag_r1_2026-07-10"], undefined);
});
