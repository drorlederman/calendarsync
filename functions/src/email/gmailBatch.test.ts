import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGmailMetadataBatchBody,
  parseGmailBatchResponse,
  normalizeGmailMetadataMessage,
  extractBatchBoundary,
} from "./gmailBatch";

test("extractBatchBoundary reads boundary from Content-Type", () => {
  assert.equal(
    extractBatchBoundary('multipart/mixed; boundary="batch_abc"'),
    "batch_abc",
  );
  assert.equal(
    extractBatchBoundary("multipart/mixed; boundary=batch_xyz"),
    "batch_xyz",
  );
  assert.equal(extractBatchBoundary("application/json"), null);
});

test("buildGmailMetadataBatchBody emits one GET part per id", () => {
  const body = buildGmailMetadataBatchBody(["m1", "m2"], "batch_test");
  assert.match(body, /--batch_test\r?\n/);
  assert.match(body, /GET \/gmail\/v1\/users\/me\/messages\/m1\?/);
  assert.match(body, /GET \/gmail\/v1\/users\/me\/messages\/m2\?/);
  assert.match(body, /format=metadata/);
  assert.match(body, /metadataHeaders=From/);
  assert.match(body, /metadataHeaders=Subject/);
  assert.match(body, /--batch_test--/);
});

test("parseGmailBatchResponse maps Content-ID / path id to JSON bodies", () => {
  const boundary = "batch_boundary";
  const raw = [
    `--${boundary}`,
    "Content-Type: application/http",
    "Content-ID: response-m1",
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({
      id: "m1",
      snippet: "hello",
      internalDate: "1720000000000",
      labelIds: ["INBOX", "UNREAD"],
      payload: { headers: [{ name: "From", value: "A <a@x.com>" }, { name: "Subject", value: "Hi" }] },
    }),
    `--${boundary}`,
    "Content-Type: application/http",
    "Content-ID: response-m2",
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({
      id: "m2",
      snippet: "bye",
      internalDate: "1720000001000",
      labelIds: ["INBOX"],
      payload: { headers: [{ name: "From", value: "B" }, { name: "Subject", value: "Yo" }] },
    }),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const map = parseGmailBatchResponse(raw, boundary);
  assert.equal(map.size, 2);
  assert.equal((map.get("m1") as { snippet: string }).snippet, "hello");
  assert.equal((map.get("m2") as { id: string }).id, "m2");
});

test("parseGmailBatchResponse skips non-200 parts", () => {
  const boundary = "b";
  const raw = [
    `--${boundary}`,
    "Content-Type: application/http",
    "",
    "HTTP/1.1 404 Not Found",
    "Content-Type: application/json",
    "",
    '{"error":{"code":404}}',
    `--${boundary}`,
    "Content-Type: application/http",
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: application/json",
    "",
    '{"id":"ok1","snippet":"x","internalDate":"1","labelIds":["INBOX"],"payload":{"headers":[]}}',
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const map = parseGmailBatchResponse(raw, boundary);
  assert.equal(map.size, 1);
  assert.ok(map.has("ok1"));
});

test("parseGmailBatchResponse falls back to Content-ID when JSON has no id", () => {
  const boundary = "batch_noid";
  const cases: Array<{ contentId: string; expectedKey: string }> = [
    { contentId: "response-item0+m1", expectedKey: "m1" },
    { contentId: "<item0+m1>", expectedKey: "m1" },
  ];

  for (const { contentId, expectedKey } of cases) {
    const raw = [
      `--${boundary}`,
      "Content-Type: application/http",
      `Content-ID: ${contentId}`,
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({
        snippet: "no-id-body",
        internalDate: "1720000000000",
        labelIds: ["INBOX"],
        payload: { headers: [] },
      }),
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const map = parseGmailBatchResponse(raw, boundary);
    assert.equal(map.size, 1);
    assert.ok(map.has(expectedKey));
    assert.equal((map.get(expectedKey) as { snippet: string }).snippet, "no-id-body");
  }
});

test("normalizeGmailMetadataMessage maps headers and unread", () => {
  const msg = normalizeGmailMetadataMessage("abc", {
    id: "abc",
    snippet: "snip",
    internalDate: "1720000000000",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      headers: [
        { name: "From", value: "Dan <dan@ex.com>" },
        { name: "Subject", value: "Meeting" },
      ],
    },
  });
  assert.equal(msg.id, "abc");
  assert.equal(msg.from, "Dan <dan@ex.com>");
  assert.equal(msg.subject, "Meeting");
  assert.equal(msg.snippet, "snip");
  assert.equal(msg.isRead, false);
  assert.equal(msg.date, new Date(1720000000000).toISOString());
});

test("normalizeGmailMetadataMessage defaults missing subject and read state", () => {
  const msg = normalizeGmailMetadataMessage("x", {
    id: "x",
    labelIds: ["INBOX"],
    payload: { headers: [] },
  });
  assert.equal(msg.subject, "(ללא נושא)");
  assert.equal(msg.isRead, true);
  assert.equal(msg.from, "");
  assert.equal(msg.snippet, "");
});
