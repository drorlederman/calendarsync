# Inbox speed + email reminders — Design

Date: 2026-07-25  
Status: approved

## Goal

1. Make the inbox list load much faster (especially for Google accounts).
2. Let the user create a reminder linked to an email from the message list, without opening the message first. Keep the existing reminder button inside the open message.

## Non-goals

- Caching inbox messages in Firestore
- Background sync / push notifications for new mail
- Streaming partial results per account on the client (can revisit later)
- Changing Microsoft Graph fetch (already efficient)

## Current problems

### Slow load

`listInboxMessagesCallable` → `fetchGmailMessages` does:

1. One `users.messages.list` (up to 20 ids)
2. Then **one `users.messages.get` per message, sequentially**

That is ~21 Gmail round-trips per Google account. Accounts are also processed sequentially in the callable.

Microsoft Graph already returns list metadata in one request.

### Reminders

`MessageDetail` already opens `AddReminderModal` with:

```ts
prefill={{
  title: subject ?? "",
  source: { type: "email", accountId, messageId, label: subject ?? "מייל" },
}}
```

`MessageList` has no reminder action; the user must open the message first.

## Design

### 1. Server: faster Gmail list

**File:** `functions/src/email/inbox.ts`

**`fetchGmailMessages`**

- Keep `messages.list` as today (`INBOX`, `maxResults: 20`, optional `pageToken`).
- Replace the per-message sequential `messages.get` loop with a **single Gmail batch HTTP request** to `https://www.googleapis.com/batch/gmail/v1`.
- Each sub-request: `GET /gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`.
- Parse multipart batch response into the existing `NormalizedMessage` shape (`id`, `from`, `subject`, `snippet`, `date`, `isRead`).
- Preserve order by matching batch parts to the listed message ids.
- On partial batch failure for one id: skip that message (or include with fallbacks); do not fail the whole account unless the batch itself fails.

**`listInboxMessagesCallable`**

- Fetch all connected accounts with `Promise.all` (per-account try/catch unchanged so one bad account does not block others).
- Callable request/response contract unchanged: `{ pageTokens? }` → `{ results: Record<accountId, { items, nextPageToken?, accountColor, error? }> }`.

### 2. Client: reminder from list

**Files:** `src/components/inbox/MessageList.tsx`, `app/(app)/inbox/page.tsx`

- Each list row gets a small bell button (`BellPlus` / same visual language as detail).
- Click on the bell: `event.stopPropagation()`; open `AddReminderModal` with the same email `prefill` as detail (title = subject, `source.type = "email"` with `accountId`, `messageId`, `label`).
- Click elsewhere on the row: open message detail as today.
- `MessageDetail` keeps its existing "הוסף לתזכורות" button.

State ownership: page holds `reminderPrefill` (or equivalent); list calls `onAddReminder(msg)`; modal rendered at page (or list) level when set.

### 3. Client: loading UX

No structural change in this iteration. Speed comes from the server batch + parallel accounts. Skeleton remains until the callable returns.

## Error handling

- Gmail batch auth / network failure → same per-account `error` string in results as today.
- Reminder save failures stay inside `AddReminderModal` (unchanged).

## Testing

- Unit-test batch response parsing with a small fixture multipart body (from/subject/snippet/date/isRead).
- Manual: Google inbox loads noticeably faster; bell on row opens modal linked to that email; detail button still works; Microsoft account list still works.

## Success criteria

- Google inbox list load drops from many sequential gets to roughly one list + one batch.
- User can create an email-linked reminder from the list in one click without opening the message.
- Existing detail-flow reminder still works.
