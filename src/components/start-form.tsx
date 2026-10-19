"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSnapshot, listWorkouts, refreshSnapshot, saveWorkout } from "@/lib/local-store";
import type { PlanDayOption } from "@/lib/types";
import { createWorkout } from "@/lib/workout-local";

export function StartForm({
  days,
  suggestedDay,
  block: initialBlock,
  today,
}: {
  days: PlanDayOption[];
  suggestedDay: number;
  block: number;
  today: string;
}) {
  const router = useRouter();
  const [day, setDay] = useState(suggestedDay);
  const [block, setBlock] = useState(initialBlock);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Die Einheit entsteht im Handy, damit der Start auch ohne Empfang klappt
  const start = async (form: HTMLFormElement) => {
    setPending(true);
    setError(null);
    const snapshot = (await getSnapshot()) ?? (await refreshSnapshot());
    if (!snapshot) {
      setError("Der Plan ist noch nicht auf dem Handy. Öffne die App einmal mit Empfang.");
      setPending(false);
      return;
    }
    const date = String(new FormData(form).get("date") || today);
    const local = (await listWorkouts()).map((r) => r.doc);
    const workout = createWorkout({ date, block, dayNumber: day }, snapshot, local);
    await saveWorkout(workout);
    router.push(`/einheit?id=${workout.id}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void start(e.currentTarget);
      }}
      className="space-y-4 rounded-2xl border border-border bg-surface p-4"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">Welcher Tag?</legend>
        <div className="space-y-2">
          {days.map((d) => (
            <label
              key={d.number}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${
                day === d.number ? "border-accent bg-accent-soft" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="day"
                value={d.number}
                checked={day === d.number}
                onChange={() => setDay(d.number)}
                className="sr-only"
              />
              <span className="w-12 shrink-0 font-semibold">Tag {d.number}</span>
              <span className="text-sm">{d.title}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium text-muted">Datum</span>
          <input
            type="date"
            name="date"
            defaultValue={today}
            required
            className="h-12 w-full rounded-xl border border-border bg-transparent px-3"
          />
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium text-muted">Block</span>
          <div className="flex h-12 items-center rounded-xl border border-border">
            <button
              type="button"
              aria-label="Block verringern"
              onClick={() => setBlock((b) => Math.max(1, b - 1))}
              className="h-full w-10 text-xl"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold tabular-nums">{block}</span>
            <button
              type="button"
              aria-label="Block erhöhen"
              onClick={() => setBlock((b) => b + 1)}
              className="h-full w-10 text-xl"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white disabled:opacity-60 dark:text-zinc-950"
      >
        {pending ? "Wird angelegt…" : "Training starten"}
      </button>
    </form>
  );
}
