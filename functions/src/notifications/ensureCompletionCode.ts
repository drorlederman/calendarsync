import * as admin from "firebase-admin";
import { db } from "../firebase";
import { ReminderDoc } from "../types";
import { generateCompletionCode } from "./completionCode";

const MAX_CODE_ATTEMPTS = 8;

/**
 * Ensures the reminder has a stable completionCode, indexed under
 * completionCodes/{code} for O(1) WhatsApp reply lookup.
 */
export async function ensureCompletionCode(
  reminderId: string,
  reminder: ReminderDoc,
): Promise<string> {
  if (reminder.completionCode) return reminder.completionCode;

  const reminderRef = db.doc(`reminders/${reminderId}`);

  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const code = generateCompletionCode();
    const indexRef = db.doc(`completionCodes/${code}`);

    try {
      const resolved = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(reminderRef);
        const data = fresh.data() as ReminderDoc | undefined;
        if (!data) throw new Error("reminder-missing");
        if (data.completionCode) return data.completionCode;

        const existing = await tx.get(indexRef);
        if (existing.exists) throw new Error("collision");

        tx.set(indexRef, {
          uid: data.uid,
          reminderId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.update(reminderRef, {
          completionCode: code,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return code;
      });
      reminder.completionCode = resolved;
      return resolved;
    } catch (err) {
      if (err instanceof Error && err.message === "collision") continue;
      throw err;
    }
  }
  throw new Error("failed to allocate unique completion code");
}
