import Link from "next/link";
import { Suspense } from "react";
import { MUSCLE_TARGETS } from "@/lib/analysis";
import { formatDuration } from "@/lib/format";
import { getExerciseList } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import type { ExerciseDetail } from "@/lib/types";

const muscleOrder = new Map(MUSCLE_TARGETS.map((m, i) => [m.muscle, i]));

export default function UebungenPage() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link href="/plan" className="text-sm text-muted">
            ← Plan
          </Link>
          <h1 className="text-2xl font-semibold">Übungen</h1>
        </div>
        <Link
          href="/uebungen/neu"
          className="flex h-11 items-center rounded-xl bg-accent px-4 font-semibold text-white dark:text-zinc-950"
        >
          + Neue Übung
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <ExerciseList />
      </Suspense>
    </>
  );
}

async function ExerciseList() {
  const all = await getExerciseList((await requireUser()).id);
  const active = all.filter((e) => !e.archived);
  const archived = all.filter((e) => e.archived);
  if (all.length === 0) return <p className="text-muted">Noch keine Übungen. Lege die erste mit „+ Neue Übung“ an.</p>;

  const groups = new Map<string, ExerciseDetail[]>();
  for (const e of active) groups.set(e.primaryMuscle, [...(groups.get(e.primaryMuscle) ?? []), e]);
  const sortedGroups = [...groups.entries()].sort(
    ([a], [b]) => (muscleOrder.get(a) ?? 99) - (muscleOrder.get(b) ?? 99) || a.localeCompare(b, "de"),
  );

  return (
    <div className="space-y-4">
      {sortedGroups.map(([muscle, list]) => (
        <section key={muscle}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{muscle}</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {list.map((e) => (
              <ExerciseRow key={e.id} e={e} />
            ))}
          </ul>
        </section>
      ))}
      {archived.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface">
          <summary className="cursor-pointer p-4 text-sm font-medium text-muted">
            Archiviert ({archived.length}): gelöscht, aber im Logbuch erhalten
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {archived.map((e) => (
              <ExerciseRow key={e.id} e={e} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ExerciseRow({ e }: { e: ExerciseDetail }) {
  const secondary = [e.secondaryMuscle1, e.secondaryMuscle2].filter(Boolean).join(", ");
  const plan = e.planItems
    .map((p) => `Tag ${p.dayNumber}${p.sets && p.reps ? `: ${p.sets} × ${p.reps}` : ""}`)
    .join(" · ");
  const standard = [
    e.defaultSets && e.defaultReps ? `${e.defaultSets} × ${e.defaultReps}` : e.defaultReps,
    e.defaultRir && `RIR ${e.defaultRir}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link href={`/uebungen/${e.id}`} className="block px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 font-medium leading-snug">{e.name}</span>
          {e.restSeconds !== null && (
            <span className="shrink-0 text-sm tabular-nums text-muted">Pause {formatDuration(e.restSeconds)}</span>
          )}
        </div>
        <p className="text-sm text-muted">
          {secondary && <>+ {secondary} · </>}
          {plan || "nicht im Plan"}
        </p>
        {standard && <p className="text-sm text-muted">Standard: {standard}</p>}
      </Link>
    </li>
  );
}
