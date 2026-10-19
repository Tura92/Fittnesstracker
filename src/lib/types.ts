import type { SetValues } from "./format";

export type SetDTO = SetValues & { id: number };

export type EntryDTO = {
  id: number;
  exerciseId: number;
  exerciseName: string;
  primaryMuscle: string;
  rirLast: number | null;
  setCount: number | null;
  note: string | null;
  /** Pause nach einem Satz in Sekunden: eigene Einstellung, sonst aus dem Plan */
  restSeconds: number;
  sets: SetDTO[];
  target: { sets: number | null; reps: string | null; rir: string | null; rest: string | null } | null;
  previous: { date: string; sets: SetValues[]; setCount: number | null } | null;
};

export type WorkoutDTO = {
  id: number;
  date: string;
  block: number;
  dayNumber: number | null;
  dayTitle: string | null;
  note: string | null;
  entries: EntryDTO[];
};

export type ExerciseOption = { id: number; name: string; primaryMuscle: string };

export type PlanDayOption = { number: number; title: string };
