import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Übungen mit Haupt- (zählt 1,0) und bis zu zwei Nebenmuskelgruppen (je 0,5). */
export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  primaryMuscle: text("primary_muscle").notNull(),
  secondaryMuscle1: text("secondary_muscle_1"),
  secondaryMuscle2: text("secondary_muscle_2"),
  note: text("note"),
  /** Voreingestellte Pause nach einem Satz, in Sekunden. Leer = aus dem Plan ableiten. */
  restSeconds: integer("rest_seconds"),
});

/** Ein Trainingstag im Plan, z. B. "Tag 1 – Oberkörper A". */
export const planDays = pgTable("plan_days", {
  id: serial("id").primaryKey(),
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
});

/** Eine Übung im Plan eines Tages mit Zielvorgaben. */
export const planItems = pgTable("plan_items", {
  id: serial("id").primaryKey(),
  planDayId: integer("plan_day_id")
    .notNull()
    .references(() => planDays.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id),
  position: integer("position").notNull(),
  sets: integer("sets"),
  reps: text("reps"),
  rir: text("rir"),
  rest: text("rest"),
});

/** Eine Trainingseinheit an einem Datum (Excel: Datum + Block + Einheit). */
export const workouts = pgTable("workouts", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  block: integer("block").notNull(),
  dayNumber: integer("day_number"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Eine Übung innerhalb einer Einheit (Excel: eine Zeile im Logbuch). */
export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  workoutId: integer("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id),
  position: integer("position").notNull(),
  rirLast: real("rir_last"),
  /** Nur Satzzahl bekannt, ohne Wdh./Gewicht (so ist Block 1 erfasst). */
  setCount: integer("set_count"),
  note: text("note"),
});

/** Ein einzelner Satz. Gewicht leer = Körpergewicht bzw. unbekannt. */
export const sets = pgTable("sets", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id")
    .notNull()
    .references(() => entries.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  reps: integer("reps"),
  weight: real("weight"),
});

export const bodyWeights = pgTable(
  "body_weights",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    kg: real("kg").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("body_weights_date_idx").on(t.date)],
);

/** Push-Abos der Geräte, auf denen Benachrichtigungen erlaubt wurden. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Laufende bzw. vergangene Pausen-Timer, für den Push bei Ablauf. */
export const restTimers = pgTable("rest_timers", {
  id: serial("id").primaryKey(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  label: text("label"),
  /** Id der verzögerten Nachricht bei QStash, zum Abbrechen */
  messageId: text("message_id"),
  cancelled: boolean("cancelled").notNull().default(false),
  firedAt: timestamp("fired_at", { withTimezone: true }),
});

/** Fehlgeschlagene Anmeldungen je IP-Adresse, für die Sperre gegen Durchprobieren */
export const loginFailures = pgTable(
  "login_failures",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_failures_ip_at_idx").on(t.ip, t.at)],
);
