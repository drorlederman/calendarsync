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
