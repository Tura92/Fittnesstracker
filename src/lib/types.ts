import type { SetValues } from "./format";

/** IDs von Einheiten, Übungseinträgen und Sätzen sind UUIDs, damit sie offline entstehen können */
export type SetDTO = SetValues & { id: string };

export type EntryDTO = {
  id: string;
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
  id: string;
  date: string;
  block: number;
  dayNumber: number | null;
  dayTitle: string | null;
  note: string | null;
  entries: EntryDTO[];
};

export type ExerciseOption = { id: number; name: string; primaryMuscle: string };

/** Standardvorgabe einer Übung, falls der Plantag der Einheit keine eigene hat */
export type ExerciseDefaults = { defaultSets: number | null; defaultReps: string | null; defaultRir: string | null };

export type PlanDayOption = { number: number; title: string };

export type ExercisePlanItem = {
  id: number;
  dayNumber: number;
  dayTitle: string;
  sets: number | null;
  reps: string | null;
  rir: string | null;
  rest: string | null;
};

export type ExerciseDetail = ExerciseDefaults & {
  id: number;
  name: string;
  primaryMuscle: string;
  secondaryMuscle1: string | null;
  secondaryMuscle2: string | null;
  note: string | null;
  restSeconds: number | null;
  archived: boolean;
  /** Anzahl der Logbuch-Einträge; mit Einträgen wird beim Löschen nur archiviert */
  entryCount: number;
  planItems: ExercisePlanItem[];
};

/** Was das Handy für das Training ohne Netz braucht; wird bei Empfang aktualisiert */
export type OfflineSnapshot = {
  fetchedAt: string;
  /** Standardvorgaben fehlen in Abzügen von Versionen davor */
  exercises: (ExerciseOption & { restSeconds: number | null } & Partial<ExerciseDefaults>)[];
  planDays: (PlanDayOption & {
    items: { exerciseId: number; sets: number | null; reps: string | null; rir: string | null; rest: string | null }[];
  })[];
  /** Letzte Ausführungen je Übung (neueste zuerst), für die Vorbelegung */
  last: Record<number, { workoutId: string; date: string; sets: SetValues[]; setCount: number | null }[]>;
  latest: { date: string; block: number; dayNumber: number | null } | null;
  /** Konto, dem der Abzug gehört */
  userId?: number;
};
