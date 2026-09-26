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
