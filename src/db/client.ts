import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as schema from "./schema";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * Verbindungs-URL aus DATABASE_URL oder, wenn Supabase über die Vercel-Integration
 * verbunden ist, aus POSTGRES_URL. `direct` bevorzugt die Verbindung ohne Pooler (für Migrationen).
 */
export function databaseUrl({ direct = false } = {}): string | null {
  const env = process.env;
  const raw = (direct ? env.POSTGRES_URL_NON_POOLING : undefined) ?? env.DATABASE_URL ?? env.POSTGRES_URL;
  if (!raw) return null;
  // Die Vercel-Integration hängt Parameter an (supa, pgbouncer), die Postgres als
  // unbekannte Einstellung ablehnen würde
  const url = new URL(raw);
  url.searchParams.delete("supa");
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

/**
 * Mit DATABASE_URL (z. B. Supabase) wird Postgres genutzt. Ohne läuft eine
 * lokale PGlite-Datenbank in ./.data, die sich beim Start selbst migriert.
 */
export async function openDb(): Promise<Db> {
  const url = databaseUrl();
  if (!url && process.env.VERCEL) {
    throw new Error("Keine Datenbank verbunden: In Vercel unter Storage Supabase verbinden oder DATABASE_URL setzen.");
  }
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare: false, damit der Supabase-Pooler (Transaction-Modus) funktioniert
    // Auf Vercel läuft jede Funktion für sich, eine Verbindung pro Instanz reicht
    const client = postgres(url, { prepare: false, max: process.env.VERCEL ? 1 : 10 });
    return drizzle(client, { schema }) as unknown as Db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  await mkdir(dataDir, { recursive: true });
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export async function migratePostgres() {
  const url = databaseUrl({ direct: true });
  if (!url) throw new Error("DATABASE_URL fehlt");
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder });
  await client.end();
}
