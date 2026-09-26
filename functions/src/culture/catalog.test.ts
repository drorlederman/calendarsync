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
