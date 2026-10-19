import Link from "next/link";
import { Suspense } from "react";
import { getPlan } from "@/lib/queries";

export default function PlanPage() {
  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Trainingsplan</h1>
        <Link href="/uebungen" className="flex h-10 items-center rounded-xl bg-accent-soft px-3 text-sm font-semibold text-accent">
          Übungen bearbeiten
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted">Übungen sind austauschbar. Sätze, Wiederholungen und RIR bleiben.</p>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <PlanDays />
      </Suspense>
    </>
  );
}

async function PlanDays() {
  const days = await getPlan();
  if (days.length === 0) return <p className="text-muted">Noch kein Plan importiert.</p>;
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section key={day.number} className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">
            Tag {day.number} – {day.title}
          </h2>
          <ul className="divide-y divide-border">
            {day.items.map((item) => (
              <li key={item.id} className="py-2">
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
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
