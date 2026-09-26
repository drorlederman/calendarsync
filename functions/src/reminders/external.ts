import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { db } from "../firebase";
import { ReminderLevel, ReminderSource } from "../types";

// Shared secret, identical value stored in fintics-prod. The fintics bridge
// sends it in the x-bridge-secret header; anything else is rejected. This is a
// public HTTPS endpoint (cross-project callers can't use Firebase Auth), so the
// secret is the whole access control.
const bridgeSecret = defineSecret("BRIDGE_SECRET");

function toTs(iso: unknown): admin.firestore.Timestamp | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
}
function level(v: unknown, fallback: ReminderLevel): ReminderLevel {
  return v === "low" || v === "medium" || v === "high" ? v : fallback;
}

/**
 * Creates a reminder from another app (currently fintics). Secret-gated public
 * endpoint — used because a cross-project caller cannot authenticate with this
 * project's Firebase Auth. Writes into this project's own Firestore.
 */
export const createReminderExternal = functions.https.onRequest(
  { secrets: [bridgeSecret] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    const provided = req.get("x-bridge-secret");
    if (!provided || provided !== bridgeSecret.value()) { res.status(403).json({ error: "forbidden" }); return; }

    const b = (req.body ?? {}) as Record<string, unknown>;
    const uid = typeof b.uid === "string" ? b.uid : "";
    const title = typeof b.title === "string" ? b.title : "";
    if (!uid || !title) { res.status(400).json({ error: "uid and title required" }); return; }

    const urgency = level(b.urgency, "medium");
    const importance = level(b.importance, "high");
    const now = admin.firestore.FieldValue.serverTimestamp();

    const reminder = {
      uid,
      title: title.slice(0, 200),
      notes: typeof b.notes === "string" && b.notes ? b.notes : null,
      dueAt: toTs(b.dueAt),
      remindAt: toTs(b.remindAt),
      leadOffsetsMinutes: Array.isArray(b.leadOffsetsMinutes)
        ? (b.leadOffsetsMinutes as unknown[]).filter((n): n is number => typeof n === "number")
        : [15, 1440],
      status: "open" as const,
      completedAt: null,
      urgency,
      importance,
      nagEnabled: urgency === "high" || importance === "high",
      source: (b.source ?? null) as ReminderSource | null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db.collection("reminders").add(reminder);
    res.json({ ok: true, reminderId: ref.id });
  }
);
