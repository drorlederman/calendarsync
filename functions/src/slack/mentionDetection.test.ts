import { test } from "node:test";
import assert from "node:assert/strict";
import { isMention, isDirectMessage } from "./mentionDetection";

test("isMention detects a Slack-style @mention token", () => {
  assert.equal(isMention("hey <@U12345> can you check this?", "U12345"), true);
});

test("isMention is false when a different user is mentioned", () => {
  assert.equal(isMention("hey <@U99999> can you check this?", "U12345"), false);
});

test("isMention is false with no mention at all", () => {
  assert.equal(isMention("just a regular message", "U12345"), false);
});

test("isDirectMessage is true for channel_type 'im'", () => {
  assert.equal(isDirectMessage("im"), true);
});

test("isDirectMessage is false for public/private channels and group DMs", () => {
  assert.equal(isDirectMessage("channel"), false);
  assert.equal(isDirectMessage("group"), false);
  assert.equal(isDirectMessage("mpim"), false);
});
