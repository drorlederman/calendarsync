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
