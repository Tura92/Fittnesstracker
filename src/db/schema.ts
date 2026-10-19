import {
  date,
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
