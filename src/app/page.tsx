import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PendingWorkouts } from "@/components/local-workouts";
import { StartForm } from "@/components/start-form";
import { formatDate, todayIso } from "@/lib/format";
import { getLatestWorkout, getPlanDayOptions, getWorkoutOn } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export default function Home() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Training</h1>
        <Link href="/konto" className="flex h-10 items-center rounded-xl bg-accent-soft px-3 text-sm font-semibold text-accent">
          Konto
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <StartContent />
      </Suspense>
    </>
  );
}

async function StartContent() {
  await connection();
  const { id: userId } = await requireUser();
  const today = todayIso();
  const [days, latest, todays] = await Promise.all([
    getPlanDayOptions(userId),
    getLatestWorkout(userId),
    getWorkoutOn(userId, today),
  ]);

  // Nächster Tag der Rotation nach der letzten Einheit
  const lastDay = latest?.dayNumber ?? 0;
  const suggestedDay = days.find((d) => d.number > lastDay)?.number ?? days[0]?.number ?? 1;

  return (
    <div className="space-y-4">
      {!latest && (
        <Link href="/import" className="block rounded-2xl border border-border bg-surface p-4">
          <span className="block font-semibold">Noch keine Daten</span>
          <span className="block text-sm text-accent">Excel-Logbuch importieren</span>
        </Link>
      )}
      <PendingWorkouts exclude={todays ? [todays.id] : []} />
      {todays && (
        <Link
          href={`/einheit?id=${todays.id}`}
          className="block rounded-2xl bg-accent p-4 text-white dark:text-zinc-950"
        >
          <span className="block text-sm opacity-80">Heute schon begonnen</span>
          <span className="block text-lg font-semibold">
            {todays.dayNumber ? `Tag ${todays.dayNumber} – ${todays.title ?? ""}` : "Einheit"} fortsetzen
          </span>
        </Link>
      )}
      <StartForm days={days} suggestedDay={suggestedDay} block={latest?.block ?? 1} today={today} />
      {latest && (
        <p className="text-center text-sm text-muted">
          Zuletzt: {formatDate(latest.date)}
          {latest.dayNumber ? `, Tag ${latest.dayNumber}` : ""} · Block {latest.block}
        </p>
      )}
    </div>
  );
}
