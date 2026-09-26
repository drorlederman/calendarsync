import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateCompletionCode,
  parseCompletionReply,
  phonesMatch,
  normalizePhoneDigits,
  COMPLETION_CODE_LENGTH,
} from "./completionCode";

test("generateCompletionCode returns fixed-length alphanumeric codes", () => {
  const code = generateCompletionCode(() => 0);
  assert.equal(code.length, COMPLETION_CODE_LENGTH);
  assert.match(code, /^[A-Z2-9]+$/);
});

test("parseCompletionReply extracts code when present", () => {
  assert.deepEqual(parseCompletionReply("בוצע AB12"), { kind: "code", code: "AB12" });
  assert.deepEqual(parseCompletionReply("סיום xy34"), { kind: "code", code: "XY34" });
  assert.deepEqual(parseCompletionReply("סיימתי: K9M2"), { kind: "code", code: "K9M2" });
  assert.deepEqual(parseCompletionReply("done ab12"), { kind: "code", code: "AB12" });
  assert.deepEqual(parseCompletionReply("Done-AB12"), { kind: "code", code: "AB12" });
});

test("parseCompletionReply recognizes a bare done keyword", () => {
  assert.deepEqual(parseCompletionReply("בוצע"), { kind: "bare" });
  assert.deepEqual(parseCompletionReply("בוצעה"), { kind: "bare" });
  assert.deepEqual(parseCompletionReply("done"), { kind: "bare" });
  assert.deepEqual(parseCompletionReply("בוצע!"), { kind: "bare" });
});

test("parseCompletionReply rejects unrelated text", () => {
  assert.equal(parseCompletionReply("שלום"), null);
  assert.equal(parseCompletionReply("AB12"), null);
  assert.equal(parseCompletionReply("בוצע ABCDE"), null);
  assert.equal(parseCompletionReply("תודה רבה"), null);
});

test("phonesMatch normalizes Israeli leading-zero and chatId formats", () => {
  assert.equal(normalizePhoneDigits("0501234567"), "972501234567");
  assert.equal(normalizePhoneDigits("972501234567@c.us"), "972501234567");
  assert.equal(phonesMatch("0501234567", "972501234567@c.us"), true);
  assert.equal(phonesMatch("0501234567", "972509999999"), false);
});
