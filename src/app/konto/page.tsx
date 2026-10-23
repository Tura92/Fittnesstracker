import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { Suspense } from "react";
import { createInvite, revokeInvite } from "@/app/account-actions";
import { InviteLink, LogoutButton, PasswordForm } from "@/components/account-forms";
import { getDb } from "@/db";
import { invites, users } from "@/db/schema";
import { INVITE_DAYS } from "@/lib/accounts";
import { formatDate } from "@/lib/format";
import { requireUser, type SessionUser } from "@/lib/session";

export default function KontoPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Konto</h1>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <Account />
      </Suspense>
    </>
  );
}

async function Account() {
  const user = await requireUser();
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <p>
          Angemeldet als <b>{user.name}</b>
        </p>
        <LogoutButton />
      </section>
      {user.isAdmin && <Invites user={user} />}
      <details className="rounded-2xl border border-border bg-surface">
        <summary className="cursor-pointer p-4 font-medium">Passwort ändern</summary>
        <div className="px-4 pb-4">
          <PasswordForm />
        </div>
      </details>
    </div>
  );
}

async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function Invites({ user }: { user: SessionUser }) {
  const db = await getDb();
  const [open, members, origin] = await Promise.all([
    db
      .select({ id: invites.id, code: invites.code, expiresAt: invites.expiresAt })
      .from(invites)
      .where(and(eq(invites.createdBy, user.id), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt)),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.id)),
    appOrigin(),
  ]);
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Freunde einladen</h2>
      <p className="text-sm text-muted">
        Jeder Link legt genau ein neues Konto an und gilt {INVITE_DAYS} Tage. Wer eingeladen wird, hat eigene Übungen, Plan und
        Logbuch und sieht deine Daten nicht.
      </p>
      {open.map((i) => (
        <div key={i.id} className="space-y-1">
          <InviteLink url={`${origin}/einladung?code=${i.code}`} />
          <div className="flex justify-between text-xs text-muted">
            <span>gültig bis {formatDate(i.expiresAt.toISOString().slice(0, 10))}</span>
            <form action={revokeInvite.bind(null, i.id)}>
              <button type="submit" className="text-danger">
                Zurückziehen
              </button>
            </form>
          </div>
        </div>
      ))}
      <form action={createInvite}>
        <button type="submit" className="h-11 w-full rounded-xl bg-accent-soft font-semibold text-accent">
          Neuen Einladungslink erstellen
        </button>
      </form>
      <p className="text-sm text-muted">Konten: {members.map((m) => m.name).join(", ")}</p>
    </section>
  );
}
