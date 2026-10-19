/** Wendet die Migrationen in ./drizzle auf DATABASE_URL an. */
import { migratePostgres } from "../src/db/client";

migratePostgres().then(
  () => console.log("Migrationen angewendet."),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
