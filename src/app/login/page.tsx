"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-16 space-y-4">
      <h1 className="text-2xl font-semibold">Fittnesstracker</h1>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Passwort</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          autoFocus
          className="h-12 w-full rounded-xl border border-border bg-surface px-3"
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-xl bg-accent font-semibold text-white disabled:opacity-60 dark:text-zinc-950"
      >
        Anmelden
      </button>
    </form>
  );
}
