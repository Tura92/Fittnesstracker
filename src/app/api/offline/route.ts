import { getOfflineSnapshot } from "@/lib/queries";

/** Übungen, Plan und letzte Werte, damit das Training auch ohne Netz startet */
export async function GET() {
  return Response.json(await getOfflineSnapshot());
}
