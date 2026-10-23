import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Db } from "@/db/client";
import { exercises, invites, planDays, planItems, users } from "@/db/schema";

/** Gültigkeit eines Einladungslinks */
export const INVITE_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 8;

/** Konto 1 hat noch kein Passwort: Die Anmeldeseite zeigt dann die Ersteinrichtung */
export async function needsSetup(): Promise<boolean> {
  const db = await getDb();
  const [owner] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, 1));
  return !!owner && owner.hash === null;
}

export function validName(raw: unknown): string | null {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 40 ? name : null;
}

export async function nameTaken(name: string, exceptUserId?: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.name}) = lower(${name})`);
  return !!row && row.id !== exceptUserId;
}

/** Offene Einladung samt Name dessen, der eingeladen hat; null, wenn benutzt oder abgelaufen */
export async function findInvite(code: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: invites.id, createdBy: invites.createdBy, inviter: users.name })
    .from(invites)
    .innerJoin(users, eq(users.id, invites.createdBy))
    .where(and(eq(invites.code, code), isNull(invites.usedAt), gt(invites.expiresAt, new Date())));
  return row ?? null;
}

/**
 * Übungen und Trainingsplan eines Kontos als Startpunkt in ein neues Konto kopieren.
 * Logbuch und Körpergewicht bleiben privat.
 */
export async function copyPlanTemplate(tx: Pick<Db, "select" | "insert">, fromUserId: number, toUserId: number) {
  const sourceExercises = await tx
    .select()
    .from(exercises)
    .where(and(eq(exercises.userId, fromUserId), eq(exercises.archived, false)))
    .orderBy(asc(exercises.id));
  if (sourceExercises.length === 0) return;
  const copied = await tx
    .insert(exercises)
    .values(
      sourceExercises.map((e) => ({
        userId: toUserId,
        name: e.name,
        primaryMuscle: e.primaryMuscle,
        secondaryMuscle1: e.secondaryMuscle1,
        secondaryMuscle2: e.secondaryMuscle2,
        note: e.note,
        restSeconds: e.restSeconds,
      })),
    )
    .returning({ id: exercises.id, name: exercises.name });
  const byName = new Map(copied.map((e) => [e.name, e.id]));
  const exerciseIds = new Map(sourceExercises.map((e) => [e.id, byName.get(e.name)!]));

  const days = await tx.select().from(planDays).where(eq(planDays.userId, fromUserId));
  if (days.length === 0) return;
  const newDays = await tx
    .insert(planDays)
    .values(days.map((d) => ({ userId: toUserId, number: d.number, title: d.title })))
    .returning({ id: planDays.id, number: planDays.number });
  const dayIds = new Map(newDays.map((d) => [d.number, d.id]));
  const dayNumbers = new Map(days.map((d) => [d.id, d.number]));

  const items = await tx
    .select()
    .from(planItems)
    .innerJoin(planDays, eq(planDays.id, planItems.planDayId))
    .where(eq(planDays.userId, fromUserId));
  const rows = items
    .map(({ plan_items: i }) => ({
      planDayId: dayIds.get(dayNumbers.get(i.planDayId)!)!,
      exerciseId: exerciseIds.get(i.exerciseId),
      position: i.position,
      sets: i.sets,
      reps: i.reps,
      rir: i.rir,
      rest: i.rest,
    }))
    // Archivierte Übungen stehen nicht im Plan; falls doch, fallen sie hier weg
    .filter((i): i is typeof i & { exerciseId: number } => i.exerciseId !== undefined);
  if (rows.length > 0) await tx.insert(planItems).values(rows);
}
