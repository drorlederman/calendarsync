import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "./signature";

const SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5a";
const TIMESTAMP = "1531420618";
const RAW_BODY = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&api_app_id=A0XZUY6&event=hello";

function validSignature(): string {
  const base = `v0:${TIMESTAMP}:${RAW_BODY}`;
  return "v0=" + createHmac("sha256", SIGNING_SECRET).update(base).digest("hex");
}

test("accepts a correctly computed signature within the time window", () => {
  const sig = validSignature();
  const nowSeconds = parseInt(TIMESTAMP, 10) + 10;
  assert.equal(verifySlackSignature(SIGNING_SECRET, TIMESTAMP, RAW_BODY, sig, nowSeconds), true);
});

test("rejects a tampered signature", () => {
  const sig = validSignature().replace(/.$/, "0");
  const nowSeconds = parseInt(TIMESTAMP, 10) + 10;
  assert.equal(verifySlackSignature(SIGNING_SECRET, TIMESTAMP, RAW_BODY, sig, nowSeconds), false);
});

test("rejects a tampered body", () => {
  const sig = validSignature();
  const nowSeconds = parseInt(TIMESTAMP, 10) + 10;
  assert.equal(verifySlackSignature(SIGNING_SECRET, TIMESTAMP, RAW_BODY + "tampered", sig, nowSeconds), false);
});

test("rejects a signature older than 5 minutes (replay protection)", () => {
  const sig = validSignature();
  const nowSeconds = parseInt(TIMESTAMP, 10) + 60 * 6;
  assert.equal(verifySlackSignature(SIGNING_SECRET, TIMESTAMP, RAW_BODY, sig, nowSeconds), false);
});
