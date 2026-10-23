import { getWorkout } from "@/lib/queries";
import { currentUser } from "@/lib/session";

/** Eine Einheit mit Vorgaben und Werten vom letzten Mal, für die Trainingsseite */
export async function GET(_request: Request, ctx: RouteContext<"/api/workout/[id]">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Ungültige ID" }, { status: 400 });
  const workout = await getWorkout(user.id, id.toLowerCase());
  return workout ? Response.json(workout) : Response.json({ error: "Nicht gefunden" }, { status: 404 });
}
