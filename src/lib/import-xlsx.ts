/**
 * Liest das Excel-Trainingslogbuch (Übungen, Trainingsplan, Logbuch,
 * Körpergewicht) und schreibt es in die Datenbank. Genutzt vom Skript
 * `npm run import` und vom Import in der App.
 */
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";

type Cell = ExcelJS.CellValue;

function value(v: Cell): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return value(v.result as Cell);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("formula" in v || "sharedFormula" in v) return null;
    return null;
  }
  return v as string | number | Date;
}

function str(v: Cell): string | null {
  const x = value(v);
  if (x === null) return null;
  const s = x instanceof Date ? x.toISOString().slice(0, 10) : String(x).trim();
  return s === "" ? null : s;
}

function num(v: Cell): number | null {
  const x = value(v);
  if (typeof x === "number") return x;
  if (typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x.replace(",", ".")))) {
    return Number(x.replace(",", "."));
  }
  return null;
}

function isoDate(v: Cell): string | null {
  const x = value(v);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return null;
}

/**
 * Bereiche wie "8–12" hat Excel teils als Datum gespeichert (8. Dezember).
 * Die werden hier wieder zu "8–12".
 */
function range(v: Cell): string | null {
  const x = value(v);
  if (x instanceof Date) return `${x.getUTCDate()}–${x.getUTCMonth() + 1}`;
  return str(v);
}

/** "Block 3" → 3, "Tag 5" → 5 */
function trailingNumber(v: Cell): number | null {
  const m = str(v)?.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

export type ImportSummary = { exercises: number; workouts: number; rows: number; weights: number };

export class ImportError extends Error {}

/** Ersetzt alle Trainingsdaten des Kontos durch den Inhalt der Datei. Ohne `replace` nur in ein leeres Konto. */
export async function importWorkbook(
  db: Db,
  userId: number,
  data: ArrayBuffer,
  { replace = false } = {},
): Promise<ImportSummary> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new ImportError("Die Datei ist keine lesbare Excel-Datei (.xlsx).");
  }
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new ImportError(`Das Blatt "${name}" fehlt in der Datei.`);
    return ws;
  };
  // Alle Blätter vorab prüfen, damit nichts halb importiert wird
  ["Übungen", "Trainingsplan", "Logbuch", "Körpergewicht"].forEach(sheet);

  const count = await db.$count(t.workouts, eq(t.workouts.userId, userId));
  if (count > 0 && !replace) {
    throw new ImportError(`Die Datenbank enthält schon ${count} Einheiten.`);
  }

  // Erst alles aus der Datei lesen, dann mit wenigen Sammel-Inserts schreiben.
  // Einzelne Inserts brauchen online je einen Netzwerk-Umweg und halten die
  // Tabellen so lange gesperrt, dass die App hängt.

  // Übungen: ab Zeile 4, Spalten Übung | Haupt | Neben 1 | Neben 2 | Notiz
  const exerciseRows = new Map<string, typeof t.exercises.$inferInsert>();
  const ensureExercise = (name: string, primary = "Sonstiges") => {
    if (!exerciseRows.has(name)) exerciseRows.set(name, { userId, name, primaryMuscle: primary });
    return name;
  };
  const ex = sheet("Übungen");
  for (let r = 4; r <= ex.rowCount; r++) {
    const row = ex.getRow(r);
    const name = str(row.getCell(1).value);
    const primary = str(row.getCell(2).value);
    if (!name || !primary || exerciseRows.has(name)) continue;
    exerciseRows.set(name, {
      userId,
      name,
      primaryMuscle: primary,
      secondaryMuscle1: str(row.getCell(3).value),
      secondaryMuscle2: str(row.getCell(4).value),
      note: str(row.getCell(5).value),
    });
  }

  // Trainingsplan: Abschnitte "Tag N – Titel", dann Kopfzeile, dann Übungen
  const planDayRows: { number: number; title: string }[] = [];
  const planItemRows: { day: number; exercise: string; position: number; sets: number; reps: string | null; rir: string | null; rest: string | null }[] = [];
  const plan = sheet("Trainingsplan");
  let day: number | null = null;
  let position = 0;
  for (let r = 1; r <= plan.rowCount; r++) {
    const row = plan.getRow(r);
    const first = str(row.getCell(1).value);
    if (!first) continue;
    const heading = first.match(/^Tag\s+(\d+)\s*[–-]\s*(.+)$/);
    if (heading) {
      day = Number(heading[1]);
      planDayRows.push({ number: day, title: heading[2].trim() });
      position = 0;
      continue;
    }
    if (day === null || first === "Übung") continue;
    const setsTarget = num(row.getCell(2).value);
    if (setsTarget === null) continue;
    planItemRows.push({
      day,
      exercise: ensureExercise(first, str(row.getCell(6).value) ?? "Sonstiges"),
      position: position++,
      sets: setsTarget,
      reps: range(row.getCell(3).value),
      rir: range(row.getCell(4).value),
      rest: str(row.getCell(5).value),
    });
  }
  // Standardvorgabe jeder Übung: die aus dem ersten Plantag, in dem sie vorkommt
  for (const item of [...planItemRows].sort((x, y) => x.day - y.day || x.position - y.position)) {
    const e = exerciseRows.get(item.exercise)!;
    if (e.defaultSets !== undefined) continue;
    Object.assign(e, { defaultSets: item.sets, defaultReps: item.reps, defaultRir: item.rir });
  }

  // Logbuch: ab Zeile 5. A Datum, B Block, C Einheit, D Übung,
  // E–P sechs Paare (Wdh., kg), Q RIR letzter Satz, R Sätze, V Notiz
  type ParsedEntry = {
    exercise: string;
    position: number;
    rirLast: number | null;
    setCount: number | null;
    note: string | null;
    sets: { reps: number | null; weight: number | null }[];
  };
  const workoutRows = new Map<string, { date: string; block: number; dayNumber: number | null; entries: Map<string, ParsedEntry> }>();
  const log = sheet("Logbuch");
  let imported = 0;
  for (let r = 5; r <= log.rowCount; r++) {
    const row = log.getRow(r);
    const date = isoDate(row.getCell(1).value);
    const exerciseName = str(row.getCell(4).value);
    if (!date || !exerciseName) continue;
    const block = trailingNumber(row.getCell(2).value) ?? 1;
    const dayNumber = trailingNumber(row.getCell(3).value);

    const workoutKey = `${date}|${block}|${dayNumber}`;
    let workout = workoutRows.get(workoutKey);
    if (!workout) {
      workout = { date, block, dayNumber, entries: new Map() };
      workoutRows.set(workoutKey, workout);
    }

    const pairs: { reps: number | null; weight: number | null }[] = [];
    for (let s = 0; s < 6; s++) {
      const reps = num(row.getCell(5 + s * 2).value);
      const weight = num(row.getCell(6 + s * 2).value);
      if (reps !== null || weight !== null) pairs.push({ reps, weight });
    }

    // Gleiche Übung am gleichen Tag in zweiter Zeile = mehr als sechs Sätze
    const exercise = ensureExercise(exerciseName);
    let entry = workout.entries.get(exercise);
    if (!entry) {
      entry = {
        exercise,
        position: workout.entries.size,
        rirLast: num(row.getCell(17).value),
        // Ohne Sätze ist die Spalte "Sätze" eine überschriebene Satzzahl (Block 1)
        setCount: pairs.length === 0 ? num(row.getCell(18).value) : null,
        note: str(row.getCell(22).value),
        sets: [],
      };
      workout.entries.set(exercise, entry);
    }
    entry.sets.push(...pairs);
    imported++;
  }

  // Körpergewicht: ab Zeile 4. Beispielzeile aus der Vorlage überspringen.
  const weightRows = new Map<string, { date: string; kg: number; note: string | null }>();
  const bw = sheet("Körpergewicht");
  for (let r = 4; r <= bw.rowCount; r++) {
    const row = bw.getRow(r);
    const date = isoDate(row.getCell(1).value);
    const kg = num(row.getCell(2).value);
    const note = str(row.getCell(4).value);
    if (!date || kg === null || note?.startsWith("Beispielzeile") || weightRows.has(date)) continue;
    weightRows.set(date, { date, kg, note });
  }

  const workoutList = [...workoutRows.values()];
  await db.transaction(async (tx) => {
    // Nur die Daten dieses Kontos; Einträge, Sätze und Planzeilen hängen per Kaskade dran
    await tx.delete(t.workouts).where(eq(t.workouts.userId, userId));
    await tx.delete(t.planDays).where(eq(t.planDays.userId, userId));
    await tx.delete(t.exercises).where(eq(t.exercises.userId, userId));
    await tx.delete(t.bodyWeights).where(eq(t.bodyWeights.userId, userId));

    const exerciseIds = new Map<string, number>();
    if (exerciseRows.size > 0) {
      const rows = await tx
        .insert(t.exercises)
        .values([...exerciseRows.values()])
        .returning({ id: t.exercises.id, name: t.exercises.name });
      for (const r of rows) exerciseIds.set(r.name, r.id);
    }

    const dayIds = new Map<number, number>();
    if (planDayRows.length > 0) {
      const rows = await tx.insert(t.planDays).values(planDayRows.map((d) => ({ ...d, userId }))).returning({ id: t.planDays.id, number: t.planDays.number });
      for (const r of rows) dayIds.set(r.number, r.id);
    }
    if (planItemRows.length > 0) {
      await tx.insert(t.planItems).values(
        planItemRows.map(({ day, exercise, ...rest }) => ({
          ...rest,
          planDayId: dayIds.get(day)!,
          exerciseId: exerciseIds.get(exercise)!,
        })),
      );
    }

    if (workoutList.length > 0) {
      // Reihenfolge der zurückgegebenen Zeilen ist nicht garantiert, daher Zuordnung über den Schlüssel
      const rows = await tx
        .insert(t.workouts)
        .values(workoutList.map(({ date, block, dayNumber }) => ({ userId, date, block, dayNumber })))
        .returning({ id: t.workouts.id, date: t.workouts.date, block: t.workouts.block, dayNumber: t.workouts.dayNumber });
      const workoutIds = new Map(rows.map((r) => [`${r.date}|${r.block}|${r.dayNumber}`, r.id]));

      const entryValues = workoutList.flatMap((w) =>
        [...w.entries.values()].map((e) => ({
          workoutId: workoutIds.get(`${w.date}|${w.block}|${w.dayNumber}`)!,
          exerciseId: exerciseIds.get(e.exercise)!,
          position: e.position,
          rirLast: e.rirLast,
          setCount: e.setCount,
          note: e.note,
        })),
      );
      const entrySets = workoutList.flatMap((w) => [...w.entries.values()].map((e) => e.sets));
      const entryRows = await tx
        .insert(t.entries)
        .values(entryValues)
        .returning({ id: t.entries.id, workoutId: t.entries.workoutId, exerciseId: t.entries.exerciseId });
      const entryIds = new Map(entryRows.map((r) => [`${r.workoutId}|${r.exerciseId}`, r.id]));

      const setValues = entryValues.flatMap((e, i) =>
        entrySets[i].map((set, position) => ({ entryId: entryIds.get(`${e.workoutId}|${e.exerciseId}`)!, position, ...set })),
      );
      if (setValues.length > 0) await tx.insert(t.sets).values(setValues);
    }

    if (weightRows.size > 0) await tx.insert(t.bodyWeights).values([...weightRows.values()].map((w) => ({ ...w, userId })));
  });

  return { exercises: exerciseRows.size, workouts: workoutList.length, rows: imported, weights: weightRows.size };
}
