"use client";

import { useState, type FormEvent } from "react";
import { acceptInvite, login, setupOwner, type AuthResult } from "@/app/account-actions";
import { signedIn } from "@/lib/local-store";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  autoFocus,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        type={type}
        name={name}
        autoComplete={autoComplete}
        required
        autoFocus={autoFocus}
        autoCapitalize={type === "text" ? "words" : undefined}
        className="h-12 w-full rounded-xl border border-border bg-surface px-3"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-12 w-full rounded-xl bg-accent font-semibold text-white disabled:opacity-60 dark:text-zinc-950"
    >
      {children}
    </button>
  );
}

/**
 * Formular für Anmeldung bzw. neues Konto. Ohne form action, damit React die Eingaben nach
 * einem Fehler nicht leert. Nach Erfolg den Speicher des Kontos wählen und die App frisch laden;
 * das läuft auch dann zu Ende, wenn die Seite das Formular inzwischen austauscht (Ersteinrichtung).
 */
function useAuthForm(action: (prev: AuthResult, formData: FormData) => Promise<AuthResult>) {
  const [state, setState] = useState<AuthResult>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await action(state, new FormData(e.currentTarget));
      if (result && "userId" in result) {
        await signedIn(result.userId);
        window.location.replace("/");
        return;
      }
      setState(result);
    } catch {
      setState({ error: "Keine Verbindung. Bitte erneut versuchen." });
    }
    setBusy(false);
  };
  return { state, onSubmit, busy };
}

function ErrorText({ state }: { state: AuthResult }) {
  return state && "error" in state ? <p className="text-sm text-danger">{state.error}</p> : null;
}

export function LoginForm() {
  const { state, onSubmit, busy } = useAuthForm(login);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Name" name="name" autoComplete="username" autoFocus />
      <Field label="Passwort" name="password" type="password" autoComplete="current-password" />
      <ErrorText state={state} />
      <SubmitButton pending={busy}>Anmelden</SubmitButton>
    </form>
  );
}

/** Erstes Konto: übernimmt alle bisherigen Daten */
export function SetupForm({ askAppPassword }: { askAppPassword: boolean }) {
  const { state, onSubmit, busy } = useAuthForm(setupOwner);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted">
        Die App hat jetzt eigene Konten. Leg dein Konto an; alle bisherigen Daten gehören dann dir.
      </p>
      {askAppPassword && (
        <Field
          label="Bisheriges App-Passwort"
          name="appPassword"
          type="password"
          autoComplete="current-password"
          autoFocus
          hint="Das gemeinsame Passwort von bisher, als Nachweis, dass du es bist."
        />
      )}
      <Field label="Dein Name" name="name" autoComplete="username" autoFocus={!askAppPassword} hint="Damit meldest du dich künftig an." />
      <Field label="Neues Passwort" name="password" type="password" autoComplete="new-password" hint="Mindestens 8 Zeichen." />
      <Field label="Passwort wiederholen" name="repeat" type="password" autoComplete="new-password" />
      <ErrorText state={state} />
      <SubmitButton pending={busy}>Konto anlegen</SubmitButton>
    </form>
  );
}

export function InviteForm({ code, inviter }: { code: string; inviter: string }) {
  const { state, onSubmit, busy } = useAuthForm(acceptInvite.bind(null, code));
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Dein Name" name="name" autoComplete="username" autoFocus hint="Damit meldest du dich künftig an." />
      <Field label="Passwort" name="password" type="password" autoComplete="new-password" hint="Mindestens 8 Zeichen." />
      <Field label="Passwort wiederholen" name="repeat" type="password" autoComplete="new-password" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="copyPlan" defaultChecked className="mt-0.5 size-4" />
        <span>
          Übungen und Trainingsplan von {inviter} als Startpunkt übernehmen. Das Logbuch von {inviter} bleibt privat; du
          kannst alles danach ändern oder dein eigenes Excel-Logbuch importieren.
        </span>
      </label>
      <ErrorText state={state} />
      <SubmitButton pending={busy}>Konto anlegen</SubmitButton>
    </form>
  );
}
