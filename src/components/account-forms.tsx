"use client";

import { useActionState, useState } from "react";
import { changePassword, logout } from "@/app/account-actions";
import { forgetLocalUser } from "@/lib/local-store";
import { Field } from "./auth-forms";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      await logout(sub?.endpoint ?? null);
      await forgetLocalUser();
      window.location.replace("/login");
    } catch {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="h-12 w-full rounded-xl border border-border bg-surface font-semibold disabled:opacity-60"
    >
      Abmelden
    </button>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} key={state?.ok ? "done" : "form"} className="space-y-3">
      <Field label="Bisheriges Passwort" name="current" type="password" autoComplete="current-password" />
      <Field label="Neues Passwort" name="password" type="password" autoComplete="new-password" hint="Mindestens 8 Zeichen." />
      <Field label="Neues Passwort wiederholen" name="repeat" type="password" autoComplete="new-password" />
      {state && <p className={`text-sm ${state.ok ? "text-accent" : "text-danger"}`}>{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-xl bg-accent-soft font-semibold text-accent disabled:opacity-60"
      >
        Passwort ändern
      </button>
    </form>
  );
}

/** Link zum Weitergeben: auf dem Handy über Teilen, sonst in die Zwischenablage */
export function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: "Einladung zum Fittnesstracker", url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm" />
      <button type="button" onClick={share} className="h-10 shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-white dark:text-zinc-950">
        {copied ? "Kopiert" : "Teilen"}
      </button>
    </div>
  );
}
