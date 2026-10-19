"use server";

import { asc, eq, max } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { entries, exercises, planDays, planItems, sets, workouts } from "@/db/schema";
import { AUTH_COOKIE, authEnabled, isValidSession, safeEqual, sessionToken } from "@/lib/auth";
import { DEFAULT_REST_SECONDS } from "@/lib/queries";
import type { EntryDTO } from "@/lib/types";

async function requireAuth() {
  const jar = await cookies();
  if (!(await isValidSession(jar.get(AUTH_COOKIE)?.value))) throw new Error("Nicht angemeldet");
}

function intOrNull(v: unknown, min: number, maxValue: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > maxValue) throw new Error(`Ungültiger Wert: ${v}`);
  return n;
}

function numOrNull(v: unknown, min: number, maxValue: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > maxValue) throw new Error(`Ungültiger Wert: ${v}`);
  return n;
}

function isoDate(v: unknown): string {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Ungültiges Datum");
  return s;
}

function textOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s.slice(0, 2000);
}

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  if (!authEnabled()) redirect("/");
  const password = String(formData.get("password") ?? "");
  if (!safeEqual(password, process.env.APP_PASSWORD ?? "")) return "Passwort stimmt nicht.";
  (await cookies()).set(AUTH_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

/** Legt eine Einheit an und übernimmt die Übungen des gewählten Plantags. */
export async function startWorkout(formData: FormData) {
  await requireAuth();
  const db = await getDb();
  const date = isoDate(formData.get("date"));
  const block = intOrNull(formData.get("block"), 1, 999) ?? 1;
  const dayNumber = intOrNull(formData.get("day"), 1, 99);

  const id = await db.transaction(async (tx) => {
    const [w] = await tx.insert(workouts).values({ date, block, dayNumber }).returning({ id: workouts.id });
    if (dayNumber !== null) {
      const items = await tx
        .select({ exerciseId: planItems.exerciseId })
        .from(planItems)
        .innerJoin(planDays, eq(planDays.id, planItems.planDayId))
        .where(eq(planDays.number, dayNumber))
        .orderBy(asc(planItems.position));
      if (items.length > 0) {
        await tx
          .insert(entries)
          .values(items.map((it, i) => ({ workoutId: w.id, exerciseId: it.exerciseId, position: i })));
      }
    }
    return w.id;
  });
  redirect(`/training/${id}`);
}

export async function updateWorkout(
  workoutId: number,
  patch: { date?: string; block?: number; dayNumber?: number | null; note?: string | null },
) {
  await requireAuth();
  const db = await getDb();
  await db
    .update(workouts)
    .set({
      ...(patch.date !== undefined && { date: isoDate(patch.date) }),
      ...(patch.block !== undefined && { block: intOrNull(patch.block, 1, 999) ?? 1 }),
      ...(patch.dayNumber !== undefined && { dayNumber: intOrNull(patch.dayNumber, 1, 99) }),
      ...(patch.note !== undefined && { note: textOrNull(patch.note) }),
    })
    .where(eq(workouts.id, workoutId));
}

export async function deleteWorkout(workoutId: number) {
  await requireAuth();
  const db = await getDb();
  await db.delete(workouts).where(eq(workouts.id, workoutId));
  redirect("/logbuch");
}

export async function addEntry(workoutId: number, exerciseId: number): Promise<EntryDTO> {
  await requireAuth();
  const db = await getDb();
  const [ex] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));
  if (!ex) throw new Error("Übung nicht gefunden");
  const [{ last }] = await db
    .select({ last: max(entries.position) })
    .from(entries)
    .where(eq(entries.workoutId, workoutId));
  const [e] = await db
    .insert(entries)
    .values({ workoutId, exerciseId, position: (last ?? -1) + 1 })
    .returning();
  return {
    id: e.id,
    exerciseId,
    exerciseName: ex.name,
    primaryMuscle: ex.primaryMuscle,
    rirLast: null,
    setCount: null,
    note: null,
    restSeconds: ex.restSeconds ?? DEFAULT_REST_SECONDS,
    sets: [],
    target: null,
    previous: null,
  };
}

export async function updateEntry(entryId: number, patch: { rirLast?: number | null; note?: string | null }) {
  await requireAuth();
  const db = await getDb();
  await db
    .update(entries)
    .set({
      ...(patch.rirLast !== undefined && { rirLast: numOrNull(patch.rirLast, 0, 10) }),
      ...(patch.note !== undefined && { note: textOrNull(patch.note) }),
    })
    .where(eq(entries.id, entryId));
}

export async function deleteEntry(entryId: number) {
  await requireAuth();
  const db = await getDb();
  await db.delete(entries).where(eq(entries.id, entryId));
}

export async function addSet(entryId: number, reps: number | null, weight: number | null): Promise<number> {
  await requireAuth();
  const db = await getDb();
  const [{ last }] = await db.select({ last: max(sets.position) }).from(sets).where(eq(sets.entryId, entryId));
  const [s] = await db
    .insert(sets)
    .values({
      entryId,
      position: (last ?? -1) + 1,
      reps: intOrNull(reps, 0, 1000),
      weight: numOrNull(weight, 0, 2000),
    })
    .returning({ id: sets.id });
  // Sobald echte Sätze da sind, gilt die reine Satzzahl nicht mehr
  await db.update(entries).set({ setCount: null }).where(eq(entries.id, entryId));
  return s.id;
}

export async function updateSet(setId: number, reps: number | null, weight: number | null) {
  await requireAuth();
  const db = await getDb();
  await db
    .update(sets)
    .set({ reps: intOrNull(reps, 0, 1000), weight: numOrNull(weight, 0, 2000) })
    .where(eq(sets.id, setId));
}

export async function deleteSet(setId: number) {
  await requireAuth();
  const db = await getDb();
  await db.delete(sets).where(eq(sets.id, setId));
}

/** Speichert die Pausenzeit als Voreinstellung für eine Übung. */
export async function setExerciseRest(exerciseId: number, seconds: number) {
  await requireAuth();
  const db = await getDb();
  await db
    .update(exercises)
    .set({ restSeconds: intOrNull(seconds, 5, 3600) })
    .where(eq(exercises.id, exerciseId));
}
