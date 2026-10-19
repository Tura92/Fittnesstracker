import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, exercises, sets, workouts } from "@/db/schema";
import { intOrNull, isoDate, numOrNull, textOrNull, uuid } from "./validate";

/**
 * Abgleich von Handy und PC: Jede geänderte Einheit kommt als Ganzes und wird mit dem
 * Stand auf dem Server zusammengeführt (gleiche UUID = gleiche Einheit bzw. gleicher Satz).
 * Gelöscht wird nur, was das Gerät ausdrücklich als gelöscht meldet. So gehen Sätze, die
 * ein anderes Gerät inzwischen eingetragen hat, nicht verloren.
 */
export type SyncPayload = {
  workouts: WorkoutPut[];
  deletedWorkouts: string[];
  exerciseRest: { exerciseId: number; seconds: number }[];
};

type WorkoutPut = {
  id: string;
  date: string;
  block: number;
  dayNumber: number | null;
  note: string | null;
  /** Auf dem Gerät entfernte Übungen und Sätze seit dem letzten Abgleich */
  deletedEntries: string[];
  deletedSets: string[];
  entries: {
    id: string;
    exerciseId: number;
    rirLast: number | null;
    setCount: number | null;
    note: string | null;
    sets: { id: string; reps: number | null; weight: number | null }[];
  }[];
};

function list(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error("Ungültige Daten");
  return v;
}

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null) throw new Error("Ungültige Daten");
  return v as Record<string, unknown>;
}

export function parseSyncPayload(body: unknown): SyncPayload {
  const b = obj(body);
  return {
    workouts: list(b.workouts ?? []).map((raw) => {
      const w = obj(raw);
      return {
        id: uuid(w.id),
        date: isoDate(w.date),
        block: intOrNull(w.block, 1, 999) ?? 1,
        dayNumber: intOrNull(w.dayNumber, 1, 99),
        note: textOrNull(w.note),
        deletedEntries: list(w.deletedEntries ?? []).map(uuid),
        deletedSets: list(w.deletedSets ?? []).map(uuid),
        entries: list(w.entries).map((rawEntry) => {
          const e = obj(rawEntry);
          return {
            id: uuid(e.id),
            exerciseId: intOrNull(e.exerciseId, 1, 2 ** 31 - 1)!,
            rirLast: numOrNull(e.rirLast, 0, 10),
            setCount: intOrNull(e.setCount, 0, 100),
            note: textOrNull(e.note),
            sets: list(e.sets).map((rawSet) => {
              const s = obj(rawSet);
              return { id: uuid(s.id), reps: intOrNull(s.reps, 0, 1000), weight: numOrNull(s.weight, 0, 2000) };
            }),
          };
        }),
      };
    }),
    deletedWorkouts: list(b.deletedWorkouts ?? []).map(uuid),
    exerciseRest: list(b.exerciseRest ?? []).map((raw) => {
      const r = obj(raw);
      return { exerciseId: intOrNull(r.exerciseId, 1, 2 ** 31 - 1)!, seconds: intOrNull(r.seconds, 5, 3600)! };
    }),
  };
}

export async function applySync(payload: SyncPayload) {
  const db = await getDb();

  // Einträge zu Übungen, die es nicht mehr gibt, würden den ganzen Abgleich blockieren
  const exerciseIds = [...new Set(payload.workouts.flatMap((w) => w.entries.map((e) => e.exerciseId)))];
  const known = new Set(
    exerciseIds.length === 0
      ? []
      : (await db.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, exerciseIds))).map(
          (r) => r.id,
        ),
  );

  for (const w of payload.workouts) {
    await db.transaction(async (tx) => {
      const [{ id: workoutId }] = await tx
        .insert(workouts)
        .values({ uid: w.id, date: w.date, block: w.block, dayNumber: w.dayNumber, note: w.note })
        .onConflictDoUpdate({
          target: workouts.uid,
          set: { date: w.date, block: w.block, dayNumber: w.dayNumber, note: w.note },
        })
        .returning({ id: workouts.id });

      if (w.deletedEntries.length > 0) {
        await tx.delete(entries).where(and(eq(entries.workoutId, workoutId), inArray(entries.uid, w.deletedEntries)));
      }
      if (w.deletedSets.length > 0) {
        const own = tx.select({ id: entries.id }).from(entries).where(eq(entries.workoutId, workoutId));
        await tx.delete(sets).where(and(inArray(sets.uid, w.deletedSets), inArray(sets.entryId, own)));
      }

      const deletedEntries = new Set(w.deletedEntries);
      const keep = w.entries.filter((e) => known.has(e.exerciseId) && !deletedEntries.has(e.id));
      if (keep.length === 0) return;

      const savedEntries = await tx
        .insert(entries)
        .values(
          keep.map((e, position) => ({
            uid: e.id,
            workoutId,
            exerciseId: e.exerciseId,
            position,
            rirLast: e.rirLast,
            // Sobald echte Sätze da sind, gilt die reine Satzzahl nicht mehr
            setCount: e.sets.length > 0 ? null : e.setCount,
            note: e.note,
          })),
        )
        .onConflictDoUpdate({
          target: entries.uid,
          set: {
            workoutId: sql`excluded.workout_id`,
            exerciseId: sql`excluded.exercise_id`,
            position: sql`excluded.position`,
            rirLast: sql`excluded.rir_last`,
            setCount: sql`excluded.set_count`,
            note: sql`excluded.note`,
          },
        })
        .returning({ id: entries.id, uid: entries.uid });
      const entryIdByUid = new Map(savedEntries.map((e) => [e.uid, e.id]));

      const setRows = keep.flatMap((e) =>
        e.sets.map((s, position) => ({
          uid: s.id,
          entryId: entryIdByUid.get(e.id)!,
          position,
          reps: s.reps,
          weight: s.weight,
        })),
      );
      if (setRows.length > 0) {
        await tx
          .insert(sets)
          .values(setRows)
          .onConflictDoUpdate({
            target: sets.uid,
            set: {
              entryId: sql`excluded.entry_id`,
              position: sql`excluded.position`,
              reps: sql`excluded.reps`,
              weight: sql`excluded.weight`,
            },
          });
      }
    });
  }

  if (payload.deletedWorkouts.length > 0) {
    await db.delete(workouts).where(inArray(workouts.uid, payload.deletedWorkouts));
  }
  for (const r of payload.exerciseRest) {
    await db.update(exercises).set({ restSeconds: r.seconds }).where(eq(exercises.id, r.exerciseId));
  }
}
