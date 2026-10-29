"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { formatDate, formatSets, parseNumber, type SetValues } from "@/lib/format";
import {
  deleteWorkout,
  getServerStatus,
  getStatus,
  listWorkouts,
  saveWorkout,
  subscribeStatus,
  syncNow,
  type SyncStatus,
} from "@/lib/local-store";
import type { EntryDTO, ExerciseOption, OfflineSnapshot, WorkoutDTO } from "@/lib/types";
import { makeEntry, newId } from "@/lib/workout-local";
import { HeaderTimer, PushSetup, RestTimerButton, RestTimerControls } from "./rest-timer";
import { Stepper } from "./stepper";

/** Höchstens so lange wartet "Training abschließen" auf den Abgleich, bevor es weitergeht */
const FINISH_SYNC_TIMEOUT_MS = 4000;

/**
 * Trainingsseite. Arbeitet nur auf der Kopie im Handy: Jede Änderung ist sofort lokal
 * gespeichert und wird im Hintergrund abgeglichen, sobald Netz da ist.
 */
export function WorkoutEditor({ initial, snapshot }: { initial: WorkoutDTO; snapshot: OfflineSnapshot | null }) {
  const router = useRouter();
  const [workout, setWorkout] = useState(initial);
  const [editingMeta, setEditingMeta] = useState(false);
  const sync = useSyncExternalStore(subscribeStatus, getStatus, getServerStatus);
  const days = snapshot?.planDays ?? [];

  // Jede Änderung sofort lokal sichern; der geladene Stand selbst ist schon gesichert
  useEffect(() => {
    if (workout !== initial) void saveWorkout(workout);
  }, [workout, initial]);

  const { entries } = workout;
  const setEntries = (fn: (list: EntryDTO[]) => EntryDTO[]) => setWorkout((w) => ({ ...w, entries: fn(w.entries) }));
  const patchEntry = (entryId: string, fn: (e: EntryDTO) => EntryDTO) =>
    setEntries((list) => list.map((e) => (e.id === entryId ? fn(e) : e)));

  const changeSet = (entryId: string, setId: string, values: SetValues) =>
    patchEntry(entryId, (e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...values } : s)) }));

  const appendSets = async (entryId: string, values: SetValues[]) =>
    patchEntry(entryId, (e) => ({ ...e, setCount: null, sets: [...e.sets, ...values.map((v) => ({ id: newId(), ...v }))] }));

  const removeSet = (entryId: string, setId: string) =>
    patchEntry(entryId, (e) => ({ ...e, sets: e.sets.filter((s) => s.id !== setId) }));

  const removeEntry = (entry: EntryDTO) => {
    if (entry.sets.length > 0 && !confirm(`${entry.exerciseName} mit allen Sätzen entfernen?`)) return;
    setEntries((list) => list.filter((e) => e.id !== entry.id));
  };

  const changeEntryMeta = (entryId: string, patch: { note?: string }) =>
    patchEntry(entryId, (e) => ({ ...e, ...patch }));

  const changeMeta = (patch: Partial<Pick<WorkoutDTO, "date" | "block" | "dayNumber" | "note">>) =>
    setWorkout((w) => ({
      ...w,
      ...patch,
      dayTitle: patch.dayNumber !== undefined ? (days.find((d) => d.number === patch.dayNumber)?.title ?? null) : w.dayTitle,
    }));

  const addExercise = async (exerciseId: number) => {
    if (!snapshot) return;
    const others = (await listWorkouts()).map((r) => r.doc).filter((w) => w.id !== workout.id);
    const entry = makeEntry(exerciseId, workout, snapshot, others);
    if (entry) setEntries((list) => [...list, entry]);
  };

  const remove = async () => {
    if (!confirm("Diese Einheit mit allen Übungen löschen?")) return;
    await deleteWorkout(workout.id);
    router.push("/logbuch");
  };

  const finish = async () => {
    // Mit Netz kurz auf den Abgleich warten, damit das Logbuch die Einheit gleich zeigt
    if (navigator.onLine) {
      await Promise.race([syncNow(), new Promise((r) => setTimeout(r, FINISH_SYNC_TIMEOUT_MS))]);
    }
    router.push("/logbuch");
    router.refresh();
  };

  const totalSets = entries.reduce((n, e) => n + (e.sets.length || e.setCount || 0), 0);

  return (
    <div className="space-y-3">
      <header className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 pt-1 pb-2 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              {workout.dayNumber ? `Tag ${workout.dayNumber}` : "Einheit"}
              {workout.dayTitle ? ` – ${workout.dayTitle}` : ""}
            </h1>
            <p className="text-sm text-muted">
              {formatDate(workout.date, { year: true })} · Block {workout.block} · {totalSets} Sätze
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <SyncLabel status={sync} />
            {/* Platz für die Pausen-Pille ist immer reserviert, damit der Kopf nicht springt */}
            <div className="h-7">
              <HeaderTimer />
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setEditingMeta((v) => !v)} className="text-sm text-accent">
          {editingMeta ? "Fertig" : "Datum, Tag oder Block ändern"}
        </button>
        {sync.error && <p className="mt-2 rounded-lg bg-danger/10 p-2 text-sm text-danger">{sync.error}</p>}
      </header>

      <PushSetup />

      {editingMeta && (
        <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Datum</span>
            <input
              type="date"
              value={workout.date}
              onChange={(e) => e.target.value && changeMeta({ date: e.target.value })}
              className="h-11 w-full rounded-xl border border-border bg-transparent px-3"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-sm text-muted">Tag</span>
              <select
                value={workout.dayNumber ?? ""}
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
                value={workout.block}
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
              value={workout.note ?? ""}
              onChange={(e) => changeMeta({ note: e.target.value })}
              rows={2}
              className="w-full rounded-xl border border-border bg-transparent p-3"
            />
          </label>
          <button type="button" onClick={remove} className="text-sm text-danger">
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

      <AddExercise exercises={snapshot?.exercises ?? []} onAdd={addExercise} />

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

const SYNC_TEXTS = ["✓ Gespeichert", "Gleicht ab…", "Offline gespeichert", "Gespeichert, Abgleich folgt"];

/**
 * Speicherstand in einfachen Worten; gespeichert ist es immer, die Frage ist nur, ob schon auf dem Server.
 * Alle Texte liegen unsichtbar übereinander, damit die Breite fest bleibt und der Kopf beim Statuswechsel nicht springt.
 */
export function SyncLabel({ status }: { status: SyncStatus }) {
  const text =
    status.pending === 0
      ? SYNC_TEXTS[0]
      : status.syncing
        ? SYNC_TEXTS[1]
        : !status.online
          ? SYNC_TEXTS[2]
          : SYNC_TEXTS[3];
  return (
    <span className="mt-1 grid whitespace-nowrap text-right text-xs text-muted">
      {SYNC_TEXTS.map((t) => (
        <span key={t} className={`col-start-1 row-start-1 ${t === text ? "" : "invisible"}`} aria-hidden>
          {t}
        </span>
      ))}
      <span className="sr-only" aria-live="polite">
        {text}
      </span>
    </span>
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
  onChangeSet: (setId: string, v: SetValues) => void;
  onAddSets: (values: SetValues[]) => Promise<void>;
  onRemoveSet: (setId: string) => void;
  onRemove: () => void;
  onChangeMeta: (patch: { note?: string }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [showNote, setShowNote] = useState(!!entry.note);
  const { target, previous } = entry;

  // Satz N übernimmt Satz N vom letzten Mal; gibt es den nicht, den zuletzt erfassten Satz
  const nextSetValues = (): SetValues => {
    const prev = previous?.sets[entry.sets.length];
    if (prev) return { reps: prev.reps, weight: prev.weight };
    const last = entry.sets.at(-1) ?? previous?.sets.at(-1);
    return last ? { reps: last.reps, weight: last.weight } : { reps: null, weight: null };
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
    <section id={`exercise-${entry.exerciseId}`} className="scroll-mt-28 rounded-2xl border border-border bg-surface p-4">
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
                  step={1}
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
        <RestTimerButton exerciseId={entry.exerciseId} label={entry.exerciseName} fallback={entry.restSeconds} />
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
      <RestTimerControls exerciseId={entry.exerciseId} label={entry.exerciseName} />

      {entry.sets.length > 0 && !showNote && (
        <div className="mt-3 text-sm">
          <button type="button" onClick={() => setShowNote(true)} className="h-9 text-accent">
            Notiz
          </button>
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
