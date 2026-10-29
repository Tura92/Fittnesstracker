/**
 * Baut Einheiten im Browser zusammen, damit ein Training auch ohne Netz starten kann:
 * Übungen des Plantags, Vorgaben und die Werte vom letzten Mal kommen aus dem Snapshot
 * und aus noch nicht abgeglichenen Einheiten auf dem Handy.
 */
import { parseRestSeconds, type SetValues } from "./format";
import type { EntryDTO, OfflineSnapshot, WorkoutDTO } from "./types";

const DEFAULT_REST_SECONDS = 120;

export function newId(): string {
  return crypto.randomUUID();
}

/** Letzte Ausführung einer Übung vor dieser Einheit, aus Server-Snapshot und lokalen Einheiten */
function previousFor(
  exerciseId: number,
  workout: Pick<WorkoutDTO, "id" | "date">,
  snapshot: OfflineSnapshot,
  localWorkouts: WorkoutDTO[],
): EntryDTO["previous"] {
  const candidates: { workoutId: string; date: string; sets: SetValues[]; setCount: number | null }[] = [
    ...(snapshot.last[exerciseId] ?? []),
  ];
  for (const w of localWorkouts) {
    for (const e of w.entries) {
      if (e.exerciseId !== exerciseId) continue;
      const sets = e.sets.map(({ reps, weight }) => ({ reps, weight }));
      candidates.push({ workoutId: w.id, date: w.date, setCount: e.setCount, sets });
    }
  }
  const best = candidates
    .filter((c) => c.workoutId !== workout.id && c.date <= workout.date && (c.sets.length > 0 || c.setCount))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return best ? { date: best.date, sets: best.sets, setCount: best.setCount } : null;
}

export function makeEntry(
  exerciseId: number,
  workout: Pick<WorkoutDTO, "id" | "date" | "dayNumber">,
  snapshot: OfflineSnapshot,
  localWorkouts: WorkoutDTO[],
): EntryDTO | null {
  const exercise = snapshot.exercises.find((e) => e.id === exerciseId);
  if (!exercise) return null;
  // Vorgabe aus dem Plantag der Einheit, sonst vom ersten anderen Plantag mit dieser Übung
  const inDay = (d: OfflineSnapshot["planDays"][number]) => d.items.find((i) => i.exerciseId === exerciseId);
  const ownDay = snapshot.planDays.find((d) => d.number === workout.dayNumber);
  const item =
    (ownDay && inDay(ownDay)) ??
    [...snapshot.planDays].sort((a, b) => a.number - b.number).map(inDay).find((i) => i !== undefined);
  const target = item ? { sets: item.sets, reps: item.reps, rir: item.rir, rest: item.rest } : null;
  return {
    id: newId(),
    exerciseId,
    exerciseName: exercise.name,
    primaryMuscle: exercise.primaryMuscle,
    rirLast: null,
    setCount: null,
    note: null,
    restSeconds: exercise.restSeconds ?? parseRestSeconds(target?.rest) ?? DEFAULT_REST_SECONDS,
    sets: [],
    target,
    previous: previousFor(exerciseId, workout, snapshot, localWorkouts),
  };
}

/** Neue Einheit mit den Übungen des gewählten Plantags */
export function createWorkout(
  values: { date: string; block: number; dayNumber: number | null },
  snapshot: OfflineSnapshot,
  localWorkouts: WorkoutDTO[],
): WorkoutDTO {
  const day = snapshot.planDays.find((d) => d.number === values.dayNumber);
  const workout = { id: newId(), ...values };
  return {
    ...workout,
    dayTitle: day?.title ?? null,
    note: null,
    entries: (day?.items ?? [])
      .map((i) => makeEntry(i.exerciseId, workout, snapshot, localWorkouts))
      .filter((e): e is EntryDTO => e !== null),
  };
}
