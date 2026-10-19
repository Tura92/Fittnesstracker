"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEntry,
  addSet,
  deleteEntry,
  deleteSet,
  deleteWorkout,
  updateEntry,
  updateSet,
  updateWorkout,
} from "@/app/actions";
import { formatDate, formatDuration, formatSets, parseNumber, type SetValues } from "@/lib/format";
import type { EntryDTO, ExerciseOption, PlanDayOption, WorkoutDTO } from "@/lib/types";
import { PushSetup, useRestTimer } from "./rest-timer";
import { Stepper } from "./stepper";

const SAVE_DELAY_MS = 500;

export function WorkoutEditor({
  workout,
  exercises,
  days,
}: {
  workout: WorkoutDTO;
  exercises: ExerciseOption[];
  days: PlanDayOption[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(workout.entries);
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const [meta, setMeta] = useState({
    date: workout.date,
    block: workout.block,
    dayNumber: workout.dayNumber,
    note: workout.note ?? "",
  });
  const [editingMeta, setEditingMeta] = useState(false);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setSaving((n) => n + 1);
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch {
      setError("Speichern hat nicht geklappt. Prüf die Verbindung und versuch es nochmal.");
      return undefined;
    } finally {
      setSaving((n) => n - 1);
    }
  }, []);

  // Satzänderungen gesammelt speichern, damit nicht jeder Tipp eine Anfrage ist
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => Promise<unknown> }>());
  const schedule = useCallback(
    (key: string, save: () => Promise<unknown>) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        timers.current.delete(key);
        run(save);
      }, SAVE_DELAY_MS);
      timers.current.set(key, { timer, save });
    },
    [run],
  );
  const flush = useCallback(async () => {
    const pending = [...timers.current.values()];
    timers.current.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      await run(p.save);
    }
  }, [run]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  const patchEntry = (entryId: number, fn: (e: EntryDTO) => EntryDTO) =>
    setEntries((list) => list.map((e) => (e.id === entryId ? fn(e) : e)));

  const changeSet = (entryId: number, setId: number, values: SetValues) => {
    patchEntry(entryId, (e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...values } : s)) }));
    schedule(`set-${setId}`, () => updateSet(setId, values.reps, values.weight));
  };

  const appendSets = async (entryId: number, values: SetValues[]) => {
    for (const v of values) {
      const id = await run(() => addSet(entryId, v.reps, v.weight));
      if (id === undefined) return;
      patchEntry(entryId, (e) => ({ ...e, setCount: null, sets: [...e.sets, { id, ...v }] }));
    }
  };

  const removeSet = async (entryId: number, setId: number) => {
    const t = timers.current.get(`set-${setId}`);
    if (t) clearTimeout(t.timer);
    timers.current.delete(`set-${setId}`);
    patchEntry(entryId, (e) => ({ ...e, sets: e.sets.filter((s) => s.id !== setId) }));
    await run(() => deleteSet(setId));
  };

  const removeEntry = async (entry: EntryDTO) => {
    if (entry.sets.length > 0 && !confirm(`${entry.exerciseName} mit allen Sätzen entfernen?`)) return;
    setEntries((list) => list.filter((e) => e.id !== entry.id));
    await run(() => deleteEntry(entry.id));
  };

  const changeEntryMeta = (entryId: number, patch: { rirLast?: number | null; note?: string }) => {
    patchEntry(entryId, (e) => ({ ...e, ...patch }));
    schedule(`entry-${entryId}`, () => {
      const current = entriesRef.current.find((e) => e.id === entryId);
      return updateEntry(entryId, { rirLast: current?.rirLast ?? null, note: current?.note ?? null });
    });
  };

  const changeMeta = (patch: Partial<typeof meta>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    schedule("workout", () => updateWorkout(workout.id, next));
  };

  const finish = async () => {
    await flush();
    router.push("/logbuch");
  };

  const dayTitle = days.find((d) => d.number === meta.dayNumber)?.title;
  const totalSets = entries.reduce((n, e) => n + (e.sets.length || e.setCount || 0), 0);

  return (
    <div className="space-y-3">
      <header className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 pt-1 pb-2 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              {meta.dayNumber ? `Tag ${meta.dayNumber}` : "Einheit"}
              {dayTitle ? ` – ${dayTitle}` : ""}
            </h1>
            <p className="text-sm text-muted">
              {formatDate(meta.date, { year: true })} · Block {meta.block} · {totalSets} Sätze
            </p>
          </div>
          <span className="mt-1 shrink-0 text-xs text-muted" aria-live="polite">
            {saving > 0 ? "Speichert…" : "Gespeichert"}
          </span>
        </div>
        <button type="button" onClick={() => setEditingMeta((v) => !v)} className="text-sm text-accent">
          {editingMeta ? "Fertig" : "Datum, Tag oder Block ändern"}
        </button>
        {error && <p className="mt-2 rounded-lg bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      </header>

      <PushSetup />

      {editingMeta && (
        <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Datum</span>
            <input
              type="date"
              value={meta.date}
              onChange={(e) => e.target.value && changeMeta({ date: e.target.value })}
              className="h-11 w-full rounded-xl border border-border bg-transparent px-3"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-sm text-muted">Tag</span>
              <select
                value={meta.dayNumber ?? ""}
                onChange={(e) => changeMeta({ dayNumber: e.target.value ? Number(e.target.value) : null })}
                className="h-11 w-full rounded-xl border border-border bg-transparent px-2"
              >
                <option value="">ohne Plan</option>
                {days.map((d) => (
                  <option key={d.number} value={d.number}>
                    Tag {d.number} – {d.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-24">
              <span className="mb-1 block text-sm text-muted">Block</span>
              <input
                inputMode="numeric"
                value={meta.block}
                onChange={(e) => {
                  const n = parseNumber(e.target.value);
                  if (n && Number.isInteger(n) && n > 0) changeMeta({ block: n });
                }}
                className="h-11 w-full rounded-xl border border-border bg-transparent px-3"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Notiz zur Einheit</span>
            <textarea
              value={meta.note}
              onChange={(e) => changeMeta({ note: e.target.value })}
              rows={2}
              className="w-full rounded-xl border border-border bg-transparent p-3"
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              if (confirm("Diese Einheit mit allen Übungen löschen?")) await deleteWorkout(workout.id);
            }}
            className="text-sm text-danger"
          >
            Einheit löschen
          </button>
        </section>
      )}

      {entries.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-4 text-center text-muted">
          Noch keine Übungen. Füge unten eine hinzu.
        </p>
      )}

      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onChangeSet={(setId, v) => changeSet(entry.id, setId, v)}
          onAddSets={(values) => appendSets(entry.id, values)}
          onRemoveSet={(setId) => removeSet(entry.id, setId)}
          onRemove={() => removeEntry(entry)}
          onChangeMeta={(patch) => changeEntryMeta(entry.id, patch)}
        />
      ))}

      <AddExercise
        exercises={exercises}
        onAdd={async (exerciseId) => {
          const entry = await run(() => addEntry(workout.id, exerciseId));
          if (entry) setEntries((list) => [...list, entry]);
        }}
      />

      <button
        type="button"
        onClick={finish}
        className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white dark:text-zinc-950"
      >
        Training abschließen
      </button>
    </div>
  );
}

function EntryCard({
  entry,
  onChangeSet,
  onAddSets,
  onRemoveSet,
  onRemove,
  onChangeMeta,
}: {
  entry: EntryDTO;
  onChangeSet: (setId: number, v: SetValues) => void;
  onAddSets: (values: SetValues[]) => Promise<void>;
  onRemoveSet: (setId: number) => void;
  onRemove: () => void;
  onChangeMeta: (patch: { rirLast?: number | null; note?: string }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [showNote, setShowNote] = useState(!!entry.note);
  const restTimer = useRestTimer();
  const rest = restTimer.restFor(entry.exerciseId, entry.restSeconds);
  const { target, previous } = entry;

  const nextSetValues = (): SetValues => {
    const last = entry.sets.at(-1);
    if (last) return { reps: last.reps, weight: last.weight };
    const prev = previous?.sets[0];
    return prev ? { ...prev } : { reps: null, weight: null };
  };

  const add = async (values: SetValues[]) => {
    setAdding(true);
    await onAddSets(values);
    setAdding(false);
  };

  const targetText = target
    ? [
        target.sets && target.reps ? `${target.sets} × ${target.reps}` : target.reps,
        target.rir && `RIR ${target.rir}`,
        target.rest,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold leading-snug">{entry.exerciseName}</h2>
          {targetText && <p className="text-sm text-muted">Ziel: {targetText}</p>}
          {previous && (
            <p className="text-sm text-muted">
              Letztes Mal ({formatDate(previous.date)}): {formatSets(previous.sets, previous.setCount)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${entry.exerciseName} entfernen`}
          className="-mt-1 -mr-2 h-9 w-9 shrink-0 rounded-full text-muted"
        >
          ✕
        </button>
      </div>

      {entry.setCount !== null && entry.sets.length === 0 && (
        <p className="mt-2 text-sm">{entry.setCount} Sätze (nur Satzzahl erfasst)</p>
      )}

      {entry.sets.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2 pl-7 text-xs text-muted">
            <span className="w-[116px] text-center">Wdh.</span>
            <span className="w-[116px] text-center">kg</span>
          </div>
          {entry.sets.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-5 text-center text-sm font-medium text-muted">{i + 1}</span>
              <div className="w-[116px]">
                <Stepper
                  label={`Wiederholungen Satz ${i + 1}`}
                  value={s.reps}
                  step={1}
                  onChange={(reps) => onChangeSet(s.id, { reps, weight: s.weight })}
                />
              </div>
              <div className="w-[116px]">
                <Stepper
                  label={`Gewicht Satz ${i + 1}`}
                  value={s.weight}
                  step={2.5}
                  decimal
                  onChange={(weight) => onChangeSet(s.id, { reps: s.reps, weight })}
                />
              </div>
              <button
                type="button"
                onClick={() => onRemoveSet(s.id)}
                aria-label={`Satz ${i + 1} löschen`}
                className="h-11 w-8 shrink-0 text-muted"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={adding}
          onClick={() => add([nextSetValues()])}
          className="h-11 flex-1 rounded-xl bg-accent-soft font-semibold text-accent disabled:opacity-60"
        >
          + Satz
        </button>
        <button
          type="button"
          onClick={() => restTimer.start(rest, entry.exerciseName, entry.exerciseId)}
          aria-label={`Pause ${formatDuration(rest)} starten`}
          className="h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-medium tabular-nums"
        >
          Pause {formatDuration(rest)}
        </button>
        {entry.sets.length === 0 && previous && previous.sets.length > 0 && (
          <button
            type="button"
            disabled={adding}
            onClick={() => add(previous.sets)}
            className="h-11 flex-1 rounded-xl border border-border text-sm font-medium disabled:opacity-60"
          >
            Wie letztes Mal
          </button>
        )}
      </div>

      {entry.sets.length > 0 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">RIR letzter Satz</span>
            <input
              inputMode="decimal"
              value={entry.rirLast ?? ""}
              placeholder="–"
              onChange={(e) => {
                const n = parseNumber(e.target.value);
                if (e.target.value.trim() === "" || (n !== null && n >= 0 && n <= 10))
                  onChangeMeta({ rirLast: n });
              }}
              className="h-9 w-12 rounded-lg border border-border bg-transparent text-center"
            />
          </label>
          {!showNote && (
            <button type="button" onClick={() => setShowNote(true)} className="text-accent">
              Notiz
            </button>
          )}
        </div>
      )}
      {showNote && (
        <textarea
          value={entry.note ?? ""}
          onChange={(e) => onChangeMeta({ note: e.target.value })}
          placeholder="Notiz zur Übung"
          rows={2}
          className="mt-2 w-full rounded-xl border border-border bg-transparent p-2 text-sm"
        />
      )}
    </section>
  );
}

function AddExercise({
  exercises,
  onAdd,
}: {
  exercises: ExerciseOption[];
  onAdd: (exerciseId: number) => Promise<void>;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ExerciseOption[]>();
    for (const e of exercises) map.set(e.primaryMuscle, [...(map.get(e.primaryMuscle) ?? []), e]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "de"));
  }, [exercises]);

  return (
    <label className="block">
      <span className="sr-only">Übung hinzufügen</span>
      <select
        value=""
        onChange={(e) => e.target.value && onAdd(Number(e.target.value))}
        className="h-12 w-full rounded-xl border border-dashed border-border bg-transparent px-3 text-muted"
      >
        <option value="">+ Übung hinzufügen</option>
        {groups.map(([muscle, list]) => (
          <optgroup key={muscle} label={muscle}>
            {list.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
