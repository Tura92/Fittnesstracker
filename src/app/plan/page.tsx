import Link from "next/link";
import { Suspense } from "react";
import { PlanDay } from "@/components/plan-day";
import { getExerciseOptions, getPlan } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export default function PlanPage() {
  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Trainingsplan</h1>
        <Link href="/uebungen" className="flex h-10 items-center rounded-xl bg-accent-soft px-3 text-sm font-semibold text-accent">
          Übungen bearbeiten
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted">Übungen sind austauschbar. Platz, Sätze, Wiederholungen und RIR bleiben. Neue Einheiten übernehmen die Reihenfolge.</p>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <PlanDays />
      </Suspense>
    </>
  );
}

async function PlanDays() {
  const userId = (await requireUser()).id;
  const [days, exercises] = await Promise.all([getPlan(userId), getExerciseOptions(userId)]);
  if (days.length === 0) return <p className="text-muted">Noch kein Plan importiert.</p>;
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <PlanDay key={day.number} number={day.number} title={day.title} items={day.items} exercises={exercises} />
      ))}
    </div>
  );
}
