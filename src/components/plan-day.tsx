"use client";

import { startTransition, useOptimistic, useState } from "react";
import { reorderPlanDay, swapPlanExercise } from "@/app/plan-actions";
import type { ExerciseOption } from "@/lib/types";

export type PlanDayItem = {
  id: number;
  exerciseId: number;
  exercise: string;
  sets: number | null;
  reps: string | null;
  rir: string | null;
  rest: string | null;
  muscles: string[];
};

const iconButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-lg disabled:opacity-30";

/**
 * Ein Plantag. Mit „Bearbeiten“ lassen sich die Übungen hoch und runter schieben
 * oder an ihrer Stelle gegen eine andere tauschen. Neue Einheiten übernehmen diese Reihenfolge.
 */
export function PlanDay({
  number,
  title,
  items,
  exercises,
}: {
  number: number;
  title: string;
  items: PlanDayItem[];
  exercises: ExerciseOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(items);

  const move = (index: number, by: -1 | 1) => {
    const next = [...shown];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setError(null);
    startTransition(async () => {
      setShown(next);
      const r = await reorderPlanDay(
        number,
        next.map((i) => i.id),
      );
      if (r) setError(r.error);
    });
  };

  const swap = (item: PlanDayItem, exerciseId: number) => {
    const exercise = exercises.find((e) => e.id === exerciseId);
    if (!exercise) return;
    setError(null);
    startTransition(async () => {
      setShown(shown.map((i) => (i.id === item.id ? { ...i, exerciseId, exercise: exercise.name, muscles: [exercise.primaryMuscle] } : i)));
      const r = await swapPlanExercise(number, item.id, exerciseId);
      if (r) setError(r.error);
    });
  };

  const inDay = new Set(shown.map((i) => i.exerciseId));

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          Tag {number} – {title}
        </h2>
        {shown.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="h-9 shrink-0 rounded-lg px-2 text-sm font-semibold text-accent"
          >
            {editing ? "Fertig" : "Bearbeiten"}
          </button>
        )}
      </div>
      {editing && (
        <p className="mb-2 text-sm text-muted">
          Reihenfolge mit ↑ ↓ ändern. Beim Tauschen bleiben Platz, Sätze, Wdh. und RIR.
        </p>
      )}
      {error && <p className="mb-2 rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      {shown.length === 0 && <p className="text-sm text-muted">Keine Übungen.</p>}
      <ul className="divide-y divide-border">
        {shown.map((item, index) => (
          <li key={item.id} className="py-2">
            <div className="flex items-center gap-2">
              {editing && <span className="w-5 shrink-0 text-center text-sm font-medium text-muted">{index + 1}</span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{item.exercise}</span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {item.sets} × {item.reps}
                  </span>
                </div>
                <div className="flex justify-between gap-3 text-sm text-muted">
                  <span className="min-w-0 truncate">{item.muscles.join(", ")}</span>
                  <span className="shrink-0">
                    {[item.rir && `RIR ${item.rir}`, item.rest].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              {editing && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`${item.exercise} nach oben`}
                    className={iconButton}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === shown.length - 1}
                    aria-label={`${item.exercise} nach unten`}
                    className={iconButton}
                  >
                    ↓
                  </button>
                </div>
              )}
            </div>
            {editing && (
              <label className="mt-2 block pl-7">
                <span className="sr-only">{item.exercise} tauschen gegen</span>
                <select
                  value=""
                  onChange={(e) => e.target.value && swap(item, Number(e.target.value))}
                  className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm"
                >
                  <option value="">Tauschen gegen…</option>
                  {exercises
                    .filter((e) => !inDay.has(e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.primaryMuscle})
                      </option>
                    ))}
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
