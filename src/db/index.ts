import "server-only";
import { connection } from "next/server";
import { openDb, type Db } from "./client";

const globalForDb = globalThis as unknown as { dbPromise?: Promise<Db> };

/**
 * Datenbank für Server Components und Server Actions. Ruft `connection()` auf,
 * damit Datenbankzugriffe nie in den statischen Prerender rutschen.
 */
export async function getDb(): Promise<Db> {
  await connection();
  globalForDb.dbPromise ??= openDb();
  return globalForDb.dbPromise;
}
