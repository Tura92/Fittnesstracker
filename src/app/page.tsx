import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StartForm } from "@/components/start-form";
import { formatDate, todayIso } from "@/lib/format";
import { getLatestWorkout, getPlanDayOptions, getWorkoutOn } from "@/lib/queries";

export default function Home() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Training</h1>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <StartContent />
      </Suspense>
    </>
  );
}

async function StartContent() {
  await connection();
  const today = todayIso();
  const [days, latest, todays] = await Promise.all([
    getPlanDayOptions(),
    getLatestWorkout(),
    getWorkoutOn(today),
  ]);

  // Nächster Tag der Rotation nach der letzten Einheit
  const lastDay = latest?.dayNumber ?? 0;
  const suggestedDay = days.find((d) => d.number > lastDay)?.number ?? days[0]?.number ?? 1;

  return (
    <div className="space-y-4">
      {todays && (
        <Link
          href={`/training/${todays.id}`}
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
