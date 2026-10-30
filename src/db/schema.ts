import { sql } from "drizzle-orm";
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
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Nutzerkonten. Jedes Konto hat eigene Übungen, Plan, Logbuch und Push-Abos.
 * Konto 1 ist der ursprüngliche Besitzer: Ihm gehören die Daten aus der Zeit vor den Konten,
 * sein Passwort setzt er bei der Ersteinrichtung.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** scrypt-Hash; leer, solange die Ersteinrichtung aussteht */
    passwordHash: text("password_hash"),
    /** Darf Freunde einladen */
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_name_idx").on(sql`lower(${t.name})`)],
);

/** Angemeldete Geräte. Im Cookie steht ein Zufallstoken, hier nur dessen Hash. */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Einladungslinks für neue Konten, je einmal nutzbar und befristet */
export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedBy: integer("used_by").references(() => users.id, { onDelete: "set null" }),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// Standardwert 1 nur für den Übergang, siehe drizzle/0006_konten_uebergang.sql; der Code setzt userId immer
const owner = () =>
  integer("user_id")
    .notNull()
    .default(1)
    .references(() => users.id, { onDelete: "cascade" });

/** Übungen mit Haupt- (zählt 1,0) und bis zu zwei Nebenmuskelgruppen (je 0,5). */
export const exercises = pgTable(
  "exercises",
  {
    id: serial("id").primaryKey(),
    userId: owner(),
    name: text("name").notNull(),
    primaryMuscle: text("primary_muscle").notNull(),
    secondaryMuscle1: text("secondary_muscle_1"),
    secondaryMuscle2: text("secondary_muscle_2"),
    note: text("note"),
    /** Voreingestellte Pause nach einem Satz, in Sekunden. Leer = aus dem Plan ableiten. */
    restSeconds: integer("rest_seconds"),
    /** Standardvorgabe der Übung, gilt im Training, wenn der Plantag der Einheit selbst keine Vorgabe hat */
    defaultSets: integer("default_sets"),
    defaultReps: text("default_reps"),
    defaultRir: text("default_rir"),
    /** Gelöschte Übungen mit Logbuch-Einträgen bleiben für die Historie erhalten, sind aber ausgeblendet */
    archived: boolean("archived").notNull().default(false),
  },
  (t) => [uniqueIndex("exercises_user_name_idx").on(t.userId, t.name)],
);

/** Ein Trainingstag im Plan, z. B. "Tag 1 – Oberkörper A". */
export const planDays = pgTable(
  "plan_days",
  {
    id: serial("id").primaryKey(),
    userId: owner(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
  },
  (t) => [uniqueIndex("plan_days_user_number_idx").on(t.userId, t.number)],
);

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
export const workouts = pgTable(
  "workouts",
  {
    id: serial("id").primaryKey(),
    userId: owner(),
    /** Im Browser erzeugte ID, damit Einheiten auch offline angelegt und später abgeglichen werden können */
    uid: uuid("uid").notNull().defaultRandom().unique(),
    date: date("date", { mode: "string" }).notNull(),
    block: integer("block").notNull(),
    dayNumber: integer("day_number"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workouts_user_date_idx").on(t.userId, t.date)],
);

/** Eine Übung innerhalb einer Einheit (Excel: eine Zeile im Logbuch). */
export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  /** Im Browser erzeugte ID, damit Einheiten auch offline angelegt und später abgeglichen werden können */
  uid: uuid("uid").notNull().defaultRandom().unique(),
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
  /** Im Browser erzeugte ID, damit Einheiten auch offline angelegt und später abgeglichen werden können */
  uid: uuid("uid").notNull().defaultRandom().unique(),
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
    userId: owner(),
    date: date("date", { mode: "string" }).notNull(),
    kg: real("kg").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("body_weights_user_date_idx").on(t.userId, t.date)],
);

/** Push-Abos der Geräte, auf denen Benachrichtigungen erlaubt wurden. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  /** Wer zuletzt auf dem Gerät angemeldet war; nur der bekommt dessen Alarme */
  userId: owner(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Laufende bzw. vergangene Pausen-Timer, für den Push bei Ablauf. */
export const restTimers = pgTable("rest_timers", {
  id: serial("id").primaryKey(),
  userId: owner(),
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
