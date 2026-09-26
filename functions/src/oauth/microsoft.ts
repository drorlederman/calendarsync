import axios from "axios";
import { defineSecret } from "firebase-functions/params";
import { OAUTH_REDIRECT_URI } from "../config";

export const msClientId = defineSecret("MS_OAUTH_CLIENT_ID");
export const msClientSecret = defineSecret("MS_OAUTH_CLIENT_SECRET");

// Read-only scopes only — the app never writes to the user's calendar or mail.
const MS_SCOPES = "offline_access Calendars.Read Mail.Read User.Read";
const MS_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export function buildMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: msClientId.value(),
    response_type: "code",
    redirect_uri: OAUTH_REDIRECT_URI,
    response_mode: "query",
    scope: MS_SCOPES,
    state,
  });
  return `${MS_AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(
  body: Record<string, string>
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const params = new URLSearchParams({
    client_id: msClientId.value(),
    client_secret: msClientSecret.value(),
    redirect_uri: OAUTH_REDIRECT_URI,
    ...body,
  });
  const { data } = await axios.post(MS_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export async function exchangeMicrosoftCode(
  code: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; email: string }> {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code });
  const { data } = await axios.get("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const email: string = data.mail || data.userPrincipalName;
  return { ...tokens, email };
}

// Microsoft rotates the refresh token on every use — callers MUST persist the
// returned refreshToken, not just the accessToken, or the next refresh fails.
export async function refreshMicrosoftAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}
