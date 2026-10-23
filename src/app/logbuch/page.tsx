import Link from "next/link";
import { Suspense } from "react";
import { PendingWorkouts } from "@/components/local-workouts";
import { formatDate, formatSets } from "@/lib/format";
import { getLog } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export default function LogbuchPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Logbuch</h1>
      <div className="mb-3">
        <PendingWorkouts />
      </div>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <LogList />
      </Suspense>
    </>
  );
}

async function LogList() {
  const log = await getLog((await requireUser()).id);
  if (log.length === 0) {
    return <p className="text-muted">Noch keine Einheiten. Starte dein erstes Training im Reiter Training.</p>;
  }

  return (
    <div className="space-y-3">
      {log.map((w, i) => {
        const blockHeader = i === 0 || log[i - 1].block !== w.block;
        return (
          <div key={w.id} className="space-y-3">
            {blockHeader && <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted">Block {w.block}</h2>}
            <Link href={`/einheit?id=${w.uid}`} className="block rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {w.dayNumber ? `Tag ${w.dayNumber}` : "Einheit"}
                  {w.dayTitle ? ` – ${w.dayTitle}` : ""}
                </span>
                <span className="shrink-0 text-sm text-muted">{formatDate(w.date, { year: true })}</span>
              </div>
              <ul className="mt-2 space-y-2 text-sm">
                {w.entries.map((e) => (
                  <li key={e.id}>
                    <span className="block">{e.exerciseName}</span>
                    <span className="block text-muted tabular-nums">{formatSets(e.sets, e.setCount)}</span>
                  </li>
                ))}
              </ul>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
