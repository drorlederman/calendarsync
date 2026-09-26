import * as admin from "firebase-admin";
import { db } from "../firebase";
import { ConnectedAccountDoc, TokenDoc } from "../types";
import { refreshGoogleAccessToken } from "../oauth/google";
import { refreshMicrosoftAccessToken } from "../oauth/microsoft";

const REFRESH_MARGIN_MS = 2 * 60 * 1000; // refresh if expiring within 2 minutes

export class ReauthRequiredError extends Error {
  constructor(public accountId: string) {
    super(`Account ${accountId} requires reauth`);
  }
}

/**
 * Returns a valid access token for a connected account, refreshing it if
 * needed. On a refresh failure (revoked/expired grant), flips the account to
 * reauth_required and throws — callers must catch this and skip the account
 * rather than retry, so one dead account never hot-loops or blocks others.
 */
export async function getValidAccessToken(accountId: string): Promise<string> {
  const accountRef = db.doc(`connectedAccounts/${accountId}`);
  const tokenRef = accountRef.collection("secure").doc("tokens");
  const [accountSnap, tokenSnap] = await Promise.all([accountRef.get(), tokenRef.get()]);
  if (!accountSnap.exists || !tokenSnap.exists) throw new ReauthRequiredError(accountId);

  const account = accountSnap.data() as ConnectedAccountDoc;
  const token = tokenSnap.data() as TokenDoc;

  if (account.status !== "active") throw new ReauthRequiredError(accountId);

  if (token.tokenExpiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return token.accessToken;
  }

  try {
    if (!token.refreshToken) {
      throw new Error(`Account ${accountId} has no refresh token`);
    }
    if (account.provider === "google") {
      const refreshed = await refreshGoogleAccessToken(token.refreshToken);
      await tokenRef.update({ accessToken: refreshed.accessToken, tokenExpiresAt: refreshed.expiresAt });
      return refreshed.accessToken;
    }
    const refreshed = await refreshMicrosoftAccessToken(token.refreshToken);
    await tokenRef.update({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      tokenExpiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  } catch (err) {
    await accountRef.update({
      status: "reauth_required",
      errorMessage: err instanceof Error ? err.message : String(err),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw new ReauthRequiredError(accountId);
  }
}
