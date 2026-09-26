import axios from "axios";
import { defineSecret } from "firebase-functions/params";

export const greenApiUrl = defineSecret("CALSYNC_GREEN_API_URL");
export const greenApiInstance = defineSecret("CALSYNC_GREEN_API_INSTANCE_ID");
export const greenApiToken = defineSecret("CALSYNC_GREEN_API_TOKEN");

export function toChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
  return `${normalized}@c.us`;
}

// Green API's Developer (free) tariff caps outgoing/incoming chats at a few
// "correspondents" per calendar month. Once that's hit, sendMessage still
// answers HTTP 200 (see GreenApiSendResponse below) instead of failing — so
// callers must check the body, not just the status code, or they'll believe
// a message was delivered when Green API silently dropped it.
export class WhatsAppQuotaExceededError extends Error {
  constructor(public readonly detail: unknown) {
    super("WhatsApp send blocked: Green API correspondents quota exceeded (Developer plan)");
    this.name = "WhatsAppQuotaExceededError";
  }
}

interface GreenApiSendResponse {
  idMessage?: string;
  correspondentsStatus?: { method?: string; status?: string; used?: number; total?: number };
  invokeStatus?: { method?: string; status?: string };
}

const QUOTA_EXCEEDED_RE = /QUOT[AE]_EXCEEDED/;

export async function sendWhatsApp(
  apiUrl: string, instanceId: string, token: string, phone: string, message: string
): Promise<void> {
  const url = `${apiUrl}/waInstance${instanceId}/sendMessage/${token}`;
  const res = await axios.post<GreenApiSendResponse>(url, { chatId: toChatId(phone), message }, {
    headers: { "Content-Type": "application/json" },
  });
  const data = res.data;
  if (data?.idMessage) return;

  const quotaStatus = data?.correspondentsStatus?.status ?? data?.invokeStatus?.status;
  if (quotaStatus && QUOTA_EXCEEDED_RE.test(quotaStatus)) {
    throw new WhatsAppQuotaExceededError(data);
  }
  throw new Error(`WhatsApp send failed — no idMessage in response: ${JSON.stringify(data)}`);
}
