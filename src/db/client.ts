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
    // Mehrere Verbindungen: Vercel bedient parallele Anfragen in derselben Instanz,
    // eine einzelne Verbindung würde hinter einem laufenden Import warten
    const client = postgres(url, { prepare: false, max: 5 });
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
  await enableRlsEverywhere(client);
  await client.end();
}

/**
 * Supabase macht das Schema public über seine REST-API (PostgREST) erreichbar. Ohne RLS
 * könnte jeder mit dem öffentlichen anon-Key dort alle Tabellen lesen und ändern.
 * Die App verbindet als Tabellenbesitzer (postgres) und ist von RLS nicht betroffen.
 * Ohne Policies sperrt RLS darum nur die REST-API aus. Neue Tabellen bekommen RLS über
 * `.enableRLS()` im Schema; dieses Netz fängt eine vergessene Tabelle trotzdem ab.
 */
async function enableRlsEverywhere(client: import("postgres").Sql) {
  const tables = await client<{ name: string }[]>`
    select c.relname as name from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      and pg_get_userbyid(c.relowner) = current_user`;
  for (const { name } of tables) {
    await client.unsafe(`alter table public."${name.replaceAll('"', '""')}" enable row level security`);
    console.log(`RLS für public.${name} nachträglich aktiviert (.enableRLS() im Schema ergänzen).`);
  }
}
