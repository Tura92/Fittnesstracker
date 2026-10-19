"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cacheServerWorkout, getSnapshot, getWorkout, refreshSnapshot } from "@/lib/local-store";
import type { OfflineSnapshot, WorkoutDTO } from "@/lib/types";
import { WorkoutEditor } from "./workout-editor";

type State =
  | { kind: "loading" }
  | { kind: "missing"; offline: boolean }
  | { kind: "ready"; workout: WorkoutDTO; snapshot: OfflineSnapshot | null };

export function LocalWorkout() {
  const id = useSearchParams().get("id")?.toLowerCase() ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snapshot = (await getSnapshot()) ?? (navigator.onLine ? await refreshSnapshot() : undefined) ?? null;
      // Liegt die Einheit schon im Handy, gilt diese Kopie, sonst einmal vom Server holen
      let workout = (await getWorkout(id))?.doc;
      if (!workout && navigator.onLine) {
        const res = await fetch(`/api/workout/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        if (res?.ok) workout = await cacheServerWorkout((await res.json()) as WorkoutDTO);
      }
      if (cancelled) return;
      setState(workout ? { kind: "ready", workout, snapshot } : { kind: "missing", offline: !navigator.onLine });
    })();
    return () => {
      cancelled = true;
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
  return <WorkoutEditor key={state.workout.id} initial={state.workout} snapshot={state.snapshot} />;
}
