"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import { listWorkouts, startSync, subscribeStatus } from "@/lib/local-store";
import type { WorkoutDTO } from "@/lib/types";

/** Startet den Abgleich, sobald irgendeine Seite der App offen ist */
export function SyncStarter() {
  useEffect(() => startSync(), []);
  return null;
}

/**
 * Einheiten, die nur im Handy liegen (offline angelegt oder geändert). Der Server kennt
 * sie noch nicht, darum zeigen Startseite und Logbuch sie hier zusätzlich an.
 */
export function PendingWorkouts({ exclude = [] }: { exclude?: string[] }) {
  const [pending, setPending] = useState<WorkoutDTO[]>([]);

  useEffect(() => {
    const load = () =>
      listWorkouts()
        .then((records) =>
          setPending(
            records
              .filter((r) => r.dirty && !exclude.includes(r.id))
              .map((r) => r.doc)
              .sort((a, b) => b.date.localeCompare(a.date)),
          ),
        )
        .catch(() => undefined);
    load();
    const unsubscribe = subscribeStatus(load);
    return () => {
      unsubscribe();
    };
    // exclude ist pro Seite fest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pending.length === 0) return null;
  return (
    <div className="space-y-2">
      {pending.map((w) => (
        <Link key={w.id} href={`/einheit?id=${w.id}`} className="block rounded-2xl border border-accent bg-accent-soft p-4">
          <span className="block text-sm text-muted">Nur auf dem Handy, Abgleich folgt bei Empfang</span>
          <span className="block font-semibold">
            {w.dayNumber ? `Tag ${w.dayNumber}` : "Einheit"}
            {w.dayTitle ? ` – ${w.dayTitle}` : ""} · {formatDate(w.date)}
          </span>
        </Link>
      ))}
    </div>
  );
}
