import { getOfflineSnapshot } from "@/lib/queries";
import { currentUser } from "@/lib/session";

/** Übungen, Plan und letzte Werte, damit das Training auch ohne Netz startet */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
  return Response.json({ ...(await getOfflineSnapshot(user.id)), userId: user.id });
}
