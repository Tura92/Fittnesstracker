import { Suspense } from "react";
import { LocalWorkout } from "@/components/local-workout";

/**
 * Trainingsseite ohne Serverdaten: Die Einheit kommt aus dem Speicher im Handy
 * (oder einmalig vom Server). So lässt sie sich auch ohne Empfang öffnen.
 */
export default function EinheitPage() {
  return (
    <Suspense fallback={<p className="text-muted">Lädt…</p>}>
      <LocalWorkout />
    </Suspense>
  );
}
