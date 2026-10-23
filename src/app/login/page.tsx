import { Suspense } from "react";
import { LoginForm, SetupForm } from "@/components/auth-forms";
import { needsSetup } from "@/lib/accounts";

export default function LoginPage() {
  return (
    <div className="mt-16 space-y-4">
      <h1 className="text-2xl font-semibold">Fittnesstracker</h1>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <LoginOrSetup />
      </Suspense>
    </div>
  );
}

async function LoginOrSetup() {
  if (await needsSetup()) return <SetupForm askAppPassword={!!process.env.APP_PASSWORD} />;
  return <LoginForm />;
}
