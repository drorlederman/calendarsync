# Slack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slack as a third connected-account provider in calendarsync, with a new unified message screen, real-time WhatsApp alerts for DMs/@mentions, and a Slack summary folded into the existing daily digest.

**Architecture:** Mirrors the existing Google/Microsoft OAuth pattern exactly (user-scoped tokens, not bot tokens, since bots can't see a user's DMs). Real-time delivery uses Slack's Events API (push) hitting one new public Cloud Function, rather than polling. Messages are cached into a new `slackMessages` Firestore collection that powers both the new screen and the digest count.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript), Firestore, Next.js 16 static export, Slack OAuth v2 + Events API, existing Green API WhatsApp helper.

## Global Constraints

- Slack OAuth uses **user token scopes** (`user_scope` param), never bot scopes: `channels:history,channels:read,groups:history,groups:read,im:history,im:read,users:read,team:read`.
- OAuth redirect URI: `https://calendarsync-dror.web.app/oauth/callback` (already registered and working for Google/Microsoft — same URI reused for Slack in the Slack App config).
- No historical backfill — only messages arriving after connection are shown.
- WhatsApp real-time alerts fire only for DMs and @mentions, never plain channel messages.
- Digest summary = count of today's DM/mention messages (same day-boundary as the existing calendar digest), appended to the *same* daily digest WhatsApp message — not a separate send.
- Read-only: no message-sending capability anywhere in this feature.
- **Test strategy for this codebase**: there is no existing test framework or Firestore emulator setup in calendarsync. Pure, dependency-free logic (signature verification, mention/DM detection) gets real unit tests using Node's built-in `node:test` + `node:assert` (zero new dependencies, works directly on the `tsc`-compiled output in `functions/lib/`). Firebase-integration pieces (OAuth flow, webhook handler, Firestore-backed digest logic, frontend pages) follow this project's established verification method throughout its whole build so far: deploy, then verify with `curl`/browser/`firebase functions:log` against the real (or a disposable test) Slack workspace — not mocked. Each such task's steps say exactly what to run and what output confirms success.
- Deterministic Firestore doc IDs throughout (never auto-generated), matching the existing `connectedAccounts`/`events` pattern — enables safe re-processing of redelivered Slack events without duplicate rows.

---

## Task 1: One-time Slack App setup + Firebase secrets

This is a manual, external setup step (like the Google Cloud OAuth client and Microsoft Entra registration already done) — there's no API to automate creating a Slack App.

**Files:** none (external configuration + secrets only)

- [ ] **Step 1: Create the Slack App**

Go to https://api.slack.com/apps → **Create New App** → **From scratch**. Name: "CalendarSync", pick your own Slack workspace as the development workspace (you'll still be able to distribute/install it to your other workspaces individually via OAuth — this initial workspace choice doesn't restrict that).

- [ ] **Step 2: Configure OAuth & Permissions**

In the app's **OAuth & Permissions** page:
- Add Redirect URL: `https://calendarsync-dror.web.app/oauth/callback`
- Under **User Token Scopes** (not Bot Token Scopes), add: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `users:read`, `team:read`
- Save changes.

- [ ] **Step 3: Configure Event Subscriptions**

In the app's **Event Subscriptions** page:
- Toggle Enable Events on.
- Request URL: `https://us-central1-calendarsync-dror.cloudfunctions.net/slackEventsWebhook` (this function doesn't exist yet — Slack's verification ping will fail until Task 8 is deployed; come back to this step after Task 8 and click "Retry" to verify).
- Under **Subscribe to events on behalf of users**, add: `message.channels`, `message.groups`, `message.im`, `message.mpim`
- Under **App unfurl/uninstall events** (or the app-level "Subscribe to bot events" section depending on Slack's current UI labeling), also add: `app_uninstalled`, `tokens_revoked`
- Save.

- [ ] **Step 4: Collect credentials**

From **Basic Information** → **App Credentials**, note down: **Client ID**, **Client Secret**, **Signing Secret**.

- [ ] **Step 5: Set Firebase secrets**

```bash
cd calendarsync
printf '%s' "<client id>" | firebase functions:secrets:set SLACK_CLIENT_ID --data-file - --project calendarsync-dror --account dror.lederman@gmail.com --force
printf '%s' "<client secret>" | firebase functions:secrets:set SLACK_CLIENT_SECRET --data-file - --project calendarsync-dror --account dror.lederman@gmail.com --force
printf '%s' "<signing secret>" | firebase functions:secrets:set SLACK_SIGNING_SECRET --data-file - --project calendarsync-dror --account dror.lederman@gmail.com --force
```

Expected output for each: `+ Created a new secret version projects/.../secrets/SLACK_.../versions/1`

- [ ] **Step 6: Commit** (nothing to commit — this task only sets external config and secrets)

---

## Task 2: Extend shared types + Firestore rules/indexes

**Files:**
- Modify: `functions/src/types.ts`
- Modify: `src/lib/types.ts`
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Produces: `Provider = "google" | "microsoft" | "slack"`, `SlackMessageDoc` (backend), `SlackMessage` (frontend), `ConnectedAccountDoc.slackTeamId?`/`slackUserId?`, `TokenDoc.refreshToken?` (now optional)

- [ ] **Step 1: Extend `functions/src/types.ts`**

Replace lines 1–21 with:

```ts
export type Provider = "google" | "microsoft" | "slack";

export type AccountStatus = "active" | "reauth_required" | "error";

export interface ConnectedAccountDoc {
  uid: string;
  provider: Provider;
  externalEmail: string;
  displayColor: string;
  status: AccountStatus;
  errorMessage?: string;
  scopes: string[];
  slackTeamId?: string;
  slackUserId?: string;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

export interface TokenDoc {
  accessToken: string;
  refreshToken?: string; // Slack user tokens have no refresh token — see oauth/slack.ts
  tokenExpiresAt: number; // epoch millis
}
```

Then append at the end of the file (after the existing `SentLogDoc` interface):

```ts

export interface SlackMessageDoc {
  uid: string;
  connectedAccountId: string;
  channelId: string;
  channelName: string;
  isDM: boolean;
  fromUserName: string;
  text: string;
  isMention: boolean;
  timestamp: FirebaseFirestore.Timestamp;
  color: string;
  notifiedViaWhatsApp: boolean;
}
```

- [ ] **Step 2: Extend `src/lib/types.ts`**

Change line 2 from:
```ts
export type Provider = "google" | "microsoft";
```
to:
```ts
export type Provider = "google" | "microsoft" | "slack";
```

Then append at the end of the file:

```ts

export interface SlackMessage {
  channelId: string;
  channelName: string;
  isDM: boolean;
  fromUserName: string;
  text: string;
  isMention: boolean;
  timestamp: Timestamp;
  color: string;
}
```

- [ ] **Step 3: Add the `slackMessages` rule to `firestore.rules`**

Insert immediately after the closing `}` of the existing `match /events/{eventId}` block (after line 43, before the `// ─── /settings/{uid}` comment on line 45):

```
    // ─── /slackMessages/{msgId} ─────────────────────────────────────────────
    // Cached Slack messages, written only by the Slack Events webhook.
    match /slackMessages/{msgId} {
      allow read:  if isOwner(resource.data.uid);
      allow write: if false;
    }

```

- [ ] **Step 4: Add the composite index to `firestore.indexes.json`**

Replace the file's `"indexes": [ ... ]` array (currently containing only the `events` index) with:

```json
{
  "indexes": [
    {
      "collectionGroup": "events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "start", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "slackMessages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 5: Verify the backend still compiles**

```bash
cd calendarsync/functions && npm run build
```
Expected: exits with no output (no TypeScript errors). If `TokenDoc.refreshToken` being made optional causes an error anywhere it's read without a null check, fix that call site now (there should be none yet — Google/Microsoft code always reads it after confirming `provider !== "slack"` implicitly through existing branches, but double-check `tokenHelper.ts` and `oauth/google.ts`/`oauth/microsoft.ts` still type-check).

- [ ] **Step 6: Verify the frontend still compiles**

```bash
cd calendarsync && npm run build && npm run lint
```
Expected: both exit cleanly (build shows the existing 6 static routes, lint has no output).

- [ ] **Step 7: Deploy rules and indexes**

```bash
cd calendarsync && firebase deploy --only firestore:rules,firestore:indexes --project calendarsync-dror --account dror.lederman@gmail.com
```
Expected: `+ Deploy complete!`

- [ ] **Step 8: Commit**

```bash
git add functions/src/types.ts src/lib/types.ts firestore.rules firestore.indexes.json
git commit -m "feat(slack): extend shared types and Firestore schema for Slack"
```

---

## Task 3: Slack request-signature verification (pure, unit tested)

**Files:**
- Create: `functions/src/slack/signature.ts`
- Test: `functions/src/slack/signature.test.ts`

**Interfaces:**
- Produces: `verifySlackSignature(signingSecret: string, timestamp: string, rawBody: string, signatureHeader: string, nowSeconds?: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `functions/src/slack/signature.test.ts`:

```ts
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
  const nowSeconds = parseInt(TIMESTAMP, 10) + 10; // 10 seconds after the request
  assert.equal(verifySlackSignature(SIGNING_SECRET, TIMESTAMP, RAW_BODY, sig, nowSeconds), true);
});

test("rejects a tampered signature", () => {
  const sig = validSignature().replace(/.$/, "0"); // flip the last hex digit
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
  const nowSeconds = parseInt(TIMESTAMP, 10) + 60 * 6; // 6 minutes later
  assert.equal(verifySlackSignature(SIGNING_SECRET, TIMESTAMP, RAW_BODY, sig, nowSeconds), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd calendarsync/functions && npm run build 2>&1 | head -20
```
Expected: FAIL — `Cannot find module './signature'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `functions/src/slack/signature.ts`:

```ts
import { createHmac, timingSafeEqual } from "crypto";

const MAX_CLOCK_SKEW_SECONDS = 60 * 5;

/**
 * Verifies a Slack Events API request per Slack's documented v0 signing
 * scheme: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const requestTime = parseInt(timestamp, 10);
  if (!Number.isFinite(requestTime) || Math.abs(nowSeconds - requestTime) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd calendarsync/functions && npm run build && node --test lib/slack/signature.test.js
```
Expected: `# pass 4`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add functions/src/slack/signature.ts functions/src/slack/signature.test.ts
git commit -m "feat(slack): add Slack request signature verification"
```

---

## Task 4: Slack mention/DM detection (pure, unit tested)

**Files:**
- Create: `functions/src/slack/mentionDetection.ts`
- Test: `functions/src/slack/mentionDetection.test.ts`

**Interfaces:**
- Produces: `isMention(text: string, slackUserId: string): boolean`, `isDirectMessage(channelType: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `functions/src/slack/mentionDetection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd calendarsync/functions && npm run build 2>&1 | head -20
```
Expected: FAIL — `Cannot find module './mentionDetection'`

- [ ] **Step 3: Write the implementation**

Create `functions/src/slack/mentionDetection.ts`:

```ts
export function isMention(text: string, slackUserId: string): boolean {
  return text.includes(`<@${slackUserId}>`);
}

export function isDirectMessage(channelType: string): boolean {
  return channelType === "im";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd calendarsync/functions && npm run build && node --test lib/slack/mentionDetection.test.js
```
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add functions/src/slack/mentionDetection.ts functions/src/slack/mentionDetection.test.ts
git commit -m "feat(slack): add mention and DM detection helpers"
```

---

## Task 5: Slack OAuth helper

**Files:**
- Create: `functions/src/oauth/slack.ts`

**Interfaces:**
- Consumes: `OAUTH_REDIRECT_URI` from `../config`
- Produces: `slackClientId`, `slackClientSecret` (Firebase secrets), `buildSlackAuthUrl(state: string): string`, `SlackTokens` type, `exchangeSlackCode(code: string): Promise<SlackTokens>`

- [ ] **Step 1: Write the implementation**

This calls Slack's real OAuth endpoints — there's no pure-logic seam to unit test here (the whole function's job is the network call itself), so this task is verified end-to-end in Task 9 alongside the full connect flow, matching this project's established pattern for OAuth helpers (`oauth/google.ts`/`oauth/microsoft.ts` have no unit tests either).

Create `functions/src/oauth/slack.ts`:

```ts
import axios from "axios";
import { defineSecret } from "firebase-functions/params";
import { OAUTH_REDIRECT_URI } from "../config";

export const slackClientId = defineSecret("SLACK_CLIENT_ID");
export const slackClientSecret = defineSecret("SLACK_CLIENT_SECRET");

// Read-only user scopes only — acting AS the user (not a bot), so DMs are
// visible. A Slack bot token cannot see a user's direct messages at all.
const SLACK_USER_SCOPES = [
  "channels:history", "channels:read",
  "groups:history", "groups:read",
  "im:history", "im:read",
  "users:read", "team:read",
].join(",");

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

export function buildSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: slackClientId.value(),
    user_scope: SLACK_USER_SCOPES,
    redirect_uri: OAUTH_REDIRECT_URI,
    state,
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

export interface SlackTokens {
  accessToken: string;
  teamId: string;
  teamName: string;
  slackUserId: string;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  authed_user?: { id: string; access_token: string };
  team?: { id: string; name: string };
}

export async function exchangeSlackCode(code: string): Promise<SlackTokens> {
  const params = new URLSearchParams({
    client_id: slackClientId.value(),
    client_secret: slackClientSecret.value(),
    code,
    redirect_uri: OAUTH_REDIRECT_URI,
  });
  const { data } = await axios.post<SlackOAuthResponse>(SLACK_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!data.ok || !data.authed_user?.access_token || !data.team) {
    throw new Error(`Slack OAuth exchange failed: ${data.error ?? "unknown error"}`);
  }
  return {
    accessToken: data.authed_user.access_token,
    teamId: data.team.id,
    teamName: data.team.name,
    slackUserId: data.authed_user.id,
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd calendarsync/functions && npm run build
```
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/oauth/slack.ts
git commit -m "feat(slack): add Slack OAuth v2 user-token exchange helper"
```

---

## Task 6: Wire Slack into the connect flow

**Files:**
- Modify: `functions/src/accounts/connect.ts`

**Interfaces:**
- Consumes: `buildSlackAuthUrl`, `exchangeSlackCode`, `slackClientId`, `slackClientSecret` from `../oauth/slack` (Task 5)
- Produces: exports `accountId` (previously private) so `slack/webhook.ts` (Task 8) can compute the same deterministic ID from a `team_id` without duplicating the hashing logic

- [ ] **Step 1: Replace the full file content**

Replace the entire content of `functions/src/accounts/connect.ts` with:

```ts
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { randomUUID, createHash } from "crypto";
import { db } from "../firebase";
import { Provider, ConnectedAccountDoc } from "../types";
import {
  buildGoogleAuthUrl, exchangeGoogleCode, googleClientId, googleClientSecret, revokeGoogleToken,
} from "../oauth/google";
import { buildMicrosoftAuthUrl, exchangeMicrosoftCode, msClientId, msClientSecret } from "../oauth/microsoft";
import { buildSlackAuthUrl, exchangeSlackCode, slackClientId, slackClientSecret } from "../oauth/slack";
import { nextColor } from "./colorPalette";
import { APP_URL } from "../config";

// Deterministic id — reconnecting the same external account overwrites the
// same doc instead of creating a duplicate. Exported so the Slack Events
// webhook (slack/webhook.ts) can compute the same id from a team_id alone,
// without a Firestore query.
export function accountId(provider: Provider, identifier: string): string {
  const hash = createHash("sha1").update(identifier.toLowerCase()).digest("hex").slice(0, 16);
  return `${provider}_${hash}`;
}

const ALL_OAUTH_SECRETS = [
  googleClientId, googleClientSecret, msClientId, msClientSecret, slackClientId, slackClientSecret,
];

export const oauthStartCallable = functions.https.onCall(
  { secrets: ALL_OAUTH_SECRETS },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const provider = request.data?.provider as Provider;
    if (provider !== "google" && provider !== "microsoft" && provider !== "slack") {
      throw new functions.https.HttpsError("invalid-argument", "provider must be 'google', 'microsoft', or 'slack'");
    }
    const stateId = randomUUID();
    await db.doc(`oauthState/${stateId}`).set({
      uid, provider, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const authUrl = provider === "google" ? buildGoogleAuthUrl(stateId)
      : provider === "microsoft" ? buildMicrosoftAuthUrl(stateId)
      : buildSlackAuthUrl(stateId);
    return { authUrl };
  }
);

interface ExchangedIdentity {
  accountId: string;
  externalEmail: string;
  scopes: string[];
  slackTeamId?: string;
  slackUserId?: string;
  tokenDoc: { accessToken: string; refreshToken?: string; tokenExpiresAt: number };
}

async function exchangeForProvider(provider: Provider, code: string): Promise<ExchangedIdentity> {
  if (provider === "google") {
    const tokens = await exchangeGoogleCode(code);
    return {
      accountId: accountId(provider, tokens.email),
      externalEmail: tokens.email,
      scopes: ["calendar.readonly", "gmail.readonly"],
      tokenDoc: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt },
    };
  }
  if (provider === "microsoft") {
    const tokens = await exchangeMicrosoftCode(code);
    return {
      accountId: accountId(provider, tokens.email),
      externalEmail: tokens.email,
      scopes: ["Calendars.Read", "Mail.Read"],
      tokenDoc: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt },
    };
  }
  const tokens = await exchangeSlackCode(code);
  return {
    accountId: accountId(provider, tokens.teamId),
    externalEmail: tokens.teamName,
    scopes: ["channels:history", "channels:read", "groups:history", "groups:read", "im:history", "im:read", "users:read", "team:read"],
    slackTeamId: tokens.teamId,
    slackUserId: tokens.slackUserId,
    // Slack user tokens don't expire/rotate the way Google/Microsoft refresh
    // tokens do — set a far-future expiry so tokenHelper.ts's existing
    // "refresh if expiring soon" check never triggers, with zero special-casing.
    tokenDoc: { accessToken: tokens.accessToken, tokenExpiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 },
  };
}

export const oauthCallback = functions.https.onRequest(
  { secrets: ALL_OAUTH_SECRETS },
  async (req, res) => {
    const { code, state, error: providerError } = req.query as Record<string, string>;

    if (providerError) {
      res.redirect(`${APP_URL}/settings?connectError=${encodeURIComponent(providerError)}`);
      return;
    }
    if (!code || !state) {
      res.status(400).send("Missing code or state");
      return;
    }

    const stateRef = db.doc(`oauthState/${state}`);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      res.status(400).send("Invalid or expired connection request — please try connecting again.");
      return;
    }
    const { uid, provider } = stateSnap.data() as { uid: string; provider: Provider };
    await stateRef.delete();

    try {
      const identity = await exchangeForProvider(provider, code);
      const accountRef = db.doc(`connectedAccounts/${identity.accountId}`);
      const existing = await accountRef.get();

      let color: string;
      if (existing.exists) {
        color = (existing.data() as ConnectedAccountDoc).displayColor;
      } else {
        const siblingsSnap = await db.collection("connectedAccounts").where("uid", "==", uid).get();
        const usedColors = siblingsSnap.docs.map((d) => (d.data() as ConnectedAccountDoc).displayColor);
        color = nextColor(usedColors);
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await accountRef.set(
        {
          uid,
          provider,
          externalEmail: identity.externalEmail,
          displayColor: color,
          status: "active",
          errorMessage: admin.firestore.FieldValue.delete(),
          scopes: identity.scopes,
          ...(identity.slackTeamId ? { slackTeamId: identity.slackTeamId } : {}),
          ...(identity.slackUserId ? { slackUserId: identity.slackUserId } : {}),
          createdAt: existing.exists ? existing.data()!.createdAt : now,
          updatedAt: now,
        },
        { merge: true }
      );
      await accountRef.collection("secure").doc("tokens").set(identity.tokenDoc);

      res.redirect(`${APP_URL}/settings?connected=${encodeURIComponent(identity.accountId)}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`${APP_URL}/settings?connectError=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`);
    }
  }
);

export const disconnectAccountCallable = functions.https.onCall(
  { secrets: [googleClientId, googleClientSecret] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    const id = request.data?.accountId as string;
    if (!id) throw new functions.https.HttpsError("invalid-argument", "accountId required");

    const accountRef = db.doc(`connectedAccounts/${id}`);
    const snap = await accountRef.get();
    if (!snap.exists || (snap.data() as ConnectedAccountDoc).uid !== uid) {
      throw new functions.https.HttpsError("not-found", "Account not found");
    }

    const account = snap.data() as ConnectedAccountDoc;
    const tokenRef = accountRef.collection("secure").doc("tokens");
    if (account.provider === "google") {
      const tokenSnap = await tokenRef.get();
      if (tokenSnap.exists) {
        await revokeGoogleToken((tokenSnap.data() as { refreshToken: string }).refreshToken);
      }
    }
    await tokenRef.delete();
    await accountRef.delete();
    return { ok: true };
  }
);
```

Note: `identity.tokenDoc` for Slack has no `refreshToken` key at all (not even `undefined`) — this avoids the Admin SDK's "cannot use undefined as a Firestore value" error, since the object literal simply omits the key rather than setting it to `undefined`.

- [ ] **Step 2: Verify it compiles**

```bash
cd calendarsync/functions && npm run build
```
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/accounts/connect.ts
git commit -m "feat(slack): wire Slack into the shared OAuth connect flow"
```

---

## Task 7: Slack Web API client helper (channel/user name resolution)

**Files:**
- Create: `functions/src/slack/client.ts`

**Interfaces:**
- Produces: `getSlackChannelName(accessToken: string, channelId: string): Promise<string>`, `getSlackUserName(accessToken: string, userId: string): Promise<string>`

- [ ] **Step 1: Write the implementation**

This is a thin wrapper around two real Slack Web API calls — verified end-to-end in Task 9's manual test (there's no meaningful pure-logic seam to unit test; the whole point is the network call). Create `functions/src/slack/client.ts`:

```ts
import axios from "axios";

export async function getSlackChannelName(accessToken: string, channelId: string): Promise<string> {
  try {
    const { data } = await axios.get("https://slack.com/api/conversations.info", {
      params: { channel: channelId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!data.ok) return channelId;
    if (data.channel?.is_im) return "הודעה ישירה";
    return data.channel?.name ? `#${data.channel.name}` : channelId;
  } catch {
    return channelId;
  }
}

export async function getSlackUserName(accessToken: string, userId: string): Promise<string> {
  try {
    const { data } = await axios.get("https://slack.com/api/users.info", {
      params: { user: userId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!data.ok) return userId;
    return data.user?.real_name || data.user?.name || userId;
  } catch {
    return userId;
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd calendarsync/functions && npm run build
```
Expected: no output, no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/slack/client.ts
git commit -m "feat(slack): add Slack Web API channel/user name resolution helper"
```

---

## Task 8: Slack Events webhook handler

**Files:**
- Create: `functions/src/slack/webhook.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `accountId` (Task 6), `verifySlackSignature` (Task 3), `isMention`/`isDirectMessage` (Task 4), `getSlackChannelName`/`getSlackUserName` (Task 7), `getValidAccessToken` from `../accounts/tokenHelper` (existing), `sendWhatsApp`/`greenApiUrl`/`greenApiInstance`/`greenApiToken` from `../notifications/whatsapp` (existing)
- Produces: `slackEventsWebhook` (exported Cloud Function), `slackSigningSecret` (Firebase secret)

- [ ] **Step 1: Write the implementation**

Create `functions/src/slack/webhook.ts`:

```ts
import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { db } from "../firebase";
import { ConnectedAccountDoc } from "../types";
import { accountId } from "../accounts/connect";
import { getValidAccessToken } from "../accounts/tokenHelper";
import { verifySlackSignature } from "./signature";
import { isMention, isDirectMessage } from "./mentionDetection";
import { getSlackChannelName, getSlackUserName } from "./client";
import { sendWhatsApp, greenApiUrl, greenApiInstance, greenApiToken } from "../notifications/whatsapp";

export const slackSigningSecret = defineSecret("SLACK_SIGNING_SECRET");

interface SlackMessageEvent {
  type: string;
  channel: string;
  channel_type?: string;
  user?: string;
  text?: string;
  ts: string;
  bot_id?: string;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  team_id?: string;
  event?: SlackMessageEvent;
}

async function handleAccountRevoked(teamId: string): Promise<void> {
  const id = accountId("slack", teamId);
  const ref = db.doc(`connectedAccounts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({
    status: "reauth_required",
    errorMessage: "Slack access was revoked or the app was uninstalled",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleMessageEvent(teamId: string, event: SlackMessageEvent): Promise<void> {
  if (event.bot_id || !event.user) return; // ignore bot messages and messages with no author

  const id = accountId("slack", teamId);
  const accountRef = db.doc(`connectedAccounts/${id}`);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) return; // event for a workspace we no longer track — safe no-op

  const account = accountSnap.data() as ConnectedAccountDoc;
  if (!account.slackUserId || account.status !== "active") return;

  const accessToken = await getValidAccessToken(id);
  const isDM = isDirectMessage(event.channel_type ?? "");
  const mentioned = isMention(event.text ?? "", account.slackUserId);

  const [channelName, fromUserName] = await Promise.all([
    getSlackChannelName(accessToken, event.channel),
    getSlackUserName(accessToken, event.user),
  ]);

  const msgId = `${id}_${event.channel}_${event.ts}`;
  const msgRef = db.doc(`slackMessages/${msgId}`);
  await msgRef.set(
    {
      uid: account.uid,
      connectedAccountId: id,
      channelId: event.channel,
      channelName,
      isDM,
      fromUserName,
      text: event.text ?? "",
      isMention: mentioned,
      timestamp: admin.firestore.Timestamp.fromMillis(Math.floor(parseFloat(event.ts) * 1000)),
      color: account.displayColor,
      notifiedViaWhatsApp: false,
    },
    { merge: true }
  );

  if (!isDM && !mentioned) return;

  // Idempotency: re-read the doc's own flag rather than a separate dedup
  // collection — Slack redelivers events on timeout, and this makes a
  // redelivery a safe no-op. Mirrors the accepted "rare duplicate over rare
  // miss" trade-off already used for calendar reminders in notifications/scheduler.ts.
  const freshSnap = await msgRef.get();
  if (freshSnap.data()?.notifiedViaWhatsApp) return;

  const settingsSnap = await db.doc(`settings/${account.uid}`).get();
  const settings = settingsSnap.data();
  if (!settings?.whatsapp?.enabled || !settings.whatsapp.phone) return;

  const kind = isDM ? "הודעה ישירה" : `אזכור בערוץ ${channelName}`;
  const message = `💬 [Slack] ${kind} מ-${fromUserName}:\n${event.text ?? ""}`;
  await sendWhatsApp(greenApiUrl.value(), greenApiInstance.value(), greenApiToken.value(), settings.whatsapp.phone, message);
  await msgRef.update({ notifiedViaWhatsApp: true });
}

export const slackEventsWebhook = functions.https.onRequest(
  { secrets: [slackSigningSecret, greenApiUrl, greenApiInstance, greenApiToken] },
  async (req, res) => {
    const timestamp = req.header("X-Slack-Request-Timestamp") ?? "";
    const signature = req.header("X-Slack-Signature") ?? "";
    const rawBody = (req as unknown as { rawBody: Buffer }).rawBody?.toString("utf8") ?? "";

    if (!verifySlackSignature(slackSigningSecret.value(), timestamp, rawBody, signature)) {
      res.status(401).send("invalid signature");
      return;
    }

    const payload = req.body as SlackEventPayload;

    if (payload.type === "url_verification") {
      res.json({ challenge: payload.challenge });
      return;
    }

    // Ack immediately — Slack retries aggressively if it doesn't get a fast 200.
    res.status(200).send("ok");

    try {
      if (!payload.team_id) return;
      const eventType = payload.event?.type;

      if (eventType === "app_uninstalled" || eventType === "tokens_revoked") {
        await handleAccountRevoked(payload.team_id);
        return;
      }
      if (eventType === "message" && payload.event) {
        await handleMessageEvent(payload.team_id, payload.event);
      }
    } catch (err) {
      console.error("Slack webhook processing error:", err);
    }
  }
);
```

- [ ] **Step 2: Export it from `functions/src/index.ts`**

Add this line to `functions/src/index.ts` (after the existing `export * from "./email/inbox";` line):

```ts
export * from "./slack/webhook";
```

- [ ] **Step 3: Verify it compiles**

```bash
cd calendarsync/functions && npm run build
```
Expected: no output, no errors.

- [ ] **Step 4: Deploy**

```bash
cd calendarsync && firebase deploy --only functions:slackEventsWebhook --project calendarsync-dror --account dror.lederman@gmail.com
```
Expected: `+ functions[slackEventsWebhook(us-central1)] Successful create operation.` with a printed Function URL matching `https://us-central1-calendarsync-dror.cloudfunctions.net/slackEventsWebhook`.

- [ ] **Step 5: Go back to Task 1 Step 3 and click "Retry" on the Event Subscriptions Request URL**

Slack sends a `url_verification` POST to confirm the endpoint is live before accepting the subscription. Expected in the Slack App config UI: a green "Verified" checkmark next to the Request URL.

- [ ] **Step 6: Commit**

```bash
git add functions/src/slack/webhook.ts functions/src/index.ts
git commit -m "feat(slack): add Slack Events API webhook — ingestion, mention/DM alerts, revocation handling"
```

---

## Task 9: Extend the daily digest with a Slack summary

**Files:**
- Modify: `functions/src/notifications/scheduler.ts`

**Interfaces:**
- Consumes: `SlackMessageDoc` from `../types` (Task 2)
- Produces: `buildDigestMessage` gains a third parameter; behavior of `processDigest` and the `sendTestWhatsAppCallable` "digest" branch both extend to include the Slack count

- [ ] **Step 1: Add a Slack-count helper and extend `buildDigestMessage`**

No import changes are needed in `functions/src/notifications/scheduler.ts` — `admin` and `db` are already imported (lines 2–3), and the new helper below doesn't need `SlackMessageDoc` by name since it only counts matching docs.

Replace the `buildDigestMessage` function (lines 33–48) with:

```ts
function buildDigestMessage(events: EventDoc[], dateLabel: string, slackCount: number): string {
  const lines: string[] = [];
  lines.push(`📅 סיכום פגישות להיום — ${dateLabel}`);
  lines.push("");
  if (events.length === 0) {
    lines.push("אין פגישות מתוכננות היום 🎉");
  } else {
    const sorted = [...events].sort((a, b) => a.start.toMillis() - b.start.toMillis());
    for (const event of sorted) {
      const time = event.allDay ? "כל היום" : fmtTime(event.start.toDate(), TIMEZONE);
      const link = event.joinUrl ? ` (🔗 ${event.joinUrl})` : "";
      lines.push(`🕐 ${time} — ${event.title}${link}`);
    }
  }
  if (slackCount > 0) {
    lines.push("");
    lines.push(`💬 Slack: ${slackCount} הודעות ישירות/אזכורים היום`);
  }
  return lines.join("\n");
}

async function countTodaySlackAlerts(uid: string, start: Date, end: Date): Promise<number> {
  const snap = await db.collection("slackMessages")
    .where("uid", "==", uid)
    .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("timestamp", "<", admin.firestore.Timestamp.fromDate(end))
    .get();
  return snap.docs.filter((d) => d.data().isDM || d.data().isMention).length;
}
```

Note on a deliberate simplification vs. the design spec: the spec sketched a `sentLog.slackDigest` cursor field to count messages "since the last digest." This implementation counts "today's" DM/mention messages instead, reusing the exact same day-boundary (`start`/`end` from `localDayBoundsUtc`) the calendar digest already computes — for a digest that fires once or twice a day, the two are operationally equivalent, and this avoids introducing a cursor field and its own edge cases (e.g., what happens on the very first digest ever, before any cursor exists). No `sentLog.slackDigest` field is created anywhere in this plan.

- [ ] **Step 2: Update `processDigest` to pass the Slack count**

In `processDigest`, replace these two lines:
```ts
  const events = eventsSnap.docs.map((d) => d.data() as EventDoc).filter((e) => e.status === "confirmed");
  const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "long" }).format(now);
  const message = buildDigestMessage(events, dateLabel);
```
with:
```ts
  const events = eventsSnap.docs.map((d) => d.data() as EventDoc).filter((e) => e.status === "confirmed");
  const slackCount = await countTodaySlackAlerts(uid, start, end);
  const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "long" }).format(now);
  const message = buildDigestMessage(events, dateLabel, slackCount);
```

- [ ] **Step 3: Update the `sendTestWhatsAppCallable` digest branch the same way**

Replace:
```ts
      const events = eventsSnap.docs.map((d) => d.data() as EventDoc).filter((e) => e.status === "confirmed");
      const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "long" }).format(new Date());
      await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, buildDigestMessage(events, dateLabel));
```
with:
```ts
      const events = eventsSnap.docs.map((d) => d.data() as EventDoc).filter((e) => e.status === "confirmed");
      const slackCount = await countTodaySlackAlerts(uid, start, end);
      const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "long" }).format(new Date());
      await sendWhatsApp(apiUrl, instanceId, token, settings.whatsapp.phone, buildDigestMessage(events, dateLabel, slackCount));
```

- [ ] **Step 4: Verify it compiles**

```bash
cd calendarsync/functions && npm run build
```
Expected: no output, no errors.

- [ ] **Step 5: Deploy**

```bash
cd calendarsync && firebase deploy --only functions:whatsappSchedulerTick,functions:sendTestWhatsAppCallable --project calendarsync-dror --account dror.lederman@gmail.com
```
Expected: both functions show `Successful update operation.`

- [ ] **Step 6: Commit**

```bash
git add functions/src/notifications/scheduler.ts
git commit -m "feat(slack): fold today's DM/mention count into the daily WhatsApp digest"
```

---

## Task 10: Frontend — Slack screen

**Files:**
- Create: `src/components/slack/SlackMessageList.tsx`
- Create: `app/(app)/slack/page.tsx`

**Interfaces:**
- Consumes: `SlackMessage` type from `@/lib/types` (Task 2), `useAuth` from `@/lib/firebase/auth-context` (existing)

- [ ] **Step 1: Create the list component**

Create `src/components/slack/SlackMessageList.tsx` (mirrors `src/components/inbox/MessageList.tsx`'s pattern):

```tsx
"use client";

import { SlackMessage } from "@/lib/types";

type SlackMessageRow = SlackMessage & { id: string };

function fmtTime(timestamp: SlackMessage["timestamp"]): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(timestamp.toDate());
}

export default function SlackMessageList({ messages }: { messages: SlackMessageRow[] }) {
  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid #E8EDF5" }}>
        <p style={{ color: "#9CA3AF" }}>אין הודעות סלאק עדיין.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl divide-y" style={{ border: "1px solid #E8EDF5" }}>
      {messages.map((msg) => (
        <div key={msg.id} className="flex items-start gap-3 px-4 py-3">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ background: msg.color }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium truncate" style={{ color: "#0D1321" }}>
                {msg.fromUserName}
                {msg.isDM && (
                  <span className="mr-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: "#EFF4FF", color: "#2563EB" }}>DM</span>
                )}
                {!msg.isDM && msg.isMention && (
                  <span className="mr-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: "#FEF2F2", color: "#EF4444" }}>אזכור</span>
                )}
              </p>
              <span className="text-xs shrink-0" style={{ color: "#9CA3AF" }}>{fmtTime(msg.timestamp)}</span>
            </div>
            {!msg.isDM && <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>{msg.channelName}</p>}
            <p className="text-sm truncate mt-0.5" style={{ color: "#0D1321" }}>{msg.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

Create `app/(app)/slack/page.tsx` (mirrors `app/(app)/calendar/page.tsx`'s onSnapshot pattern):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { SlackMessage } from "@/lib/types";
import SlackMessageList from "@/components/slack/SlackMessageList";

type SlackMessageRow = SlackMessage & { id: string };

export default function SlackPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<SlackMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const [{ db }, { collection, query, where, orderBy, onSnapshot, limit }] = await Promise.all([
        import("@/lib/firebase/client"),
        import("firebase/firestore"),
      ]);
      const q = query(
        collection(db, "slackMessages"),
        where("uid", "==", user.uid),
        orderBy("timestamp", "desc"),
        limit(100)
      );
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as SlackMessage) })));
          setLoading(false);
        },
        (err) => {
          console.error("slackMessages onSnapshot error:", err);
          setError(`שגיאה בטעינת הודעות סלאק: ${err.message}`);
          setLoading(false);
        }
      );
    })();
    return () => unsubscribe?.();
  }, [user]);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "#0D1321" }}>סלאק</h1>
        <p className="text-sm mt-1" style={{ color: "#5B6477" }}>הודעות ואזכורים מכל ה-workspaces המחוברים</p>
      </div>
      {error ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FEF2F2", color: "#EF4444" }}>{error}</div>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "#F8FAFC" }} />
          ))}
        </div>
      ) : (
        <SlackMessageList messages={messages} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build and lint**

```bash
cd calendarsync && npm run build && npm run lint
```
Expected: build shows a new `○ /slack` route alongside the existing 6; lint has no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/slack/SlackMessageList.tsx "app/(app)/slack/page.tsx"
git commit -m "feat(slack): add the unified Slack messages screen"
```

---

## Task 11: Frontend — nav item and Settings connect button

**Files:**
- Modify: `app/(app)/layout.tsx`
- Modify: `src/components/settings/ConnectedAccountsSection.tsx`

- [ ] **Step 1: Add the nav item**

In `app/(app)/layout.tsx`, change the import on lines 7–9 from:
```ts
import {
  CalendarDays, Inbox, Settings, LogOut, Menu, X,
} from "lucide-react";
```
to:
```ts
import {
  CalendarDays, Inbox, Settings, LogOut, Menu, X, MessagesSquare,
} from "lucide-react";
```

Then change the `NAV` array (lines 11–14) from:
```ts
const NAV = [
  { href: "/calendar", label: "יומן",    Icon: CalendarDays },
  { href: "/inbox",    label: "דואר",    Icon: Inbox },
  { href: "/settings", label: "הגדרות", Icon: Settings },
```
to:
```ts
const NAV = [
  { href: "/calendar", label: "יומן",    Icon: CalendarDays },
  { href: "/inbox",    label: "דואר",    Icon: Inbox },
  { href: "/slack",    label: "סלאק",    Icon: MessagesSquare },
  { href: "/settings", label: "הגדרות", Icon: Settings },
```

- [ ] **Step 2: Add the Slack connect button**

In `src/components/settings/ConnectedAccountsSection.tsx`:

Change line 10 from:
```ts
const PROVIDER_LABEL: Record<string, string> = { google: "Google", microsoft: "Microsoft" };
```
to:
```ts
const PROVIDER_LABEL: Record<string, string> = { google: "Google", microsoft: "Microsoft", slack: "Slack" };
```

Change line 16 from:
```ts
  const [connecting, setConnecting] = useState<"google" | "microsoft" | null>(null);
```
to:
```ts
  const [connecting, setConnecting] = useState<"google" | "microsoft" | "slack" | null>(null);
```

Find the `connect` function's parameter type (the line reading `const connect = async (provider: "google" | "microsoft") => {`) and change it to:
```ts
  const connect = async (provider: "google" | "microsoft" | "slack") => {
```

Add a third button after the existing Microsoft button (after line 144's closing `</button>`, before the closing `</div>` on line 145):

```tsx
        <button
          onClick={() => connect("slack")}
          disabled={connecting !== null}
          className="px-4 py-2 rounded-xl text-sm font-medium border transition hover:bg-[#EFF4FF] disabled:opacity-50"
          style={{ borderColor: "#E8EDF5", color: "#0D1321" }}
        >
          {connecting === "slack" ? "מתחבר..." : "+ חבר Slack"}
        </button>
```

- [ ] **Step 3: Verify build and lint**

```bash
cd calendarsync && npm run build && npm run lint
```
Expected: both clean, as in Task 10 Step 3.

- [ ] **Step 4: Deploy the frontend**

```bash
cd calendarsync && firebase deploy --only hosting --project calendarsync-dror --account dror.lederman@gmail.com
```
Expected: `+ Deploy complete!`

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/layout.tsx" src/components/settings/ConnectedAccountsSection.tsx
git commit -m "feat(slack): add nav item and Settings connect button"
```

---

## Task 12: End-to-end verification

**Files:** none (verification only, against the real deployed app and a disposable test Slack workspace)

- [ ] **Step 1: Connect a workspace**

Open https://calendarsync-dror.web.app/settings → "+ חבר Slack" → complete the Slack OAuth consent screen. Expected: redirected back to Settings with the green "החשבון חובר בהצלחה" banner, and the workspace appears in the connected-accounts list with a distinct color.

- [ ] **Step 2: Verify a DM triggers a real-time WhatsApp alert**

From another Slack account in the same workspace, send the connected user a direct message. Expected: a WhatsApp message starting with `💬 [Slack] הודעה ישירה מ-...` arrives within a few seconds.

- [ ] **Step 3: Verify a channel @mention triggers an alert**

In a channel the connected user is a member of, post a message that `@mentions` them. Expected: a WhatsApp message starting with `💬 [Slack] אזכור בערוץ #...` arrives within a few seconds.

- [ ] **Step 4: Verify a plain channel message does NOT trigger an alert but does appear on-screen**

Post a channel message with no mention of the connected user. Expected: no WhatsApp message fires; refreshing https://calendarsync-dror.web.app/slack shows the new message in the list.

- [ ] **Step 5: Verify the digest includes the Slack count**

Call the test-send callable from the Settings page ("שלח סיכום לדוגמה" button in the WhatsApp section). Expected: the digest message includes a line like `💬 Slack: 2 הודעות ישירות/אזכורים היום` matching the DMs/mentions sent in Steps 2–3.

- [ ] **Step 6: Verify revocation handling**

In the test workspace's Slack admin settings, remove the CalendarSync app (or use **Apps** → **Manage** → **Remove App**). Expected: within a few seconds, `firebase functions:log --project calendarsync-dror --account dror.lederman@gmail.com -n 20` shows a `slackEventsWebhook` invocation, and the Settings page's connected-accounts list shows that workspace with a red "יש להתחבר מחדש" reconnect button instead of the green "מחובר" badge.

- [ ] **Step 7: Final commit** (only if any fixes were needed during verification; otherwise skip)

```bash
git add -A
git commit -m "fix(slack): address issues found during end-to-end verification"
```
