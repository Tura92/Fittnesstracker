"use server";

import { and, count, eq, max, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { entries, exercises, planDays, planItems } from "@/db/schema";
import { ImportError, importWorkbook } from "@/lib/import-xlsx";
import { parseDuration } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { intOrNull, textOrNull } from "@/lib/validate";

// Anmeldung und Konten: siehe account-actions.ts. Alles hier gilt nur für das angemeldete Konto.

export type ImportState = { ok: boolean; message: string } | null;

/** Excel-Logbuch aus der App heraus importieren, z. B. in die frische Online-Datenbank. */
export async function importExcel(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Bitte eine .xlsx-Datei auswählen." };
  const replace = formData.get("replace") === "on";
  try {
    const r = await importWorkbook(await getDb(), userId, await file.arrayBuffer(), { replace });
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
  const userId = await requireUserId();
  const db = await getDb();
  if (exerciseId !== null) {
    const [own] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId)));
    if (!own) return { error: "Diese Übung gibt es nicht." };
  }

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
  let defaultSets: number | null;
  try {
    defaultSets = intOrNull(formData.get("default-sets"), 1, 20);
  } catch {
    return { error: "Sätze bitte als ganze Zahl zwischen 1 und 20 angeben." };
  }
  const values = {
    userId,
    name,
    primaryMuscle,
    secondaryMuscle1: secondary[0] ?? null,
    secondaryMuscle2: secondary[1] ?? null,
    restSeconds: rest,
    defaultSets,
    defaultReps: shortText(formData.get("default-reps"), 20),
    defaultRir: shortText(formData.get("default-rir"), 10),
    note: textOrNull(formData.get("note")),
  };

  const [clash] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.userId, userId),
        eq(exercises.name, name),
        exerciseId === null ? undefined : ne(exercises.id, exerciseId),
      ),
    );
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
      const [day] = await tx
        .select({ id: planDays.id })
        .from(planDays)
        .where(and(eq(planDays.userId, userId), eq(planDays.number, addDay)));
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
  const userId = await requireUserId();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [own] = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId)));
    if (!own) return;
    await tx.delete(planItems).where(eq(planItems.exerciseId, exerciseId));
    const [{ n }] = await tx.select({ n: count() }).from(entries).where(eq(entries.exerciseId, exerciseId));
    if (n > 0) await tx.update(exercises).set({ archived: true }).where(eq(exercises.id, exerciseId));
    else await tx.delete(exercises).where(eq(exercises.id, exerciseId));
  });
  revalidatePath("/", "layout");
  redirect("/uebungen");
}

export async function restoreExercise(exerciseId: number) {
  const userId = await requireUserId();
  const db = await getDb();
  await db
    .update(exercises)
    .set({ archived: false })
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId)));
  revalidatePath("/", "layout");
  redirect(`/uebungen/${exerciseId}`);
}
