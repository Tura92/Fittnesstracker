import { revalidatePath } from "next/cache";
import { applySync, parseSyncPayload, type SyncPayload } from "@/lib/sync-server";

/**
 * Nimmt offline gesammelte Änderungen vom Handy entgegen. Bewusst eine feste URL statt
 * einer Server Action: Deren IDs ändern sich mit jedem Deploy, das Handy kann aber noch
 * stundenlang mit der alten, zwischengespeicherten App laufen.
 */
export async function POST(request: Request) {
  let payload: SyncPayload;
  try {
    payload = parseSyncPayload(await request.json());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Ungültige Daten" }, { status: 400 });
  }
  await applySync(payload);
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
