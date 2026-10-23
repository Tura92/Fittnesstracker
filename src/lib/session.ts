import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { AUTH_COOKIE, looksLikeSessionToken } from "./auth";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type SessionUser = { id: number; name: string; isAdmin: boolean };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [kind, salt, hash] = stored?.split("$") ?? [];
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Legt eine Sitzung an und setzt das Cookie */
export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const db = await getDb();
  await db.insert(sessions).values({ tokenHash: tokenHash(token), userId });
  (await cookies()).set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (looksLikeSessionToken(token)) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  }
  jar.delete(AUTH_COOKIE);
}

/** Das angemeldete Konto oder null. Einmal pro Anfrage aus der Datenbank. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!looksLikeSessionToken(token)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id, name: users.name, isAdmin: users.isAdmin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash(token)));
  return row ?? null;
});

/** Für Seiten: ohne gültige Sitzung zur Anmeldung */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Für Server Actions und API-Routen: ohne gültige Sitzung ein Fehler statt einer Weiterleitung */
export async function requireUserId(): Promise<number> {
  const user = await currentUser();
  if (!user) throw new Error("Nicht angemeldet");
  return user.id;
}
