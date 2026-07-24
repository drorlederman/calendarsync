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
