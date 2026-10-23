import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/** Push klappt nur mit VAPID-Schlüsseln und QStash, das den Ablauf zeitversetzt meldet. */
export function pushConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.QSTASH_TOKEN &&
    process.env.QSTASH_CURRENT_SIGNING_KEY
  );
}

export type PushPayload = { title: string; body: string; tag?: string };

/** Schickt eine Benachrichtigung an alle Geräte eines Kontos und räumt abgelaufene Abos auf. */
export async function sendPushToUser(userId: number, payload: PushPayload) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:fittnesstracker@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const db = await getDb();
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          // Ohne Zustellung innerhalb einer Minute ist der Alarm wertlos
          { TTL: 60, urgency: "high" },
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          console.error("Push fehlgeschlagen", status, err);
        }
      }
    }),
  );
}
