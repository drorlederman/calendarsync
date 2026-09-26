import { OAuth2Client } from "google-auth-library";
import { defineSecret } from "firebase-functions/params";
import axios from "axios";
import { OAUTH_REDIRECT_URI } from "../config";

export const googleClientId = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
export const googleClientSecret = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");

// Read-only scopes only — the app never writes to the user's calendar or mail.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function client(): OAuth2Client {
  return new OAuth2Client(googleClientId.value(), googleClientSecret.value(), OAUTH_REDIRECT_URI);
}

export function buildGoogleAuthUrl(state: string): string {
  const oauth2Client = client();
  // access_type=offline + prompt=consent are both required or a reconnect
  // may not reissue a refresh token at all.
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function exchangeGoogleCode(
  code: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; email: string }> {
  const oauth2Client = client();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token — this happens if consent wasn't freshly granted; reconnect and approve again."
    );
  }
  const { data } = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ?? Date.now() + 55 * 60 * 1000,
    email: data.email,
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2Client = client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2Client.getAccessToken();
  const expiresAt = oauth2Client.credentials.expiry_date;
  if (!token || !expiresAt) throw new Error("invalid_grant");
  return { accessToken: token, expiresAt };
}

export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  try {
    await axios.post(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`);
  } catch (err) {
    // Best-effort — deleting our stored copy is what actually matters.
    console.warn("Google token revoke failed (non-fatal):", err);
  }
}
