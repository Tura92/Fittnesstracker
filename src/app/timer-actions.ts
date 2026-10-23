"use server";

import { Client } from "@upstash/qstash";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { pushSubscriptions, restTimers } from "@/db/schema";
import { pushConfigured } from "@/lib/push";
import { requireUserId } from "@/lib/session";

function qstash() {
  return new Client({ token: process.env.QSTASH_TOKEN!, baseUrl: process.env.QSTASH_URL });
}

async function callbackUrl(): Promise<string> {
  if (process.env.APP_URL) return `${process.env.APP_URL.replace(/\/$/, "")}/api/rest-timer`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/rest-timer`;
}

/** Bricht alle noch nicht abgelaufenen Timer des Kontos ab, damit nur einer klingelt. */
async function cancelPending(userId: number) {
  const db = await getDb();
  const open = and(eq(restTimers.userId, userId), eq(restTimers.cancelled, false), isNull(restTimers.firedAt));
  const pending = await db
    .select({ id: restTimers.id, messageId: restTimers.messageId })
    .from(restTimers)
    .where(open);
  if (pending.length === 0) return;
  await db.update(restTimers).set({ cancelled: true }).where(open);
  const ids = pending.map((p) => p.messageId).filter((id): id is string => !!id);
  if (ids.length > 0 && pushConfigured()) {
    // Bereits zugestellte Nachrichten lassen sich nicht mehr abbrechen; das ist in Ordnung
    await qstash().messages.cancel(ids).catch(() => undefined);
  }
}

/**
 * Startet den Pausen-Timer serverseitig, damit der Ablauf auch bei gesperrtem
 * Handy per Push gemeldet wird. Ohne Push-Konfiguration läuft der Timer nur in der App.
 */
export async function startRestTimer(seconds: number, label: string): Promise<{ push: boolean }> {
  const userId = await requireUserId();
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error("Ungültige Dauer");
  await cancelPending(userId);
  if (!pushConfigured()) return { push: false };

  const db = await getDb();
  const [timer] = await db
    .insert(restTimers)
    .values({ userId, endsAt: new Date(Date.now() + seconds * 1000), label: label.slice(0, 200) })
    .returning({ id: restTimers.id });
  const { messageId } = await qstash().publishJSON({
    url: await callbackUrl(),
    body: { timerId: timer.id },
    delay: seconds,
    retries: 1,
  });
  await db.update(restTimers).set({ messageId }).where(eq(restTimers.id, timer.id));
  return { push: true };
}

export async function stopRestTimer() {
  await cancelPending(await requireUserId());
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const userId = await requireUserId();
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error("Ungültiges Push-Abo");
  }
  const db = await getDb();
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Meldet sich auf dem Gerät jemand anderes an, bekommt ab jetzt der die Alarme
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
}
