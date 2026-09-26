/** Alphabet without ambiguous lookalikes (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const COMPLETION_CODE_LENGTH = 4;

export function generateCompletionCode(rng: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < COMPLETION_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return out;
}

export type CompletionReply =
  | { kind: "code"; code: string }
  | { kind: "bare" }
  | null;

// Hebrew: בוצע / בוצעה / בוצעו / סיום / סיימתי — plus English done.
const DONE_WORDS = "בוצע(?:ה|ו)?|סיום|סיימתי|done";

/**
 * Parses a WhatsApp reply that marks a reminder done.
 * - "בוצע AB12" → { kind: "code", code: "AB12" } (completes that specific reminder)
 * - "בוצע"      → { kind: "bare" } (completes the most recently notified reminder)
 */
export function parseCompletionReply(text: string): CompletionReply {
  const trimmed = text.trim();

  const withCode = trimmed.match(
    new RegExp(`^(?:${DONE_WORDS})\\s*[:\\-]?\\s*([A-Za-z0-9]{${COMPLETION_CODE_LENGTH}})$`, "iu")
  );
  if (withCode) return { kind: "code", code: withCode[1].toUpperCase() };

  const bare = trimmed.match(new RegExp(`^(?:${DONE_WORDS})\\s*[.!\\u200f\\u200e]*$`, "iu"));
  if (bare) return { kind: "bare" };

  return null;
}

export function normalizePhoneDigits(phoneOrChatId: string): string {
  const digits = phoneOrChatId.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length >= 9) return `972${digits.slice(1)}`;
  return digits;
}

export function phonesMatch(a: string, b: string): boolean {
  return normalizePhoneDigits(a) === normalizePhoneDigits(b);
}
