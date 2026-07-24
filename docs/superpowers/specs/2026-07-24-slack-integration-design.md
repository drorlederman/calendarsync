# Slack integration — design

## Context

calendarsync currently aggregates Google Calendar/Gmail and Microsoft Calendar/Outlook into unified Calendar and Inbox screens, with WhatsApp reminders and a daily digest. The user wants to add Slack as a third connected-account provider, surfaced in its own new screen (not merged into the existing Inbox, since Slack's data shape — channels, DMs, mentions — differs from email), with real-time WhatsApp alerts for direct messages and @mentions, plus a summary folded into the existing daily digest.

## Scope decisions (confirmed with user)

- **Content**: DMs + all channels the user is a member of (not just a hand-picked subset).
- **Multiple workspaces**: supported from the start, same as multiple Google/Microsoft accounts today.
- **Delivery**: real-time via Slack's Events API (push), not polling — Slack bots can't see a user's DMs at all, so this requires **user-scoped OAuth tokens** (acting as the user), matching the existing Google/Microsoft pattern exactly, rather than a bot token.
- **WhatsApp integration**: real-time alerts for DMs and @mentions only (not every channel message, to avoid flooding); a summary count is also appended to the existing daily digest message — not a separate scheduled message.
- **UI**: a single unified, chronological list (same visual pattern as today's Inbox), not a two-pane channel/DM sidebar.
- **Historical backfill**: none. Connecting a workspace only surfaces messages from that moment forward — no pagination/rate-limit handling for bulk history needed.
- **Read-only**: consistent with the rest of the app, no send/reply capability.

## Data model

New Firestore collections, following the existing `connectedAccounts` shape:

```
connectedAccounts/{id}                 // id = "slack_" + sha1(teamId).slice(0,16)
  uid, provider: "slack", externalEmail: <workspace name>, displayColor,
  status: "active" | "reauth_required" | "error", scopes: string[]
  slackUserId: string                  // the connected user's own Slack member ID — needed to detect @mentions
  slackTeamId: string

connectedAccounts/{id}/secure/tokens   // { accessToken } — Slack user tokens don't expire/rotate like
                                        // Google/MS refresh tokens, so no refresh logic is needed here.

slackMessages/{msgId}                  // id = "{connectedAccountId}_{channelId}_{ts}" — deterministic, dedup-safe
  uid, connectedAccountId, channelId, channelName, isDM: boolean,
  fromUserName, text, isMention: boolean, timestamp, color,
  notifiedViaWhatsApp: boolean          // set once the real-time WhatsApp send completes — the
                                        // idempotency marker described under "Real-time ingestion" below

sentLog/{uid}                          // extends the existing doc
  slackDigest: { "<date>_<time>": true }   // same cursor pattern already used for the calendar digest
```

Firestore rules: `slackMessages` gets the same `allow read: if isOwner(resource.data.uid); allow write: if false;` shape as `events`.

## Connection flow

Mirrors the existing Google/Microsoft OAuth flow exactly:

1. One-time setup (equivalent to the Google Cloud OAuth client / Entra app registration already done): register a single Slack App at api.slack.com/apps, configure OAuth redirect URI `https://calendarsync-dror.web.app/oauth/callback`, and request **user token scopes**: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `users:read`, `team:read`.
2. `oauthStartCallable({provider: "slack"})` builds Slack's OAuth authorize URL (extending the existing `Provider` union type to include `"slack"`).
3. `oauthCallback` (already provider-agnostic) exchanges the code for a user token, calls `auth.test`/`users.identity` to get the user's own Slack member ID and team name, upserts `connectedAccounts` + `secure/tokens`.
4. After a successful connect, register the workspace's Slack Events API subscription (this can be configured once at the Slack App level to apply to all installations — not per-workspace).

## Real-time ingestion

- **`slackEventsWebhook`** — one new public `onRequest` Cloud Function, the single Events API endpoint for the whole app (all workspaces share it).
  - Verifies Slack's request signature (`X-Slack-Signature` + signing secret) on every request — Slack's equivalent of the Graph subscription validation handshake.
  - Handles the one-time `url_verification` challenge Slack sends when the subscription is first configured.
  - For each incoming `message` event: the event's `authorizations` array identifies which connected Slack user it applies to — matched against `connectedAccounts` by `slackUserId`/`slackTeamId`.
  - Always caches the message into `slackMessages` (this is what powers the list screen), tagging `isDM` (channel ID starts with `D`) and `isMention` (message text contains `<@{slackUserId}>`).
  - If `isDM || isMention`: immediately calls the existing `sendWhatsApp()` helper (same Green API credentials already configured) with a short message: `💬 [Slack] הודעה חדשה מ-{fromUserName} ב-{channelName}: {text}`.
  - **Dedup / idempotency**: Slack redelivers events on timeout. The deterministic `slackMessages` doc ID (`connectedAccountId_channelId_ts`) makes the cache write itself idempotent (a re-delivered event just overwrites the same doc). The WhatsApp send is guarded by a Firestore transaction on that same doc: read `notifiedViaWhatsApp`, skip if already `true`, otherwise send and set it to `true` — so a redelivered event can never double-send, without needing a separate dedup collection.
  - Always returns `200` quickly (Slack requires a fast ack), even for events referencing an already-disconnected workspace — those are just skipped after logging.

## Digest integration

`whatsappSchedulerTick`'s existing digest builder (in `notifications/scheduler.ts`) gets one more section: a count of DMs + mentions received since the last digest send, using the same `sentLog` cursor/dedup pattern already used for the calendar digest. This is a **count since last digest**, not a true unread/read-sync — consistent with how email `isRead` is already local-only in this app (no write-back to the source system). Appended to the same daily digest WhatsApp message, not sent separately.

## Frontend

- **New page** `app/(app)/slack/page.tsx` — unified chronological list (same visual pattern as `app/(app)/inbox/page.tsx`), reading `slackMessages` via `onSnapshot` (query `uid ==`, `orderBy timestamp desc`), color dot per workspace, a small badge distinguishing DM / @mention / plain channel message.
- **Settings**: `ConnectedAccountsSection`'s `Provider` type extends to include `"slack"`; add a "+ חבר Slack" button next to the existing Google/Microsoft ones — no new component needed, the existing generic account-list UI already handles arbitrary providers.
- **Nav**: add a "סלאק" item to the app layout sidebar, alongside יומן/דואר/הגדרות.

## Error handling

- Slack sends `tokens_revoked` / `app_uninstalled` events when the app is removed from a workspace → the webhook flips that `connectedAccounts` doc to `status: "reauth_required"`, reusing the exact reconnect UI already built for Google/Microsoft (no new UI needed).
- Webhook signature verification failure → reject with `401`, no processing, no data written.
- Event referencing an unknown/disconnected `connectedAccounts` doc → `200` ack (per Slack's requirements) but skip processing; logged as a warning, not an error.

## Testing / verification plan

- Connect a test Slack workspace; confirm `connectedAccounts` doc appears with the correct `slackUserId`/`slackTeamId`.
- Send a DM to the connected user from another account; confirm a WhatsApp message arrives within seconds.
- Mention the user in a channel; confirm a WhatsApp message arrives.
- Post a plain channel message with no mention; confirm **no** WhatsApp fires, but the message still appears in the new Slack screen.
- Trigger the daily digest manually (existing `sendTestWhatsAppCallable`, extended to cover Slack); confirm the Slack summary line is correct.
- Remove the Slack App from the test workspace; confirm the connected account flips to `reauth_required` and the Settings reconnect button restores it.
