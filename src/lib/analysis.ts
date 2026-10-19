/**
 * Auswertung nach Blöcken, wie im Excel-Blatt "Auswertung":
 * je Übung bestes Gewicht, bestes Volumen pro Satz, Sätze, Volumen und
 * Veränderung zum Vorblock; je Muskelgruppe Sätze pro Woche gegen das Ziel.
 * Ein Satz zählt für den Hauptmuskel 1,0 und für jeden Nebenmuskel 0,5.
 */

export type AnalysisEntry = {
  workoutId: number;
  block: number;
  date: string;
  exerciseId: number;
  exerciseName: string;
  primaryMuscle: string;
  secondaryMuscle1: string | null;
  secondaryMuscle2: string | null;
  /** Reine Satzzahl, wenn keine einzelnen Sätze erfasst sind (Block 1) */
  setCount: number | null;
  sets: { reps: number | null; weight: number | null }[];
};

export type ExerciseStats = {
  exerciseId: number;
  name: string;
  primaryMuscle: string;
  sets: number;
  bestWeight: number | null;
  bestSetVolume: number | null;
  volume: number | null;
  lastDate: string;
  /** Bestes Gewicht minus bestes Gewicht im Block davor, falls es beide gibt */
  weightDelta: number | null;
};

export type MuscleStatus = "unter" | "im" | "über";

export type MuscleStats = {
  muscle: string;
  direct: number;
  total: number;
  perWeek: number;
  target: { min: number; max: number } | null;
  status: MuscleStatus | null;
};

export type BlockAnalysis = {
  block: number;
  /** Anzahl der Einheiten im Block */
  sessions: number;
  weeks: number;
  from: string;
  to: string;
  exercises: ExerciseStats[];
  muscles: MuscleStats[];
};

/** Reihenfolge und Ziele aus dem Excel-Blatt */
export const MUSCLE_TARGETS: { muscle: string; target: { min: number; max: number } | null }[] = [
  { muscle: "Brust", target: { min: 10, max: 20 } },
  { muscle: "Rücken", target: { min: 10, max: 20 } },
  { muscle: "Schulter vorne", target: { min: 10, max: 20 } },
  { muscle: "Schulter seitlich", target: { min: 10, max: 20 } },
  { muscle: "Schulter hinten", target: { min: 10, max: 20 } },
  { muscle: "Bizeps", target: { min: 10, max: 20 } },
  { muscle: "Trizeps", target: { min: 10, max: 20 } },
  { muscle: "Quadrizeps", target: { min: 10, max: 20 } },
  { muscle: "Hamstrings", target: { min: 10, max: 20 } },
  { muscle: "Gesäß", target: { min: 10, max: 20 } },
  { muscle: "Waden", target: { min: 6, max: 12 } },
  { muscle: "Bauch", target: { min: 6, max: 12 } },
  { muscle: "Griff", target: null },
  { muscle: "Sonstiges", target: null },
];

/**
 * Wochen im Block über die Einheiten statt über Kalendertage: Eine Rotation
 * durch alle Plantage ist eine Woche, egal wie viele Tage sie gedauert hat.
 * Gerundet, mindestens 1.
 */
export function weeksInBlock(sessions: number, sessionsPerWeek: number) {
  return Math.max(1, Math.round(sessions / Math.max(1, sessionsPerWeek)));
}

function setsOf(e: AnalysisEntry) {
  return e.sets.length > 0 ? e.sets.length : (e.setCount ?? 0);
}

function statusOf(perWeek: number, target: { min: number; max: number } | null): MuscleStatus | null {
  if (!target) return null;
  if (perWeek < target.min) return "unter";
  if (perWeek > target.max) return "über";
  return "im";
}

/** `sessionsPerWeek`: Einheiten pro Woche, also die Zahl der Plantage */
export function analyzeBlocks(entries: AnalysisEntry[], sessionsPerWeek: number): BlockAnalysis[] {
  const byBlock = new Map<number, AnalysisEntry[]>();
  for (const e of entries) {
    const list = byBlock.get(e.block) ?? [];
    list.push(e);
    byBlock.set(e.block, list);
  }

  const blocks = [...byBlock.keys()].sort((a, b) => a - b);
  const bestWeightByBlock = new Map<number, Map<number, number>>();
  const result: BlockAnalysis[] = [];

  for (const block of blocks) {
    const list = byBlock.get(block)!;
    const dates = list.map((e) => e.date).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    const sessions = new Set(list.map((e) => e.workoutId)).size;
    const weeks = weeksInBlock(sessions, sessionsPerWeek);

    // Je Übung
    const perExercise = new Map<number, ExerciseStats>();
    for (const e of list) {
      const s =
        perExercise.get(e.exerciseId) ??
        ({
          exerciseId: e.exerciseId,
          name: e.exerciseName,
          primaryMuscle: e.primaryMuscle,
          sets: 0,
          bestWeight: null,
          bestSetVolume: null,
          volume: null,
          lastDate: e.date,
          weightDelta: null,
        } satisfies ExerciseStats);
      s.sets += setsOf(e);
      if (e.date > s.lastDate) s.lastDate = e.date;
      for (const set of e.sets) {
        if (set.weight !== null && set.weight > 0) s.bestWeight = Math.max(s.bestWeight ?? 0, set.weight);
        if (set.weight !== null && set.reps !== null) {
          const v = set.weight * set.reps;
          if (v > 0) {
            s.bestSetVolume = Math.max(s.bestSetVolume ?? 0, v);
            s.volume = (s.volume ?? 0) + v;
          }
        }
      }
      perExercise.set(e.exerciseId, s);
    }

    const prev = bestWeightByBlock.get(block - 1);
    const best = new Map<number, number>();
    for (const s of perExercise.values()) {
      if (s.bestWeight !== null) best.set(s.exerciseId, s.bestWeight);
      const before = prev?.get(s.exerciseId);
      if (s.bestWeight !== null && before !== undefined) s.weightDelta = s.bestWeight - before;
    }
    bestWeightByBlock.set(block, best);

    // Je Muskelgruppe
    const direct = new Map<string, number>();
    const indirect = new Map<string, number>();
    const add = (m: Map<string, number>, k: string | null, n: number) => {
      if (k) m.set(k, (m.get(k) ?? 0) + n);
    };
    for (const e of list) {
      const n = setsOf(e);
      add(direct, e.primaryMuscle, n);
      add(indirect, e.secondaryMuscle1, n);
      add(indirect, e.secondaryMuscle2, n);
    }
    const known = new Set(MUSCLE_TARGETS.map((m) => m.muscle));
    const extra = [...new Set([...direct.keys(), ...indirect.keys()])]
      .filter((m) => !known.has(m))
      .sort((a, b) => a.localeCompare(b, "de"))
      .map((muscle) => ({ muscle, target: null }));
    const muscles = [...MUSCLE_TARGETS, ...extra].map(({ muscle, target }) => {
      const d = direct.get(muscle) ?? 0;
      const total = d + 0.5 * (indirect.get(muscle) ?? 0);
      const perWeek = total / weeks;
      return { muscle, direct: d, total, perWeek, target, status: statusOf(perWeek, target) };
    });

    result.push({
      block,
      sessions,
      weeks,
      from,
      to,
      exercises: [...perExercise.values()],
      muscles,
    });
  }
  return result;
}
