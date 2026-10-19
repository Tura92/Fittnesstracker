"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  cacheServerWorkout,
  fetchServerWorkout,
  getSnapshot,
  getWorkout,
  refreshSnapshot,
  syncNow,
} from "@/lib/local-store";
import type { OfflineSnapshot, WorkoutDTO } from "@/lib/types";
import { WorkoutEditor } from "./workout-editor";

/** Wie oft eine offene Einheit nach Änderungen von anderen Geräten schaut */
const REFRESH_MS = 15_000;

type State =
  | { kind: "loading" }
  | { kind: "missing"; offline: boolean }
  | { kind: "ready"; workout: WorkoutDTO; snapshot: OfflineSnapshot | null; version: number };

/** Notizen speichert der Server getrimmt, leer als null */
const text = (s: string | null) => s?.trim() || null;

/** Nur die eingetragenen Daten, ohne Vorgaben und Werte vom letzten Mal, die der Server neu berechnet */
function sameData(a: WorkoutDTO, b: WorkoutDTO) {
  const core = (w: WorkoutDTO) =>
    JSON.stringify([
      w.date,
      w.block,
      w.dayNumber,
      text(w.note),
      w.entries.map((e) => [e.id, e.exerciseId, e.rirLast, e.setCount, text(e.note), e.sets.map((s) => [s.id, s.reps, s.weight])]),
    ]);
  return core(a) === core(b);
}

export function LocalWorkout() {
  const id = useSearchParams().get("id")?.toLowerCase() ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let snapshot: OfflineSnapshot | null = null;

    // Serverstand übernehmen, solange hier nichts Eigenes auf den Abgleich wartet
    const pull = async () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      await syncNow();
      const local = await getWorkout(id);
      if (local?.dirty) return;
      const server = await fetchServerWorkout(id);
      if (cancelled || server === null) return;
      if (server === "missing") {
        if (!local) setState({ kind: "missing", offline: false });
        return;
      }
      if (local && sameData(local.doc, server)) return;
      const workout = await cacheServerWorkout(server);
      // Inzwischen hier eingetippt: dann bleibt der eigene Stand und geht zuerst zum Server
      if (cancelled || workout !== server) return;
      setState((s) => ({
        kind: "ready",
        workout,
        snapshot,
        version: s.kind === "ready" ? s.version + 1 : 0,
      }));
    };

    (async () => {
      snapshot = (await getSnapshot()) ?? (navigator.onLine ? await refreshSnapshot() : undefined) ?? null;
      // Zuerst die Kopie im Handy zeigen, damit es auch ohne Empfang sofort weitergeht
      const local = await getWorkout(id);
      if (cancelled) return;
      if (local) setState({ kind: "ready", workout: local.doc, snapshot, version: 0 });
      await pull();
      if (!cancelled && !local) {
        setState((s) => (s.kind === "loading" ? { kind: "missing", offline: !navigator.onLine } : s));
      }
    })();

    const onVisible = () => void pull();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = setInterval(onVisible, REFRESH_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      clearInterval(timer);
    };
  }, [id]);

  if (state.kind === "loading") return <p className="text-muted">Lädt…</p>;
  if (state.kind === "missing") {
    return (
      <div className="space-y-3">
        <p>
          {state.offline
            ? "Diese Einheit ist nicht auf dem Handy gespeichert und ohne Empfang nicht abrufbar."
            : "Diese Einheit gibt es nicht."}
        </p>
        <Link href="/" className="text-accent">
          Zum Training
        </Link>
      </div>
    );
  }
  // Neuer Stand von einem anderen Gerät: Editor mit den neuen Daten neu aufbauen
  return (
    <WorkoutEditor
      key={`${state.workout.id}:${state.version}`}
      initial={state.workout}
      snapshot={state.snapshot}
    />
  );
}
