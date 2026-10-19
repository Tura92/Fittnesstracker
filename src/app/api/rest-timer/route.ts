import { Receiver } from "@upstash/qstash";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { restTimers } from "@/db/schema";
import { pushConfigured, sendPushToAll } from "@/lib/push";

/** Wird von QStash aufgerufen, wenn eine Pause abgelaufen ist. */
export async function POST(request: Request) {
  if (!pushConfigured()) return new Response("Push nicht eingerichtet", { status: 404 });

  const body = await request.text();
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? process.env.QSTASH_CURRENT_SIGNING_KEY!,
  });
  const signature = request.headers.get("upstash-signature") ?? "";
  const valid = await receiver.verify({ signature, body }).catch(() => false);
  if (!valid) return new Response("Ungültige Signatur", { status: 401 });

  const timerId = Number((JSON.parse(body) as { timerId?: unknown }).timerId);
  const db = await getDb();
  // Nur einmal und nur, wenn der Timer nicht inzwischen gestoppt oder ersetzt wurde
  const [timer] = await db
    .update(restTimers)
    .set({ firedAt: new Date() })
    .where(and(eq(restTimers.id, timerId), eq(restTimers.cancelled, false), isNull(restTimers.firedAt)))
    .returning({ label: restTimers.label });
  if (!timer) return new Response("Timer nicht mehr aktiv");

  await sendPushToAll({
    title: "Pause vorbei",
    body: timer.label ? `Weiter mit ${timer.label}` : "Weiter geht's mit dem nächsten Satz",
    tag: "rest-timer",
  });
  return new Response("ok");
}
