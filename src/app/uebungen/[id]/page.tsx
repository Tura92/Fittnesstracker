import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExerciseForm } from "@/components/exercise-form";
import { getExerciseDetail, getMuscleOptions, getPlanDayOptions } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export default function UebungPage({ params }: PageProps<"/uebungen/[id]">) {
  return (
    <>
      <Link href="/uebungen" className="text-sm text-muted">
        ← Übungen
      </Link>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <EditExercise params={params} />
      </Suspense>
    </>
  );
}

async function EditExercise({ params }: { params: PageProps<"/uebungen/[id]">["params"] }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { id: userId } = await requireUser();
  const [exercise, muscles, days] = await Promise.all([
    getExerciseDetail(userId, id),
    getMuscleOptions(userId),
    getPlanDayOptions(userId),
  ]);
  if (!exercise) notFound();
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{exercise.name}</h1>
      <ExerciseForm key={exercise.id} exercise={exercise} muscles={muscles} days={days} />
    </>
  );
}
