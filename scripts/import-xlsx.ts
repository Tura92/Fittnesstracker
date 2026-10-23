/**
 * Importiert das Excel-Trainingslogbuch in die Datenbank.
 *
 *   npm run import -- pfad/zu/Trainings-Logbuch.xlsx [--replace] [--user=Name]
 *
 * Ohne --user landet alles im ersten Konto (dem, das die Ersteinrichtung bekommt).
 * Ohne DATABASE_URL landet alles in der lokalen PGlite-Datenbank.
 * Online geht das auch direkt in der App unter /import.
 */
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { openDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { ImportError, importWorkbook } from "../src/lib/import-xlsx";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const replace = args.includes("--replace");
  const userName = args.find((a) => a.startsWith("--user="))?.slice("--user=".length);
  if (!file) {
    console.error("Aufruf: npm run import -- <datei.xlsx> [--replace] [--user=Name]");
    process.exit(1);
  }
  const buf = await readFile(file);
  const db = await openDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(userName ? sql`lower(${users.name}) = lower(${userName})` : sql`${users.id} = 1`);
  if (!user) throw new ImportError(`Kein Konto „${userName ?? "1"}“ gefunden.`);
  const r = await importWorkbook(db, user.id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, { replace });
  console.log(`Importiert: ${r.exercises} Übungen, ${r.workouts} Einheiten aus ${r.rows} Logbuch-Zeilen, ${r.weights} Gewichtseinträge.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof ImportError ? `${err.message} (--replace überschreibt vorhandene Daten)` : err);
    process.exit(1);
  },
);
