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
