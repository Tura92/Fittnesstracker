/**
 * Wendet die Migrationen in ./drizzle auf die Postgres-Datenbank an.
 * Mit --optional (so im Build) passiert ohne Datenbank-URL nichts.
 */
import { databaseUrl, migratePostgres } from "../src/db/client";

if (process.argv.includes("--optional") && !databaseUrl()) {
  console.log("Keine Datenbank-URL, Migrationen übersprungen.");
  process.exit(0);
}

migratePostgres().then(
  () => console.log("Migrationen angewendet."),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
