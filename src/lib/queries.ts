import "server-only";
import { and, asc, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, exercises, planDays, planItems, sets, workouts } from "@/db/schema";
import { parseRestSeconds } from "./format";
import type { EntryDTO, ExerciseOption, PlanDayOption, SetDTO, WorkoutDTO } from "./types";

export const DEFAULT_REST_SECONDS = 120;

export async function getExerciseOptions(): Promise<ExerciseOption[]> {
  const db = await getDb();
  return db
    .select({ id: exercises.id, name: exercises.name, primaryMuscle: exercises.primaryMuscle })
    .from(exercises)
    .orderBy(asc(exercises.name));
}

export async function getPlanDayOptions(): Promise<PlanDayOption[]> {
  const db = await getDb();
  return db
    .select({ number: planDays.number, title: planDays.title })
    .from(planDays)
    .orderBy(asc(planDays.number));
}

export async function getPlan() {
  const db = await getDb();
  const rows = await db
    .select({
      dayNumber: planDays.number,
      dayTitle: planDays.title,
      itemId: planItems.id,
      sets: planItems.sets,
      reps: planItems.reps,
      rir: planItems.rir,
      rest: planItems.rest,
      exercise: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      secondary1: exercises.secondaryMuscle1,
      secondary2: exercises.secondaryMuscle2,
    })
    .from(planDays)
    .leftJoin(planItems, eq(planItems.planDayId, planDays.id))
    .leftJoin(exercises, eq(exercises.id, planItems.exerciseId))
    .orderBy(asc(planDays.number), asc(planItems.position));

  const days: {
    number: number;
    title: string;
    items: {
      id: number;
      exercise: string;
      sets: number | null;
      reps: string | null;
      rir: string | null;
      rest: string | null;
      muscles: string[];
    }[];
  }[] = [];
  for (const r of rows) {
    let day = days.at(-1);
    if (!day || day.number !== r.dayNumber) {
      day = { number: r.dayNumber, title: r.dayTitle, items: [] };
      days.push(day);
    }
    if (r.itemId !== null && r.exercise !== null) {
      day.items.push({
        id: r.itemId,
        exercise: r.exercise,
        sets: r.sets,
        reps: r.reps,
        rir: r.rir,
        rest: r.rest,
        muscles: [r.primaryMuscle, r.secondary1, r.secondary2].filter((m): m is string => !!m),
      });
    }
  }
  return days;
}

export async function getLatestWorkout() {
  const db = await getDb();
  const [w] = await db
    .select({ id: workouts.id, date: workouts.date, block: workouts.block, dayNumber: workouts.dayNumber })
    .from(workouts)
    .orderBy(desc(workouts.date), desc(workouts.id))
    .limit(1);
  return w ?? null;
}

export async function getWorkoutOn(date: string) {
  const db = await getDb();
  const [w] = await db
    .select({ id: workouts.id, dayNumber: workouts.dayNumber, title: planDays.title })
    .from(workouts)
    .leftJoin(planDays, eq(planDays.number, workouts.dayNumber))
    .where(eq(workouts.date, date))
    .orderBy(desc(workouts.id))
    .limit(1);
  return w ?? null;
}

async function setsByEntry(entryIds: number[]): Promise<Map<number, SetDTO[]>> {
  const result = new Map<number, SetDTO[]>();
  if (entryIds.length === 0) return result;
  const db = await getDb();
  const rows = await db
    .select({ id: sets.id, entryId: sets.entryId, reps: sets.reps, weight: sets.weight })
    .from(sets)
    .where(inArray(sets.entryId, entryIds))
    .orderBy(asc(sets.position), asc(sets.id));
  for (const { entryId, ...s } of rows) {
    const list = result.get(entryId) ?? [];
    list.push(s);
    result.set(entryId, list);
  }
  return result;
}

export async function getWorkout(id: number): Promise<WorkoutDTO | null> {
  const db = await getDb();
  const [w] = await db
    .select({
      id: workouts.id,
      date: workouts.date,
      block: workouts.block,
      dayNumber: workouts.dayNumber,
      note: workouts.note,
      dayTitle: planDays.title,
      planDayId: planDays.id,
    })
    .from(workouts)
    .leftJoin(planDays, eq(planDays.number, workouts.dayNumber))
    .where(eq(workouts.id, id));
  if (!w) return null;

  const entryRows = await db
    .select({
      id: entries.id,
      exerciseId: entries.exerciseId,
      exerciseName: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      exerciseRest: exercises.restSeconds,
      rirLast: entries.rirLast,
      setCount: entries.setCount,
      note: entries.note,
    })
    .from(entries)
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(eq(entries.workoutId, id))
    .orderBy(asc(entries.position), asc(entries.id));

  const exerciseIds = entryRows.map((e) => e.exerciseId);

  const targets = new Map<number, EntryDTO["target"]>();
  if (w.planDayId !== null && exerciseIds.length > 0) {
    const rows = await db
      .select({
        exerciseId: planItems.exerciseId,
        sets: planItems.sets,
        reps: planItems.reps,
        rir: planItems.rir,
        rest: planItems.rest,
      })
      .from(planItems)
      .where(and(eq(planItems.planDayId, w.planDayId), inArray(planItems.exerciseId, exerciseIds)));
    for (const { exerciseId, ...t } of rows) targets.set(exerciseId, t);
  }

  // Letzte frühere Ausführung je Übung, für die Vorbelegung
  const previous = new Map<number, NonNullable<EntryDTO["previous"]>>();
  if (exerciseIds.length > 0) {
    const rows = await db
      .select({ entryId: entries.id, exerciseId: entries.exerciseId, setCount: entries.setCount, date: workouts.date })
      .from(entries)
      .innerJoin(workouts, eq(workouts.id, entries.workoutId))
      .where(and(inArray(entries.exerciseId, exerciseIds), lte(workouts.date, w.date), ne(workouts.id, w.id)))
      .orderBy(desc(workouts.date), desc(workouts.id));
    const prevSets = await setsByEntry(rows.map((r) => r.entryId));
    for (const r of rows) {
      if (previous.has(r.exerciseId)) continue;
      const s = prevSets.get(r.entryId) ?? [];
      if (s.length === 0 && !r.setCount) continue;
      previous.set(r.exerciseId, {
        date: r.date,
        setCount: r.setCount,
        sets: s.map(({ reps, weight }) => ({ reps, weight })),
      });
    }
  }

  const ownSets = await setsByEntry(entryRows.map((e) => e.id));
  return {
    id: w.id,
    date: w.date,
    block: w.block,
    dayNumber: w.dayNumber,
    dayTitle: w.dayTitle,
    note: w.note,
    entries: entryRows.map(({ exerciseRest, ...e }) => {
      const target = targets.get(e.exerciseId) ?? null;
      return {
        ...e,
        restSeconds: exerciseRest ?? parseRestSeconds(target?.rest) ?? DEFAULT_REST_SECONDS,
        sets: ownSets.get(e.id) ?? [],
        target,
        previous: previous.get(e.exerciseId) ?? null,
      };
    }),
  };
}

/** Für den Logbuch-Überblick: alle Einheiten, neueste zuerst. */
export async function getLog() {
  const db = await getDb();
  const ws = await db
    .select({
      id: workouts.id,
      date: workouts.date,
      block: workouts.block,
      dayNumber: workouts.dayNumber,
      dayTitle: planDays.title,
    })
    .from(workouts)
    .leftJoin(planDays, eq(planDays.number, workouts.dayNumber))
    .orderBy(desc(workouts.date), desc(workouts.id));

  const es = await db
    .select({
      id: entries.id,
      workoutId: entries.workoutId,
      exerciseName: exercises.name,
      setCount: entries.setCount,
    })
    .from(entries)
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .orderBy(asc(entries.position), asc(entries.id));
  const allSets = await setsByEntry(es.map((e) => e.id));

  return ws.map((w) => ({
    ...w,
    entries: es
      .filter((e) => e.workoutId === w.id)
      .map((e) => ({ ...e, sets: allSets.get(e.id) ?? [] })),
  }));
}
