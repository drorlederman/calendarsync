# Inbox Speed + Email Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speed up Gmail inbox listing via batch metadata fetches + parallel accounts, and let users create an email-linked reminder from the inbox list without opening the message.

**Architecture:** Extract pure Gmail batch request/response helpers into `functions/src/email/gmailBatch.ts` (unit-tested). Wire them into `fetchGmailMessages` and run per-account fetches with `Promise.all`. On the client, add a stopPropagation bell on each `MessageList` row that opens the existing `AddReminderModal` with the same email `prefill` already used in `MessageDetail`.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript), Gmail batch HTTP API (`googleapis`/axios), Next.js client components, Node `node:test` for pure logic.

## Global Constraints

- Callable contract unchanged: `listInboxMessagesCallable({ pageTokens? })` → `{ results: Record<accountId, { items, nextPageToken?, accountColor, error? }> }`.
- `NormalizedMessage` shape unchanged: `{ id, from, subject, snippet, date, isRead }`.
- Reminder prefill for email: `{ title: subject, source: { type: "email", accountId, messageId, label: subject || "מייל" } }`.
- Keep existing "הוסף לתזכורות" button inside `MessageDetail`.
- No Firestore inbox cache in this plan.
- **Test strategy:** pure batch parse/build logic → `node:test` after `tsc`. Gmail live fetch + UI → deploy and manual verify (project's established pattern).
- Do not change Microsoft Graph fetch path beyond parallelizing the account loop.

## File map

| File | Responsibility |
|------|----------------|
| `functions/src/email/gmailBatch.ts` | Build multipart batch body; parse multipart response into per-id JSON; map Gmail metadata JSON → `NormalizedMessage` |
| `functions/src/email/gmailBatch.test.ts` | Unit tests for build/parse/map |
| `functions/src/email/inbox.ts` | Use batch helper in `fetchGmailMessages`; `Promise.all` over accounts |
| `src/components/inbox/MessageList.tsx` | Row bell button; `onAddReminder` callback |
| `app/(app)/inbox/page.tsx` | Hold reminder prefill state; render `AddReminderModal` |

---

### Task 1: Gmail batch pure helpers + unit tests

**Files:**
- Create: `functions/src/email/gmailBatch.ts`
- Create: `functions/src/email/gmailBatch.test.ts`

**Interfaces:**
- Produces:
  - `buildGmailMetadataBatchBody(messageIds: string[], boundary: string): string`
  - `parseGmailBatchResponse(rawBody: string, boundary: string): Map<string, unknown>`
  - `normalizeGmailMetadataMessage(id: string, data: GmailMetadataPayload): NormalizedMessageLike`
  - `extractBatchBoundary(contentType: string | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/email/gmailBatch.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd functions
npm run build
node --test lib/email/gmailBatch.test.js
```

Expected: FAIL — `Cannot find module './gmailBatch'` / module missing (or tsc fails because import target missing).

- [ ] **Step 3: Implement `gmailBatch.ts`**

Create `functions/src/email/gmailBatch.ts`:

```ts
export interface NormalizedMessageLike {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isRead: boolean;
}

export interface GmailMetadataPayload {
  id?: string | null;
  snippet?: string | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }> | null;
  } | null;
}

export function extractBatchBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1] : null;
}

export function buildGmailMetadataBatchBody(messageIds: string[], boundary: string): string {
  const parts = messageIds.map((id, i) => {
    const path =
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}` +
      `?format=metadata&metadataHeaders=From&metadataHeaders=Subject`;
    return [
      `--${boundary}`,
      "Content-Type: application/http",
      `Content-ID: <item${i}+${id}>`,
      "",
      `GET ${path}`,
      "",
    ].join("\r\n");
  });
  return parts.join("") + `--${boundary}--\r\n`;
}

/**
 * Parse a Gmail batch multipart body into a map keyed by message id.
 * Prefers JSON `id` field; falls back to Content-ID suffix after `+` or `response-`.
 */
export function parseGmailBatchResponse(rawBody: string, boundary: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const delim = `--${boundary}`;
  const chunks = rawBody.split(delim).slice(1); // drop preamble

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "--" || trimmed.startsWith("--")) continue;

    const headerEnd = trimmed.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const partHeaders = trimmed.slice(0, headerEnd);
    const afterHeaders = trimmed.slice(headerEnd).replace(/^\r?\n\r?\n/, "");

    // application/http: status line + headers + body
    const httpMatch = afterHeaders.match(/^HTTP\/\d\.\d\s+(\d+)[^\r\n]*\r?\n([\s\S]*)$/i);
    if (!httpMatch) continue;
    const status = parseInt(httpMatch[1], 10);
    if (status < 200 || status >= 300) continue;

    const httpRest = httpMatch[2];
    const bodySep = httpRest.search(/\r?\n\r?\n/);
    if (bodySep < 0) continue;
    const jsonText = httpRest.slice(bodySep).replace(/^\r?\n\r?\n/, "").trim();
    if (!jsonText) continue;

    let data: unknown;
    try {
      data = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const idFromJson =
      data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string"
        ? (data as { id: string }).id
        : null;

    const contentId = partHeaders.match(/Content-ID:\s*<?([^>\r\n]+)>?/i)?.[1] ?? "";
    const idFromHeader =
      contentId.includes("+")
        ? contentId.slice(contentId.lastIndexOf("+") + 1)
        : contentId.replace(/^response-/i, "") || null;

    const id = idFromJson ?? idFromHeader;
    if (!id) continue;
    out.set(id, data);
  }

  return out;
}

export function normalizeGmailMetadataMessage(
  id: string,
  data: GmailMetadataPayload,
): NormalizedMessageLike {
  const headers = data.payload?.headers ?? [];
  const from = headers.find((h) => h.name === "From")?.value ?? "";
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "(ללא נושא)";
  return {
    id,
    from,
    subject,
    snippet: data.snippet ?? "",
    date: data.internalDate
      ? new Date(parseInt(data.internalDate, 10)).toISOString()
      : new Date().toISOString(),
    isRead: !(data.labelIds ?? []).includes("UNREAD"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd functions
npm run build
node --test lib/email/gmailBatch.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/email/gmailBatch.ts functions/src/email/gmailBatch.test.ts
git commit -m "feat(inbox): add Gmail batch parse helpers with tests"
```

---

### Task 2: Wire batch fetch + parallel accounts in callable

**Files:**
- Modify: `functions/src/email/inbox.ts`

**Interfaces:**
- Consumes: `buildGmailMetadataBatchBody`, `parseGmailBatchResponse`, `normalizeGmailMetadataMessage`, `extractBatchBoundary` from `./gmailBatch`
- Produces: same `listInboxMessagesCallable` / `NormalizedMessage` behavior, faster

- [ ] **Step 1: Replace sequential Gmail gets with batch HTTP**

In `functions/src/email/inbox.ts`, add imports:

```ts
import axios from "axios";
import {
  buildGmailMetadataBatchBody,
  extractBatchBoundary,
  normalizeGmailMetadataMessage,
  parseGmailBatchResponse,
  type GmailMetadataPayload,
} from "./gmailBatch";
```

(`axios` is already imported in this file — keep a single import.)

Replace `fetchGmailMessages` body after the list call with:

```ts
async function fetchGmailMessages(
  accessToken: string, pageToken?: string
): Promise<{ items: NormalizedMessage[]; nextPageToken?: string }> {
  const gmail = gmailClient(accessToken);
  const listResp = await gmail.users.messages.list({
    userId: "me", labelIds: ["INBOX"], maxResults: 20, pageToken,
  });
  const ids = (listResp.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    return { items: [], nextPageToken: listResp.data.nextPageToken ?? undefined };
  }

  const boundary = `batch_${Date.now()}`;
  const body = buildGmailMetadataBatchBody(ids, boundary);
  const batchResp = await axios.post(
    "https://www.googleapis.com/batch/gmail/v1",
    body,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/mixed; boundary=${boundary}`,
      },
      // Gmail returns multipart text; do not force JSON parse
      responseType: "text",
      transformResponse: [(data) => data],
    },
  );

  const respBoundary =
    extractBatchBoundary(String(batchResp.headers["content-type"] ?? "")) ?? boundary;
  const byId = parseGmailBatchResponse(String(batchResp.data), respBoundary);

  const items: NormalizedMessage[] = [];
  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw || typeof raw !== "object") continue;
    items.push(normalizeGmailMetadataMessage(id, raw as GmailMetadataPayload));
  }

  return { items, nextPageToken: listResp.data.nextPageToken ?? undefined };
}
```

Remove the old per-id `gmail.users.messages.get` loop entirely.

- [ ] **Step 2: Parallelize account fetches in the callable**

Replace the sequential `for (const doc of accountsSnap.docs) { ... }` block with:

```ts
    await Promise.all(accountsSnap.docs.map(async (doc) => {
      const accountId = doc.id;
      const account = doc.data() as ConnectedAccountDoc;
      try {
        const accessToken = await getValidAccessToken(accountId);
        const result = account.provider === "google"
          ? await fetchGmailMessages(accessToken, pageTokens[accountId])
          : await fetchGraphMessages(accessToken, pageTokens[accountId]);
        results[accountId] = { ...result, accountColor: account.displayColor };
      } catch (err) {
        results[accountId] = {
          items: [],
          accountColor: account.displayColor,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));
```

Keep `results` declared as before; assign into it from each parallel task.

- [ ] **Step 3: Build TypeScript**

```bash
cd functions
npm run build
```

Expected: exit 0, no type errors.

- [ ] **Step 4: Re-run unit tests**

```bash
node --test lib/email/gmailBatch.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/email/inbox.ts
git commit -m "perf(inbox): batch Gmail metadata and fetch accounts in parallel"
```

---

### Task 3: Reminder button on inbox list rows

**Files:**
- Modify: `src/components/inbox/MessageList.tsx`
- Modify: `app/(app)/inbox/page.tsx`

**Interfaces:**
- Consumes: `AddReminderModal`, `ReminderPrefill` from `@/components/reminders/AddReminderModal`
- Produces: `MessageList` props include `onAddReminder: (msg: InboxMessage) => void`

- [ ] **Step 1: Update `MessageList` with bell + callback**

Replace `src/components/inbox/MessageList.tsx` with:

```tsx
"use client";

import { BellPlus } from "lucide-react";
import { InboxMessage } from "@/lib/types";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default function MessageList({
  messages, readLocally, onSelect, onAddReminder,
}: {
  messages: InboxMessage[];
  readLocally: Record<string, boolean>;
  onSelect: (msg: InboxMessage) => void;
  onAddReminder: (msg: InboxMessage) => void;
}) {
  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
        <p style={{ color: "#9CA3AF" }}>אין הודעות דואר.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl divide-y" style={{ border: "1px solid #E8EDF5" }}>
      {messages.map((msg) => {
        const isRead = msg.isRead || readLocally[`${msg.accountId}_${msg.id}`];
        return (
          <div
            key={`${msg.accountId}_${msg.id}`}
            className="flex items-start gap-2 px-4 py-3 transition hover:bg-[#F8FAFC]"
          >
            <button
              type="button"
              onClick={() => onSelect(msg)}
              className="min-w-0 flex-1 flex items-start gap-3 text-right"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ background: msg.accountColor }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm truncate" style={{ color: "#0D1321", fontWeight: isRead ? 400 : 700 }}>{msg.from}</p>
                  <span className="text-xs shrink-0" style={{ color: "#9CA3AF" }}>{fmtDate(msg.date)}</span>
                </div>
                <p className="text-sm truncate" style={{ color: "#0D1321", fontWeight: isRead ? 400 : 600 }}>{msg.subject}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: "#9CA3AF" }}>{msg.snippet}</p>
              </div>
            </button>
            <button
              type="button"
              aria-label="הוסף תזכורת"
              title="הוסף תזכורת"
              onClick={(e) => {
                e.stopPropagation();
                onAddReminder(msg);
              }}
              className="shrink-0 mt-0.5 p-2 rounded-full transition hover:opacity-90"
              style={{ background: "#FEF6E7", color: "#92651A" }}
            >
              <BellPlus size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire modal state on the inbox page**

In `app/(app)/inbox/page.tsx`:

1. Add imports:

```tsx
import AddReminderModal from "@/components/reminders/AddReminderModal";
import type { ReminderPrefill } from "@/components/reminders/AddReminderModal";
```

2. Add state next to `selected`:

```tsx
  const [reminderPrefill, setReminderPrefill] = useState<ReminderPrefill | null>(null);
```

3. Add handler:

```tsx
  const openReminderForMessage = (msg: InboxMessage) => {
    setReminderPrefill({
      title: msg.subject,
      source: {
        type: "email",
        accountId: msg.accountId,
        messageId: msg.id,
        label: msg.subject || "מייל",
      },
    });
  };
```

4. Pass `onAddReminder={openReminderForMessage}` to `MessageList`.

5. After the `MessageDetail` block, render:

```tsx
      {reminderPrefill && (
        <AddReminderModal
          onClose={() => setReminderPrefill(null)}
          prefill={reminderPrefill}
        />
      )}
```

Do **not** remove or change the reminder button inside `MessageDetail`.

- [ ] **Step 3: Typecheck / build frontend**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/MessageList.tsx "app/(app)/inbox/page.tsx"
git commit -m "feat(inbox): add reminder button on message list rows"
```

---

### Task 4: Deploy and manual verification

**Files:** none (deploy + verify)

- [ ] **Step 1: Deploy functions**

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions:listInboxMessagesCallable
```

Expected: deploy succeeds for `listInboxMessagesCallable`.

- [ ] **Step 2: Deploy hosting**

```bash
npm run build
firebase deploy --only hosting
```

Expected: hosting release complete.

- [ ] **Step 3: Manual checks**

1. Open `/inbox`, hard-refresh (Ctrl+Shift+R).
2. List should appear faster than before on Google accounts (target: roughly one list + one batch, not 20 sequential gets).
3. Click the bell on a row → reminder modal opens with that email's subject; save creates a reminder with `source.type === "email"`.
4. Click the row (not the bell) → message detail still opens; detail's "הוסף לתזכורות" still works.
5. If a Microsoft account is connected, its messages still list correctly.

Optional log check:

```bash
firebase functions:log --only listInboxMessagesCallable
```

Look for absence of per-message get spam / no new errors on batch path.

- [ ] **Step 4: Commit deploy notes only if any leftover docs changed** — usually nothing; skip empty commit.

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Gmail batch metadata instead of N sequential gets | Task 1–2 |
| Parallel account fetches | Task 2 |
| Callable contract unchanged | Task 2 |
| Bell on list → modal with email prefill | Task 3 |
| Keep detail reminder button | Task 3 (explicit non-change) |
| No Firestore cache / no partial streaming | Out of scope (not tasked) |
| Unit test batch parsing | Task 1 |
| Deploy + manual verify | Task 4 |
