"use server";

import { and, asc, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { exercises, planDays, planItems } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import { intOrNull } from "@/lib/validate";

// Plan bearbeiten geht nur online, wie Übungen verwalten. Das Training übernimmt die Reihenfolge
// über den Offline-Snapshot, sobald eine neue Einheit angelegt wird.

export type PlanActionResult = { error: string } | null;

/** Plantag des Kontos samt seiner Übungen in der jetzigen Reihenfolge */
async function ownDayItems(userId: number, dayNumber: number) {
  const db = await getDb();
  const [day] = await db
    .select({ id: planDays.id })
    .from(planDays)
    .where(and(eq(planDays.userId, userId), eq(planDays.number, dayNumber)));
  if (!day) return null;
  const items = await db
    .select({ id: planItems.id, exerciseId: planItems.exerciseId })
    .from(planItems)
    .where(eq(planItems.planDayId, day.id))
    .orderBy(asc(planItems.position), asc(planItems.id));
  return { dayId: day.id, items };
}

/**
 * Speichert eine neue Reihenfolge der Übungen eines Plantags. `itemIds` muss genau die
 * Übungen des Tags enthalten; die Positionen werden lückenlos neu vergeben.
 */
export async function reorderPlanDay(dayNumber: number, itemIds: number[]): Promise<PlanActionResult> {
  const userId = await requireUserId();
  let ids: number[];
  try {
    intOrNull(dayNumber, 1, 99);
    ids = itemIds.map((v) => intOrNull(v, 1, 2 ** 31 - 1)!);
  } catch {
    return { error: "Ungültige Reihenfolge." };
  }
  const day = await ownDayItems(userId, dayNumber);
  if (!day) return { error: "Diesen Plantag gibt es nicht." };
  const current = new Set(day.items.map((i) => i.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) {
    return { error: "Der Plan wurde inzwischen geändert. Bitte die Seite neu laden." };
  }

  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx
        .update(planItems)
        .set({ position })
        .where(and(eq(planItems.id, id), eq(planItems.planDayId, day.dayId)));
    }
  });
  revalidatePath("/", "layout");
  return null;
}

/**
 * Tauscht die Übung an einer Stelle des Plans gegen eine andere aus.
 * Position und Vorgaben (Sätze, Wdh., RIR, Pause) bleiben, nur die Übung wechselt.
 */
export async function swapPlanExercise(dayNumber: number, itemId: number, exerciseId: number): Promise<PlanActionResult> {
  const userId = await requireUserId();
  try {
    intOrNull(itemId, 1, 2 ** 31 - 1);
    intOrNull(exerciseId, 1, 2 ** 31 - 1);
  } catch {
    return { error: "Ungültige Übung." };
  }
  const day = await ownDayItems(userId, dayNumber);
  const item = day?.items.find((i) => i.id === itemId);
  if (!day || !item) return { error: "Der Plan wurde inzwischen geändert. Bitte die Seite neu laden." };
  if (item.exerciseId === exerciseId) return null;
  if (day.items.some((i) => i.exerciseId === exerciseId)) return { error: "Diese Übung steht schon in diesem Tag." };

  const db = await getDb();
  const [exercise] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId), eq(exercises.archived, false)));
  if (!exercise) return { error: "Diese Übung gibt es nicht." };

  await db
    .update(planItems)
    .set({ exerciseId })
    .where(and(eq(planItems.id, itemId), eq(planItems.planDayId, day.dayId), ne(planItems.exerciseId, exerciseId)));
  revalidatePath("/", "layout");
  return null;
}
