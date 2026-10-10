import axios from "axios";
import { defineSecret } from "firebase-functions/params";

// UltraMsg credentials. The instance id is the path segment of the API URL
// (e.g. "instance193947"). Bind `whatsappSecrets` to every function that sends.
export const ultramsgInstance = defineSecret("ULTRAMSG_INSTANCE_ID");
export const ultramsgToken = defineSecret("ULTRAMSG_TOKEN");
export const whatsappSecrets = [ultramsgInstance, ultramsgToken];

const API_BASE = "https://api.ultramsg.com";

export function toChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
  return `${normalized}@c.us`;
}

// UltraMsg accepts sends while the instance is not linked — it queues them
// until the phone is re-scanned, and the send response looks successful. So a
// silent unlink (what stopped Green API delivery on 2026-10-10) can only be
// detected by asking for the instance status first. Callers treat this as
// "stop this batch, retry on a later tick" — the same handling the Green API
// correspondents-quota block used to get.
export class WhatsAppUnavailableError extends Error {
  constructor(public readonly detail: unknown) {
    super(`WhatsApp unavailable: UltraMsg instance is not linked (${JSON.stringify(detail)})`);
    this.name = "WhatsAppUnavailableError";
  }
}

/** Instance states in which a send actually reaches WhatsApp, or will as soon
 * as the instance finishes (re)connecting. */
const SENDABLE_STATES = new Set(["authenticated", "initialize", "loading", "retrying", "standby"]);

const STATE_CACHE_MS = 60_000;
let cachedState: { value: string; at: number } | null = null;

/** UltraMsg reports errors as HTTP 200 with an `error` field (string, object
 * or array) — normalize it to a message, or null when there is none. */
function errorOf(data: any): string | null {
  const err = data?.error;
  if (err == null || err === "") return null;
  return typeof err === "string" ? err : JSON.stringify(err);
}

/** Current UltraMsg instance state, memoized briefly so a batch of sends
 * costs one status call rather than one per message. */
export async function getInstanceState(force = false): Promise<string> {
  if (!force && cachedState && Date.now() - cachedState.at < STATE_CACHE_MS) {
    return cachedState.value;
  }
  const res = await axios.get(`${API_BASE}/${ultramsgInstance.value().trim()}/instance/status`, {
    params: { token: ultramsgToken.value().trim() },
    timeout: 15_000,
  });
  const error = errorOf(res.data);
  if (error) throw new Error(`UltraMsg instance/status error: ${error}`);
  const state = String(res.data?.status?.accountStatus?.status ?? "unknown");
  cachedState = { value: state, at: Date.now() };
  return state;
}

interface UltraMsgSendResponse {
  sent?: string | boolean;
  message?: string;
  id?: string | number;
  error?: unknown;
}

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const state = await getInstanceState();
  if (!SENDABLE_STATES.has(state)) throw new WhatsAppUnavailableError({ state });

  const res = await axios.post<UltraMsgSendResponse>(
    `${API_BASE}/${ultramsgInstance.value().trim()}/messages/chat`,
    new URLSearchParams({ token: ultramsgToken.value().trim(), to: toChatId(phone), body: message }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30_000 }
  );
  const data = res.data;
  const error = errorOf(data);
  if (!error && String(data?.sent ?? "") === "true") return;
  cachedState = null; // re-check the instance on the next send
  throw new Error(`WhatsApp send failed — UltraMsg did not accept the message: ${JSON.stringify(data)}`);
}
