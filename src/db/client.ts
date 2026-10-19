import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as schema from "./schema";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * Mit DATABASE_URL (z. B. Supabase) wird Postgres genutzt. Ohne läuft eine
 * lokale PGlite-Datenbank in ./.data, die sich beim Start selbst migriert.
 */
export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare: false, damit der Supabase-Pooler (Transaction-Modus) funktioniert
    return drizzle(postgres(url, { prepare: false }), { schema }) as unknown as Db;
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
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt");
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder });
  await client.end();
}
