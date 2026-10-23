import Link from "next/link";
import { Suspense } from "react";
import { ExerciseForm } from "@/components/exercise-form";
import { getMuscleOptions, getPlanDayOptions } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export default function NeueUebungPage() {
  return (
    <>
      <Link href="/uebungen" className="text-sm text-muted">
        ← Übungen
      </Link>
      <h1 className="mb-4 text-2xl font-semibold">Neue Übung</h1>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <NewExercise />
      </Suspense>
    </>
  );
}

async function NewExercise() {
  const { id: userId } = await requireUser();
  const [muscles, days] = await Promise.all([getMuscleOptions(userId), getPlanDayOptions(userId)]);
  return <ExerciseForm exercise={null} muscles={muscles} days={days} />;
}
