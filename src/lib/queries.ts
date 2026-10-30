import "server-only";
import { and, asc, count, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, exercises, planDays, planItems, sets, workouts } from "@/db/schema";
import { formatDuration, parseRestSeconds } from "./format";
import { MUSCLE_TARGETS, type AnalysisEntry } from "./analysis";
import { defaultTarget } from "./workout-local";
import type { EntryDTO, ExerciseDetail, ExerciseOption, ExercisePlanItem, OfflineSnapshot, PlanDayOption, SetDTO, WorkoutDTO } from "./types";

export const DEFAULT_REST_SECONDS = 120;

/** Alle Abfragen gelten nur für das übergebene Konto, siehe requireUser() in src/lib/session.ts */

/** Plantag zur Einheit: gleiche Nummer im Plan desselben Kontos */
const ownPlanDay = and(eq(planDays.number, workouts.dayNumber), eq(planDays.userId, workouts.userId));

export async function getExerciseOptions(userId: number): Promise<ExerciseOption[]> {
  const db = await getDb();
  return db
    .select({ id: exercises.id, name: exercises.name, primaryMuscle: exercises.primaryMuscle })
    .from(exercises)
    .where(and(eq(exercises.userId, userId), eq(exercises.archived, false)))
    .orderBy(asc(exercises.name));
}

export async function getPlanDayOptions(userId: number): Promise<PlanDayOption[]> {
  const db = await getDb();
  return db
    .select({ number: planDays.number, title: planDays.title })
    .from(planDays)
    .where(eq(planDays.userId, userId))
    .orderBy(asc(planDays.number));
}

export async function getPlan(userId: number) {
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
      restSeconds: exercises.restSeconds,
      exercise: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      secondary1: exercises.secondaryMuscle1,
      secondary2: exercises.secondaryMuscle2,
    })
    .from(planDays)
    .leftJoin(planItems, eq(planItems.planDayId, planDays.id))
    .leftJoin(exercises, eq(exercises.id, planItems.exerciseId))
    .where(eq(planDays.userId, userId))
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
        // Eigene Pausenzeit der Übung geht vor, sonst die Angabe aus dem Plan
        rest: r.restSeconds !== null ? `${formatDuration(r.restSeconds)} min` : r.rest,
        muscles: [r.primaryMuscle, r.secondary1, r.secondary2].filter((m): m is string => !!m),
      });
    }
  }
  return days;
}

export async function getLatestWorkout(userId: number) {
  const db = await getDb();
  const [w] = await db
    .select({ id: workouts.id, date: workouts.date, block: workouts.block, dayNumber: workouts.dayNumber })
    .from(workouts)
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.date), desc(workouts.id))
    .limit(1);
  return w ?? null;
}

export async function getWorkoutOn(userId: number, date: string) {
  const db = await getDb();
  const [w] = await db
    .select({ id: workouts.uid, dayNumber: workouts.dayNumber, title: planDays.title })
    .from(workouts)
    .leftJoin(planDays, ownPlanDay)
    .where(and(eq(workouts.userId, userId), eq(workouts.date, date)))
    .orderBy(desc(workouts.id))
    .limit(1);
  return w ?? null;
}

async function setsByEntry(entryIds: number[]): Promise<Map<number, SetDTO[]>> {
  const result = new Map<number, SetDTO[]>();
  if (entryIds.length === 0) return result;
  const db = await getDb();
  const rows = await db
    .select({ id: sets.uid, entryId: sets.entryId, reps: sets.reps, weight: sets.weight })
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

/** Eine Einheit samt Vorgaben aus dem Plan und den Werten vom letzten Mal, über ihre UUID */
export async function getWorkout(userId: number, uid: string): Promise<WorkoutDTO | null> {
  const db = await getDb();
  const [w] = await db
    .select({
      id: workouts.id,
      uid: workouts.uid,
      date: workouts.date,
      block: workouts.block,
      dayNumber: workouts.dayNumber,
      note: workouts.note,
      dayTitle: planDays.title,
      planDayId: planDays.id,
    })
    .from(workouts)
    .leftJoin(planDays, ownPlanDay)
    .where(and(eq(workouts.userId, userId), eq(workouts.uid, uid)));
  if (!w) return null;

  const entryRows = await db
    .select({
      id: entries.id,
      uid: entries.uid,
      exerciseId: entries.exerciseId,
      exerciseName: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      exerciseRest: exercises.restSeconds,
      defaultSets: exercises.defaultSets,
      defaultReps: exercises.defaultReps,
      defaultRir: exercises.defaultRir,
      rirLast: entries.rirLast,
      setCount: entries.setCount,
      note: entries.note,
    })
    .from(entries)
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(eq(entries.workoutId, w.id))
    .orderBy(asc(entries.position), asc(entries.id));

  const exerciseIds = entryRows.map((e) => e.exerciseId);

  // Vorgabe aus dem Plantag der Einheit; Übungen, die dort nicht stehen, bekommen den Standard der Übung
  const targets = new Map<number, EntryDTO["target"]>();
  if (exerciseIds.length > 0 && w.planDayId !== null) {
    const rows = await db
      .select({
        exerciseId: planItems.exerciseId,
        sets: planItems.sets,
        reps: planItems.reps,
        rir: planItems.rir,
        rest: planItems.rest,
      })
      .from(planItems)
      .where(and(eq(planItems.planDayId, w.planDayId), inArray(planItems.exerciseId, exerciseIds)))
      .orderBy(asc(planItems.position));
    for (const { exerciseId, ...t } of rows) if (!targets.has(exerciseId)) targets.set(exerciseId, t);
  }

  // Letzte frühere Ausführung je Übung, für die Vorbelegung
  const previous = new Map<number, NonNullable<EntryDTO["previous"]>>();
  if (exerciseIds.length > 0) {
    const rows = await db
      .select({ entryId: entries.id, exerciseId: entries.exerciseId, setCount: entries.setCount, date: workouts.date })
      .from(entries)
      .innerJoin(workouts, eq(workouts.id, entries.workoutId))
      .where(
        and(
          eq(workouts.userId, userId),
          inArray(entries.exerciseId, exerciseIds),
          lte(workouts.date, w.date),
          ne(workouts.id, w.id),
        ),
      )
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
    id: w.uid,
    date: w.date,
    block: w.block,
    dayNumber: w.dayNumber,
    dayTitle: w.dayTitle,
    note: w.note,
    entries: entryRows.map(({ exerciseRest, defaultSets, defaultReps, defaultRir, id, uid, ...e }) => {
      const target = targets.get(e.exerciseId) ?? defaultTarget({ defaultSets, defaultReps, defaultRir });
      return {
        ...e,
        id: uid,
        restSeconds: exerciseRest ?? parseRestSeconds(target?.rest) ?? DEFAULT_REST_SECONDS,
        sets: ownSets.get(id) ?? [],
        target,
        previous: previous.get(e.exerciseId) ?? null,
      };
    }),
  };
}

/** Für den Logbuch-Überblick: alle Einheiten, neueste zuerst. */
export async function getLog(userId: number) {
  const db = await getDb();
  const ws = await db
    .select({
      id: workouts.id,
      uid: workouts.uid,
      date: workouts.date,
      block: workouts.block,
      dayNumber: workouts.dayNumber,
      dayTitle: planDays.title,
    })
    .from(workouts)
    .leftJoin(planDays, ownPlanDay)
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.date), desc(workouts.id));

  const es = await db
    .select({
      id: entries.id,
      workoutId: entries.workoutId,
      exerciseName: exercises.name,
      setCount: entries.setCount,
    })
    .from(entries)
    .innerJoin(workouts, eq(workouts.id, entries.workoutId))
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(eq(workouts.userId, userId))
    .orderBy(asc(entries.position), asc(entries.id));
  const allSets = await setsByEntry(es.map((e) => e.id));

  return ws.map((w) => ({
    ...w,
    entries: es
      .filter((e) => e.workoutId === w.id)
      .map((e) => ({ ...e, sets: allSets.get(e.id) ?? [] })),
  }));
}

/** Alle Einträge mit Muskelgruppen und Sätzen, als Grundlage der Auswertung */
export async function getAnalysisEntries(userId: number): Promise<AnalysisEntry[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: entries.id,
      workoutId: workouts.id,
      block: workouts.block,
      date: workouts.date,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      secondaryMuscle1: exercises.secondaryMuscle1,
      secondaryMuscle2: exercises.secondaryMuscle2,
      setCount: entries.setCount,
    })
    .from(entries)
    .innerJoin(workouts, eq(workouts.id, entries.workoutId))
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(eq(workouts.userId, userId))
    .orderBy(asc(workouts.date), asc(entries.position));
  const allSets = await setsByEntry(rows.map((r) => r.id));
  return rows.map(({ id, ...r }) => ({ ...r, sets: allSets.get(id) ?? [] }));
}

async function planItemsByExercise(userId: number, exerciseIds?: number[]): Promise<Map<number, ExercisePlanItem[]>> {
  const db = await getDb();
  const rows = await db
    .select({
      exerciseId: planItems.exerciseId,
      id: planItems.id,
      dayNumber: planDays.number,
      dayTitle: planDays.title,
      sets: planItems.sets,
      reps: planItems.reps,
      rir: planItems.rir,
      rest: planItems.rest,
    })
    .from(planItems)
    .innerJoin(planDays, eq(planDays.id, planItems.planDayId))
    .where(and(eq(planDays.userId, userId), exerciseIds ? inArray(planItems.exerciseId, exerciseIds) : undefined))
    .orderBy(asc(planDays.number), asc(planItems.position));
  const result = new Map<number, ExercisePlanItem[]>();
  for (const { exerciseId, ...item } of rows) {
    const list = result.get(exerciseId) ?? [];
    list.push(item);
    result.set(exerciseId, list);
  }
  return result;
}

async function entryCounts(userId: number, exerciseIds?: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db
    .select({ exerciseId: entries.exerciseId, n: count() })
    .from(entries)
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(and(eq(exercises.userId, userId), exerciseIds ? inArray(entries.exerciseId, exerciseIds) : undefined))
    .groupBy(entries.exerciseId);
  return new Map(rows.map((r) => [r.exerciseId, r.n]));
}

/** Alle Übungen samt Planverwendung, für die Übungsübersicht */
export async function getExerciseList(userId: number): Promise<ExerciseDetail[]> {
  const db = await getDb();
  const [rows, items, counts] = await Promise.all([
    db.select().from(exercises).where(eq(exercises.userId, userId)).orderBy(asc(exercises.name)),
    planItemsByExercise(userId),
    entryCounts(userId),
  ]);
  return rows.map((e) => ({ ...e, entryCount: counts.get(e.id) ?? 0, planItems: items.get(e.id) ?? [] }));
}

export async function getExerciseDetail(userId: number, id: number): Promise<ExerciseDetail | null> {
  const db = await getDb();
  const [e] = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.userId, userId), eq(exercises.id, id)));
  if (!e) return null;
  const [items, counts] = await Promise.all([planItemsByExercise(userId, [id]), entryCounts(userId, [id])]);
  return { ...e, entryCount: counts.get(id) ?? 0, planItems: items.get(id) ?? [] };
}

/** Alle bekannten Muskelgruppen: feste Reihenfolge aus der Auswertung plus eigene */
export async function getMuscleOptions(userId: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({
      primary: exercises.primaryMuscle,
      secondary1: exercises.secondaryMuscle1,
      secondary2: exercises.secondaryMuscle2,
    })
    .from(exercises)
    .where(eq(exercises.userId, userId));
  const known = MUSCLE_TARGETS.map((m) => m.muscle);
  const extra = new Set<string>();
  for (const r of rows) {
    for (const m of [r.primary, r.secondary1, r.secondary2]) if (m && !known.includes(m)) extra.add(m);
  }
  return [...known, ...[...extra].sort((a, b) => a.localeCompare(b, "de"))];
}

/** Alles, was das Training ohne Netz braucht: Übungen, Plan und die letzten Ausführungen */
export async function getOfflineSnapshot(userId: number): Promise<OfflineSnapshot> {
  const db = await getDb();
  const [exerciseRows, plan, latest, recent] = await Promise.all([
    db
      .select({
        id: exercises.id,
        name: exercises.name,
        primaryMuscle: exercises.primaryMuscle,
        restSeconds: exercises.restSeconds,
        defaultSets: exercises.defaultSets,
        defaultReps: exercises.defaultReps,
        defaultRir: exercises.defaultRir,
      })
      .from(exercises)
      .where(and(eq(exercises.userId, userId), eq(exercises.archived, false)))
      .orderBy(asc(exercises.name)),
    db
      .select({
        number: planDays.number,
        title: planDays.title,
        exerciseId: planItems.exerciseId,
        sets: planItems.sets,
        reps: planItems.reps,
        rir: planItems.rir,
        rest: planItems.rest,
      })
      .from(planDays)
      .leftJoin(planItems, eq(planItems.planDayId, planDays.id))
      .where(eq(planDays.userId, userId))
      .orderBy(asc(planDays.number), asc(planItems.position)),
    getLatestWorkout(userId),
    // Je Übung die zwei letzten Ausführungen: eine davon kann die gerade laufende Einheit sein
    db
      .select({
        entryId: entries.id,
        exerciseId: entries.exerciseId,
        setCount: entries.setCount,
        workoutId: workouts.uid,
        date: workouts.date,
        rank: sql<number>`row_number() over (partition by ${entries.exerciseId} order by ${workouts.date} desc, ${workouts.id} desc)`.as("rank"),
      })
      .from(entries)
      .innerJoin(workouts, eq(workouts.id, entries.workoutId))
      .where(eq(workouts.userId, userId)),
  ]);

  const planDaysOut: OfflineSnapshot["planDays"] = [];
  for (const r of plan) {
    let day = planDaysOut.at(-1);
    if (!day || day.number !== r.number) {
      day = { number: r.number, title: r.title, items: [] };
      planDaysOut.push(day);
    }
    if (r.exerciseId !== null) {
      day.items.push({ exerciseId: r.exerciseId, sets: r.sets, reps: r.reps, rir: r.rir, rest: r.rest });
    }
  }

  const recentRows = recent.filter((r) => r.rank <= 2).sort((a, b) => a.rank - b.rank);
  const recentSets = await setsByEntry(recentRows.map((r) => r.entryId));
  const last: OfflineSnapshot["last"] = {};
  for (const r of recentRows) {
    (last[r.exerciseId] ??= []).push({
      workoutId: r.workoutId,
      date: r.date,
      setCount: r.setCount,
      sets: (recentSets.get(r.entryId) ?? []).map(({ reps, weight }) => ({ reps, weight })),
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    exercises: exerciseRows,
    planDays: planDaysOut,
    last,
    latest: latest && { date: latest.date, block: latest.block, dayNumber: latest.dayNumber },
  };
}
