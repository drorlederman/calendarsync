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
