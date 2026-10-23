"use server";

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { invites, loginFailures, pushSubscriptions, users } from "@/db/schema";
import {
  INVITE_DAYS,
  MIN_PASSWORD_LENGTH,
  copyPlanTemplate,
  findInvite,
  nameTaken,
  needsSetup,
  validName,
} from "@/lib/accounts";
import { safeEqual } from "@/lib/auth";
import { currentUser, endSession, hashPassword, requireUserId, startSession, verifyPassword } from "@/lib/session";

/** Ergebnis der Formulare: Fehlertext oder das angemeldete Konto, dessen Speicher der Browser dann nimmt */
export type AuthResult = { error: string } | { userId: number } | null;

/** Nach so vielen Fehlversuchen innerhalb des Zeitfensters ist die IP gesperrt */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function clientIp() {
  const h = await headers();
  // Auf Vercel setzt die Plattform x-forwarded-for, der erste Eintrag ist der Client
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unbekannt";
}

/** Gesperrt: Text mit der Wartezeit, sonst die Zahl der Fehlversuche im Zeitfenster */
async function lockState(ip: string): Promise<{ locked: string } | { recent: number }> {
  const db = await getDb();
  const recent = await db
    .select({ at: loginFailures.at })
    .from(loginFailures)
    .where(eq(loginFailures.ip, ip))
    .orderBy(desc(loginFailures.at))
    .limit(LOGIN_MAX_FAILURES);
  if (recent.length === LOGIN_MAX_FAILURES) {
    const lockedUntil = recent[LOGIN_MAX_FAILURES - 1].at.getTime() + LOGIN_LOCK_MS;
    if (lockedUntil > Date.now()) {
      const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
      return { locked: `Zu viele Fehlversuche. Bitte in ${minutes === 1 ? "1 Minute" : `${minutes} Minuten`} erneut versuchen.` };
    }
  }
  return { recent: recent.filter((r) => r.at.getTime() > Date.now() - LOGIN_LOCK_MS).length };
}

async function recordFailure(ip: string, recent: number, message: string): Promise<AuthResult> {
  const db = await getDb();
  await db.insert(loginFailures).values({ ip });
  await db.delete(loginFailures).where(lt(loginFailures.at, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  return {
    error: recent + 1 < LOGIN_MAX_FAILURES ? message : `${message} Die Anmeldung ist jetzt für 15 Minuten gesperrt.`,
  };
}

function passwordError(password: string, repeat: FormDataEntryValue | null): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
  if (repeat !== null && password !== String(repeat)) return "Die beiden Passwörter stimmen nicht überein.";
  return null;
}

export async function login(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const ip = await clientIp();
  const lock = await lockState(ip);
  if ("locked" in lock) return { error: lock.locked };

  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const db = await getDb();
  const [user] = await db
    .select({ id: users.id, hash: users.passwordHash })
    .from(users)
    .where(sql`lower(${users.name}) = lower(${name})`);
  if (!user || !(await verifyPassword(password, user.hash))) {
    return recordFailure(ip, lock.recent, "Name oder Passwort stimmt nicht.");
  }
  await db.delete(loginFailures).where(eq(loginFailures.ip, ip));
  await startSession(user.id);
  return { userId: user.id };
}

/**
 * Ersteinrichtung: Konto 1 (mit allen Daten aus der Zeit vor den Konten) bekommt Name und
 * Passwort. Online muss dafür das bisherige APP_PASSWORD bekannt sein, sonst könnte jeder,
 * der die Adresse kennt, das Konto übernehmen.
 */
export async function setupOwner(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  if (!(await needsSetup())) return { error: "Die Einrichtung ist schon erledigt. Bitte anmelden." };
  const appPassword = process.env.APP_PASSWORD;
  if (process.env.VERCEL && !appPassword) {
    return { error: "APP_PASSWORD fehlt. Bitte in Vercel unter Settings → Environment Variables setzen und neu deployen." };
  }
  const ip = await clientIp();
  const lock = await lockState(ip);
  if ("locked" in lock) return { error: lock.locked };
  if (appPassword && !safeEqual(String(formData.get("appPassword") ?? ""), appPassword)) {
    return recordFailure(ip, lock.recent, "Das bisherige App-Passwort stimmt nicht.");
  }

  const name = validName(formData.get("name"));
  if (!name) return { error: "Bitte einen Namen mit 2 bis 40 Zeichen eingeben." };
  const password = String(formData.get("password") ?? "");
  const invalid = passwordError(password, formData.get("repeat"));
  if (invalid) return { error: invalid };
  if (await nameTaken(name, 1)) return { error: `Den Namen „${name}“ gibt es schon.` };

  const db = await getDb();
  const [owner] = await db
    .update(users)
    .set({ name, passwordHash: await hashPassword(password), isAdmin: true })
    .where(and(eq(users.id, 1), isNull(users.passwordHash)))
    .returning({ id: users.id });
  if (!owner) return { error: "Die Einrichtung ist schon erledigt. Bitte anmelden." };
  await db.delete(loginFailures).where(eq(loginFailures.ip, ip));
  await startSession(owner.id);
  return { userId: owner.id };
}

/** Neues Konto über einen Einladungslink */
export async function acceptInvite(code: string, _prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const invite = await findInvite(code);
  if (!invite) return { error: "Diese Einladung ist abgelaufen oder wurde schon benutzt." };
  const name = validName(formData.get("name"));
  if (!name) return { error: "Bitte einen Namen mit 2 bis 40 Zeichen eingeben." };
  const password = String(formData.get("password") ?? "");
  const invalid = passwordError(password, formData.get("repeat"));
  if (invalid) return { error: invalid };
  if (await nameTaken(name)) return { error: `Den Namen „${name}“ gibt es schon. Bitte einen anderen wählen.` };
  const copyPlan = formData.get("copyPlan") === "on";

  const db = await getDb();
  const passwordHash = await hashPassword(password);
  let userId: number;
  try {
    userId = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ name, passwordHash }).returning({ id: users.id });
      // Gleichzeitig benutzte Links: nur die erste Annahme zählt
      const [used] = await tx
        .update(invites)
        .set({ usedBy: user.id, usedAt: new Date() })
        .where(and(eq(invites.id, invite.id), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
        .returning({ id: invites.id });
      if (!used) throw new InviteGone();
      if (copyPlan) await copyPlanTemplate(tx, invite.createdBy, user.id);
      return user.id;
    });
  } catch (err) {
    if (err instanceof InviteGone) return { error: "Diese Einladung wurde gerade schon benutzt." };
    throw err;
  }
  await startSession(userId);
  return { userId };
}

class InviteGone extends Error {}

/**
 * Abmelden. Das Push-Abo dieses Geräts wird entfernt, damit der Pausen-Alarm nicht
 * beim nächsten Konto auf dem Gerät landet, bevor es den Alarm selbst erlaubt.
 */
export async function logout(pushEndpoint: string | null) {
  const user = await currentUser();
  if (user && pushEndpoint) {
    const db = await getDb();
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, pushEndpoint)));
  }
  await endSession();
}

export type AccountState = { ok: boolean; message: string } | null;

export async function changePassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const userId = await requireUserId();
  const db = await getDb();
  const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!(await verifyPassword(String(formData.get("current") ?? ""), user?.hash ?? null))) {
    return { ok: false, message: "Das bisherige Passwort stimmt nicht." };
  }
  const password = String(formData.get("password") ?? "");
  const invalid = passwordError(password, formData.get("repeat"));
  if (invalid) return { ok: false, message: invalid };
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  return { ok: true, message: "Passwort geändert." };
}

/** Einladungslink für einen Freund; nur Admins */
export async function createInvite(): Promise<void> {
  const user = await currentUser();
  if (!user?.isAdmin) throw new Error("Nur Admins können einladen");
  const db = await getDb();
  await db.insert(invites).values({
    code: randomBytes(24).toString("base64url"),
    createdBy: user.id,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
  });
  revalidatePath("/konto");
}

export async function revokeInvite(inviteId: number): Promise<void> {
  const user = await currentUser();
  if (!user?.isAdmin) throw new Error("Nur Admins können einladen");
  const db = await getDb();
  await db.delete(invites).where(and(eq(invites.id, inviteId), isNull(invites.usedAt)));
  revalidatePath("/konto");
}
