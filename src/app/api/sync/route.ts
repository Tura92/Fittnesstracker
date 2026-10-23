import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/session";
import { applySync, parseSyncPayload, type SyncPayload } from "@/lib/sync-server";

/**
 * Nimmt offline gesammelte Änderungen vom Handy entgegen. Bewusst eine feste URL statt
 * einer Server Action: Deren IDs ändern sich mit jedem Deploy, das Handy kann aber noch
 * stundenlang mit der alten, zwischengespeicherten App laufen.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
  let body: unknown;
  let payload: SyncPayload;
  try {
    body = await request.json();
    payload = parseSyncPayload(body);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Ungültige Daten" }, { status: 400 });
  }
  // Der Speicher im Browser gehört zu einem Konto; nach einem Kontowechsel nicht ins neue Konto schreiben
  const owner = (body as { userId?: unknown }).userId;
  if (owner !== undefined && owner !== user.id) {
    return Response.json({ error: "Anderes Konto angemeldet" }, { status: 409 });
  }
  await applySync(user.id, payload);
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
