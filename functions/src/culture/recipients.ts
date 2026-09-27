// Same normalization as toChatId in notifications/whatsapp.ts: a leading 0 is
// an Israeli local number (→ 972…), anything else is taken as international.
function normalizedDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
}

export function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 9;
}

/** Stable per-recipient suffix for sent-log keys. */
export function phoneKey(phone: string): string {
  return normalizedDigits(phone);
}

/** Main WhatsApp phone plus the optional extra culture phone, deduplicated. */
export function cultureRecipients(mainPhone: string, extraPhone: string): string[] {
  const out = [mainPhone];
  if (isValidPhone(extraPhone) && normalizedDigits(extraPhone) !== normalizedDigits(mainPhone)) {
    out.push(extraPhone);
  }
  return out;
}
