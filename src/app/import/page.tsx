import { ImportForm } from "@/components/import-form";

export default function ImportPage() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Excel importieren</h1>
      <p className="mb-4 text-sm text-muted">
        Übernimmt Übungen, Trainingsplan, Logbuch und Körpergewicht aus deinem Trainings-Logbuch (.xlsx).
      </p>
      <ImportForm />
    </>
  );
}
