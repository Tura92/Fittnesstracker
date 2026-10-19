"use server";

import { and, count, desc, eq, lt, max, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { entries, exercises, loginFailures, planDays, planItems } from "@/db/schema";
import { AUTH_COOKIE, authEnabled, isValidSession, safeEqual, sessionToken } from "@/lib/auth";
import { ImportError, importWorkbook } from "@/lib/import-xlsx";
import { parseDuration } from "@/lib/format";
import { intOrNull, textOrNull } from "@/lib/validate";

async function requireAuth() {
  const jar = await cookies();
  if (!(await isValidSession(jar.get(AUTH_COOKIE)?.value))) throw new Error("Nicht angemeldet");
}

/** Nach so vielen Fehlversuchen innerhalb des Zeitfensters ist die IP gesperrt */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function clientIp() {
  const h = await headers();
  // Auf Vercel setzt die Plattform x-forwarded-for, der erste Eintrag ist der Client
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unbekannt";
}

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  if (!authEnabled()) redirect("/");
  const db = await getDb();
  const ip = await clientIp();

  const recent = await db
    .select({ at: loginFailures.at })
    .from(loginFailures)
    .where(eq(loginFailures.ip, ip))
    .orderBy(desc(loginFailures.at))
    .limit(LOGIN_MAX_FAILURES);
  if (recent.length === LOGIN_MAX_FAILURES) {
    const lockedUntil = recent[LOGIN_MAX_FAILURES - 1].at.getTime() + LOGIN_LOCK_MS;
    if (lockedUntil > Date.now()) {
      const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
      return `Zu viele Fehlversuche. Bitte in ${minutes === 1 ? "1 Minute" : `${minutes} Minuten`} erneut versuchen.`;
    }
  }

  const password = String(formData.get("password") ?? "");
  if (!safeEqual(password, process.env.APP_PASSWORD ?? "")) {
    await db.insert(loginFailures).values({ ip });
    await db.delete(loginFailures).where(lt(loginFailures.at, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    const inWindow = recent.filter((r) => r.at.getTime() > Date.now() - LOGIN_LOCK_MS).length + 1;
    return inWindow < LOGIN_MAX_FAILURES ? "Passwort stimmt nicht." : "Passwort stimmt nicht. Die Anmeldung ist jetzt für 15 Minuten gesperrt.";
  }
  await db.delete(loginFailures).where(eq(loginFailures.ip, ip));
  (await cookies()).set(AUTH_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

export type ImportState = { ok: boolean; message: string } | null;

/** Excel-Logbuch aus der App heraus importieren, z. B. in die frische Online-Datenbank. */
export async function importExcel(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireAuth();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Bitte eine .xlsx-Datei auswählen." };
  const replace = formData.get("replace") === "on";
  try {
    const r = await importWorkbook(await getDb(), await file.arrayBuffer(), { replace });
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Importiert: ${r.exercises} Übungen, ${r.workouts} Einheiten, ${r.weights} Gewichtseinträge.`,
    };
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, message: err.message };
    throw err;
  }
}

export type ExerciseFormState = { error: string } | null;

function shortText(v: unknown, maxLength: number): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s.slice(0, maxLength);
}

/**
 * Legt eine Übung an (exerciseId null) oder speichert sie, samt ihrer Zielvorgaben
 * in den Plantagen: bestehende ändern oder entfernen, optional einem Tag hinzufügen.
 */
export async function saveExercise(
  exerciseId: number | null,
  _prev: ExerciseFormState,
  formData: FormData,
): Promise<ExerciseFormState> {
  await requireAuth();
  const db = await getDb();

  const name = shortText(formData.get("name"), 100);
  if (!name) return { error: "Bitte einen Namen eingeben." };
  const primaryMuscle = shortText(formData.get("primary"), 50);
  if (!primaryMuscle) return { error: "Bitte einen Hauptmuskel wählen." };
  // Nebenmuskeln ohne Doppelungen, sonst zählt ein Satz mehrfach für denselben Muskel
  const secondary = [shortText(formData.get("secondary1"), 50), shortText(formData.get("secondary2"), 50)].filter(
    (m, i, all): m is string => !!m && m !== primaryMuscle && all.indexOf(m) === i,
  );
  const rest = parseDuration(String(formData.get("rest") ?? ""));
  if (rest !== null && (Number.isNaN(rest) || rest < 5 || rest > 3600)) {
    return { error: "Pause bitte als Minuten:Sekunden (z. B. 2:30) oder in Sekunden angeben." };
  }
  const values = {
    name,
    primaryMuscle,
    secondaryMuscle1: secondary[0] ?? null,
    secondaryMuscle2: secondary[1] ?? null,
    restSeconds: rest,
    note: textOrNull(formData.get("note")),
  };

  const [clash] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(exerciseId === null ? eq(exercises.name, name) : and(eq(exercises.name, name), ne(exercises.id, exerciseId)));
  if (clash) return { error: `Es gibt schon eine Übung „${name}“.` };

  let itemUpdates: { id: number; remove: boolean; sets: number | null; reps: string | null; rir: string | null }[];
  let addDay: number | null;
  let newItem: { sets: number | null; reps: string | null; rir: string | null };
  try {
    itemUpdates = formData.getAll("items").map((v) => {
      const id = intOrNull(v, 1, 2 ** 31 - 1)!;
      return {
        id,
        remove: formData.get(`item-${id}-remove`) === "on",
        sets: intOrNull(formData.get(`item-${id}-sets`), 1, 20),
        reps: shortText(formData.get(`item-${id}-reps`), 20),
        rir: shortText(formData.get(`item-${id}-rir`), 10),
      };
    });
    addDay = intOrNull(formData.get("addDay"), 1, 99);
    newItem = {
      sets: intOrNull(formData.get("new-sets"), 1, 20),
      reps: shortText(formData.get("new-reps"), 20),
      rir: shortText(formData.get("new-rir"), 10),
    };
  } catch {
    return { error: "Sätze bitte als ganze Zahl zwischen 1 und 20 angeben." };
  }

  await db.transaction(async (tx) => {
    let id = exerciseId;
    if (id === null) {
      [{ id }] = await tx.insert(exercises).values(values).returning({ id: exercises.id });
    } else {
      await tx.update(exercises).set(values).where(eq(exercises.id, id));
    }
    for (const item of itemUpdates) {
      const own = and(eq(planItems.id, item.id), eq(planItems.exerciseId, id));
      if (item.remove) await tx.delete(planItems).where(own);
      else await tx.update(planItems).set({ sets: item.sets, reps: item.reps, rir: item.rir }).where(own);
    }
    if (addDay !== null) {
      const [day] = await tx.select({ id: planDays.id }).from(planDays).where(eq(planDays.number, addDay));
      if (day) {
        const [{ last }] = await tx
          .select({ last: max(planItems.position) })
          .from(planItems)
          .where(eq(planItems.planDayId, day.id));
        await tx.insert(planItems).values({ planDayId: day.id, exerciseId: id, position: (last ?? -1) + 1, ...newItem });
      }
    }
  });

  revalidatePath("/", "layout");
  redirect("/uebungen");
}

/**
 * Entfernt eine Übung aus dem Plan. Ohne Logbuch-Einträge wird sie gelöscht,
 * mit Einträgen nur archiviert, damit Logbuch und Auswertung vollständig bleiben.
 */
export async function deleteExercise(exerciseId: number) {
  await requireAuth();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(planItems).where(eq(planItems.exerciseId, exerciseId));
    const [{ n }] = await tx.select({ n: count() }).from(entries).where(eq(entries.exerciseId, exerciseId));
    if (n > 0) await tx.update(exercises).set({ archived: true }).where(eq(exercises.id, exerciseId));
    else await tx.delete(exercises).where(eq(exercises.id, exerciseId));
  });
  revalidatePath("/", "layout");
  redirect("/uebungen");
}

export async function restoreExercise(exerciseId: number) {
  await requireAuth();
  const db = await getDb();
  await db.update(exercises).set({ archived: false }).where(eq(exercises.id, exerciseId));
  revalidatePath("/", "layout");
  redirect(`/uebungen/${exerciseId}`);
}
