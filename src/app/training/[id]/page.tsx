import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkoutEditor } from "@/components/workout-editor";
import { getExerciseOptions, getPlanDayOptions, getWorkout } from "@/lib/queries";

export default function TrainingPage({ params }: PageProps<"/training/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Lädt…</p>}>
      <TrainingContent params={params} />
    </Suspense>
  );
}

async function TrainingContent({ params }: { params: PageProps<"/training/[id]">["params"] }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [workout, exercises, days] = await Promise.all([getWorkout(id), getExerciseOptions(), getPlanDayOptions()]);
  if (!workout) notFound();
  return <WorkoutEditor key={workout.id} workout={workout} exercises={exercises} days={days} />;
}
