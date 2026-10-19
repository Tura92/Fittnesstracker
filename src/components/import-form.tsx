"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { importExcel } from "@/app/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importExcel, null);
  return (
    <form
      // Ohne form action, damit React die gewählte Datei nach einem Fehler nicht zurücksetzt
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
    >
      <input
        type="file"
        name="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        required
        className="block w-full rounded-xl border border-border bg-surface p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:font-semibold file:text-accent"
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="replace" className="mt-0.5 size-4" />
        <span>Vorhandene Daten ersetzen. Alles, was schon in der App steht, wird dabei gelöscht.</span>
      </label>
      {state && (
        <p className={`rounded-lg p-2 text-sm ${state.ok ? "bg-accent-soft text-accent" : "bg-danger/10 text-danger"}`}>
          {state.message}
          {!state.ok && state.message.includes("Einheiten") && " Setz den Haken, um sie zu ersetzen."}
        </p>
      )}
      {state?.ok ? (
        <Link href="/" className="flex h-12 items-center justify-center rounded-xl bg-accent font-semibold text-white dark:text-zinc-950">
          Zum Training
        </Link>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="h-12 w-full rounded-xl bg-accent font-semibold text-white disabled:opacity-60 dark:text-zinc-950"
        >
          {pending ? "Importiert…" : "Importieren"}
        </button>
      )}
    </form>
  );
}
