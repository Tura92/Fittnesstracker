import Link from "next/link";
import { Suspense } from "react";
import { InviteForm } from "@/components/auth-forms";
import { findInvite } from "@/lib/accounts";

/** Einladungslink /einladung?code=…: ein eigenes Konto mit eigenen Daten anlegen */
export default function EinladungPage({ searchParams }: PageProps<"/einladung">) {
  return (
    <div className="mt-16 space-y-4">
      <h1 className="text-2xl font-semibold">Fittnesstracker</h1>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <Invite searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Invite({ searchParams }: { searchParams: PageProps<"/einladung">["searchParams"] }) {
  const code = (await searchParams).code;
  const invite = typeof code === "string" ? await findInvite(code) : null;
  if (!invite) {
    return (
      <>
        <p>Diese Einladung ist abgelaufen oder wurde schon benutzt. Bitte um einen neuen Link.</p>
        <Link href="/login" className="block text-accent">
          Zur Anmeldung
        </Link>
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-muted">
        {invite.inviter} lädt dich ein. Du bekommst ein eigenes Konto; deine Trainings sieht niemand sonst.
      </p>
      <InviteForm code={code as string} inviter={invite.inviter} />
    </>
  );
}
