import { test } from "node:test";
import assert from "node:assert/strict";
import { cultureRecipients, isValidPhone } from "./recipients";

test("main phone only when no extra phone", () => {
  assert.deepEqual(cultureRecipients("0501234567", ""), ["0501234567"]);
});

test("adds the extra phone", () => {
  assert.deepEqual(cultureRecipients("0501234567", "052-7654321"), ["0501234567", "052-7654321"]);
});

test("drops an extra phone that is the same number in another format", () => {
  assert.deepEqual(cultureRecipients("0501234567", "+972 50-123-4567"), ["0501234567"]);
});

test("drops an invalid extra phone", () => {
  assert.deepEqual(cultureRecipients("0501234567", "123"), ["0501234567"]);
});

test("isValidPhone requires at least 9 digits", () => {
  assert.equal(isValidPhone("050-1234567"), true);
  assert.equal(isValidPhone("+972501234567"), true);
  assert.equal(isValidPhone("12345"), false);
  assert.equal(isValidPhone(""), false);
});
