"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { deleteExercise, restoreExercise, saveExercise } from "@/app/actions";
import { formatDuration } from "@/lib/format";
import type { ExerciseDetail, PlanDayOption } from "@/lib/types";

const input = "h-11 w-full rounded-xl border border-border bg-background px-3";
const label = "mb-1 block text-sm text-muted";

/** Vorschlag für neue Übungen und neue Plantag-Zeilen */
const SUGGESTED = { sets: 3, reps: "8–12", rir: "1–2" };

/** Anlegen und Bearbeiten einer Übung samt Standardvorgabe und ihren Vorgaben in den Plantagen */
export function ExerciseForm({
  exercise,
  muscles,
  days,
}: {
  exercise: ExerciseDetail | null;
  muscles: string[];
  days: PlanDayOption[];
}) {
  const [state, action, saving] = useActionState(saveExercise.bind(null, exercise?.id ?? null), null);
  const [deleting, startDelete] = useTransition();
  const [addDay, setAddDay] = useState("");
  const usedDays = new Set(exercise?.planItems.map((p) => p.dayNumber));
  const freeDays = days.filter((d) => !usedDays.has(d.number));
  const defaults = exercise
    ? { sets: exercise.defaultSets, reps: exercise.defaultReps, rir: exercise.defaultRir }
    : SUGGESTED;

  const onDelete = () => {
    if (!exercise) return;
    const message =
      exercise.entryCount > 0
        ? `„${exercise.name}“ aus der Übersicht und dem Plan entfernen? ${exercise.entryCount === 1 ? "Der Eintrag" : `Die ${exercise.entryCount} Einträge`} im Logbuch ${exercise.entryCount === 1 ? "bleibt" : "bleiben"} erhalten.`
        : `„${exercise.name}“ endgültig löschen?`;
    if (confirm(message)) startDelete(() => deleteExercise(exercise.id));
  };

  return (
    <form
      // Ohne form action, damit React die Eingaben nach einem Fehler nicht zurücksetzt
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
    >
      {exercise?.archived && (
        <div className="rounded-xl bg-band p-3 text-sm">
          Diese Übung ist archiviert und taucht beim Training nicht auf.{" "}
          <button
            type="button"
            onClick={() => startDelete(() => restoreExercise(exercise.id))}
            className="font-semibold text-accent underline"
          >
            Wiederherstellen
          </button>
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <label className="block">
          <span className={label}>Name</span>
          <input name="name" required maxLength={100} defaultValue={exercise?.name} className={input} />
        </label>
        <label className="block">
          <span className={label}>Hauptmuskel (zählt 1,0)</span>
          <MuscleSelect name="primary" muscles={muscles} value={exercise?.primaryMuscle} required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Nebenmuskel (0,5)</span>
            <MuscleSelect name="secondary1" muscles={muscles} value={exercise?.secondaryMuscle1} />
          </label>
          <label className="block">
            <span className={label}>2. Nebenmuskel</span>
            <MuscleSelect name="secondary2" muscles={muscles} value={exercise?.secondaryMuscle2} />
          </label>
        </div>
        <label className="block">
          <span className={label}>Pause (Min:Sek)</span>
          <input
            name="rest"
            inputMode="numeric"
            placeholder="z. B. 2:30"
            defaultValue={exercise?.restSeconds != null ? formatDuration(exercise.restSeconds) : ""}
            className={input}
          />
          <span className="mt-1 block text-xs text-muted">Leer lassen, um die Pause aus dem Plan zu nehmen.</span>
        </label>
        <label className="block">
          <span className={label}>Notiz</span>
          <textarea
            name="note"
            rows={2}
            defaultValue={exercise?.note ?? ""}
            placeholder="z. B. Sitzhöhe, Griff"
            className="w-full rounded-xl border border-border bg-background p-3"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <div>
          <h2 className="font-semibold">Standardvorgabe</h2>
          <p className="text-sm text-muted">
            Gilt im Training, wenn die Übung nicht im Plantag der Einheit steht. Leer lassen für keine Vorgabe.
          </p>
        </div>
        <TargetInputs prefix="default" sets={defaults.sets} reps={defaults.reps} rir={defaults.rir} />
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="font-semibold">Im Trainingsplan</h2>
        {exercise?.planItems.length === 0 && <p className="text-sm text-muted">Noch in keinem Plantag.</p>}
        {exercise?.planItems.map((p) => (
          <fieldset key={p.id} className="space-y-2 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <input type="hidden" name="items" value={p.id} />
            <legend className="sr-only">Tag {p.dayNumber}</legend>
            <p className="text-sm font-medium">
              Tag {p.dayNumber} – {p.dayTitle}
            </p>
            <TargetInputs prefix={`item-${p.id}`} sets={p.sets} reps={p.reps} rir={p.rir} />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" name={`item-${p.id}-remove`} className="size-4" />
              Aus diesem Tag entfernen
            </label>
          </fieldset>
        ))}
        {freeDays.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <label className="block">
              <span className={label}>Zu einem Plantag hinzufügen</span>
              <select name="addDay" value={addDay} onChange={(e) => setAddDay(e.target.value)} className={input}>
                <option value="">Nicht hinzufügen</option>
                {freeDays.map((d) => (
                  <option key={d.number} value={d.number}>
                    Tag {d.number} – {d.title}
                  </option>
                ))}
              </select>
            </label>
            {addDay && (
              <TargetInputs
                prefix="new"
                sets={defaults.sets ?? SUGGESTED.sets}
                reps={defaults.reps ?? SUGGESTED.reps}
                rir={defaults.rir ?? SUGGESTED.rir}
              />
            )}
          </div>
        )}
      </section>

      {state?.error && <p className="rounded-lg bg-danger/10 p-2 text-sm text-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={saving || deleting}
        className="h-12 w-full rounded-xl bg-accent font-semibold text-white disabled:opacity-60 dark:text-zinc-950"
      >
        {saving ? "Speichert…" : exercise ? "Speichern" : "Übung anlegen"}
      </button>
      {exercise && !exercise.archived && (
        <button
          type="button"
          onClick={onDelete}
          disabled={saving || deleting}
          className="h-12 w-full rounded-xl border border-border font-medium text-danger disabled:opacity-60"
        >
          Übung löschen
        </button>
      )}
    </form>
  );
}

function MuscleSelect({
  name,
  muscles,
  value,
  required = false,
}: {
  name: string;
  muscles: string[];
  value?: string | null;
  required?: boolean;
}) {
  // Eine Muskelgruppe, die es (noch) nicht in der Liste gibt, trotzdem anzeigen
  const options = value && !muscles.includes(value) ? [...muscles, value] : muscles;
  return (
    <select name={name} required={required} defaultValue={value ?? ""} className={input}>
      <option value="">{required ? "Bitte wählen" : "–"}</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

function TargetInputs({
  prefix,
  sets,
  reps,
  rir,
}: {
  prefix: string;
  sets: number | null;
  reps: string | null;
  rir: string | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className="block">
        <span className={label}>Sätze</span>
        <input name={`${prefix}-sets`} inputMode="numeric" defaultValue={sets ?? ""} className={input} />
      </label>
      <label className="block">
        <span className={label}>Wdh.</span>
        <input name={`${prefix}-reps`} defaultValue={reps ?? ""} placeholder="8–12" className={input} />
      </label>
      <label className="block">
        <span className={label}>RIR</span>
        <input name={`${prefix}-rir`} defaultValue={rir ?? ""} placeholder="1–2" className={input} />
      </label>
    </div>
  );
}
