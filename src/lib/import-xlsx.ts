/**
 * Liest das Excel-Trainingslogbuch (Übungen, Trainingsplan, Logbuch,
 * Körpergewicht) und schreibt es in die Datenbank. Genutzt vom Skript
 * `npm run import` und vom Import in der App.
 */
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
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

/** Ersetzt alle Trainingsdaten durch den Inhalt der Datei. Ohne `replace` nur in eine leere Datenbank. */
export async function importWorkbook(db: Db, data: ArrayBuffer, { replace = false } = {}): Promise<ImportSummary> {
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

  const count = await db.$count(t.workouts);
  if (count > 0 && !replace) {
    throw new ImportError(`Die Datenbank enthält schon ${count} Einheiten.`);
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`truncate sets, entries, workouts, plan_items, plan_days, exercises, body_weights restart identity cascade`,
    );

    // Übungen: ab Zeile 4, Spalten Übung | Haupt | Neben 1 | Neben 2 | Notiz
    const exerciseIds = new Map<string, number>();
    const ensureExercise = async (name: string, primary = "Sonstiges") => {
      const known = exerciseIds.get(name);
      if (known) return known;
      const [row] = await tx
        .insert(t.exercises)
        .values({ name, primaryMuscle: primary })
        .returning({ id: t.exercises.id });
      exerciseIds.set(name, row.id);
      return row.id;
    };

    const ex = sheet("Übungen");
    for (let r = 4; r <= ex.rowCount; r++) {
      const row = ex.getRow(r);
      const name = str(row.getCell(1).value);
      const primary = str(row.getCell(2).value);
      if (!name || !primary) continue;
      const [inserted] = await tx
        .insert(t.exercises)
        .values({
          name,
          primaryMuscle: primary,
          secondaryMuscle1: str(row.getCell(3).value),
          secondaryMuscle2: str(row.getCell(4).value),
          note: str(row.getCell(5).value),
        })
        .onConflictDoNothing()
        .returning({ id: t.exercises.id });
      if (inserted) exerciseIds.set(name, inserted.id);
    }

    // Trainingsplan: Abschnitte "Tag N – Titel", dann Kopfzeile, dann Übungen
    const plan = sheet("Trainingsplan");
    let dayId: number | null = null;
    let position = 0;
    for (let r = 1; r <= plan.rowCount; r++) {
      const row = plan.getRow(r);
      const first = str(row.getCell(1).value);
      if (!first) continue;
      const heading = first.match(/^Tag\s+(\d+)\s*[–-]\s*(.+)$/);
      if (heading) {
        const [day] = await tx
          .insert(t.planDays)
          .values({ number: Number(heading[1]), title: heading[2].trim() })
          .returning({ id: t.planDays.id });
        dayId = day.id;
        position = 0;
        continue;
      }
      if (dayId === null || first === "Übung") continue;
      const setsTarget = num(row.getCell(2).value);
      if (setsTarget === null) continue;
      await tx.insert(t.planItems).values({
        planDayId: dayId,
        exerciseId: await ensureExercise(first, str(row.getCell(6).value) ?? "Sonstiges"),
        position: position++,
        sets: setsTarget,
        reps: range(row.getCell(3).value),
        rir: range(row.getCell(4).value),
        rest: str(row.getCell(5).value),
      });
    }

    // Logbuch: ab Zeile 5. A Datum, B Block, C Einheit, D Übung,
    // E–P sechs Paare (Wdh., kg), Q RIR letzter Satz, R Sätze, V Notiz
    const log = sheet("Logbuch");
    const workoutIds = new Map<string, number>();
    const entryIds = new Map<string, { id: number; nextSet: number }>();
    const entryPosition = new Map<number, number>();
    let imported = 0;
    for (let r = 5; r <= log.rowCount; r++) {
      const row = log.getRow(r);
      const date = isoDate(row.getCell(1).value);
      const exerciseName = str(row.getCell(4).value);
      if (!date || !exerciseName) continue;
      const block = trailingNumber(row.getCell(2).value) ?? 1;
      const day = trailingNumber(row.getCell(3).value);

      const workoutKey = `${date}|${block}|${day}`;
      let workoutId = workoutIds.get(workoutKey);
      if (!workoutId) {
        const [w] = await tx
          .insert(t.workouts)
          .values({ date, block, dayNumber: day })
          .returning({ id: t.workouts.id });
        workoutId = w.id;
        workoutIds.set(workoutKey, workoutId);
        entryPosition.set(workoutId, 0);
      }

      const pairs: { reps: number | null; weight: number | null }[] = [];
      for (let s = 0; s < 6; s++) {
        const reps = num(row.getCell(5 + s * 2).value);
        const weight = num(row.getCell(6 + s * 2).value);
        if (reps !== null || weight !== null) pairs.push({ reps, weight });
      }
      const rirLast = num(row.getCell(17).value);
      const note = str(row.getCell(22).value);
      // Ohne Sätze ist die Spalte "Sätze" eine überschriebene Satzzahl (Block 1)
      const setCount = pairs.length === 0 ? num(row.getCell(18).value) : null;

      // Gleiche Übung am gleichen Tag in zweiter Zeile = mehr als sechs Sätze
      const exerciseId = await ensureExercise(exerciseName);
      const entryKey = `${workoutKey}|${exerciseId}`;
      let entry = entryIds.get(entryKey);
      if (!entry) {
        const pos = entryPosition.get(workoutId)!;
        entryPosition.set(workoutId, pos + 1);
        const [e] = await tx
          .insert(t.entries)
          .values({ workoutId, exerciseId, position: pos, rirLast, setCount, note })
          .returning({ id: t.entries.id });
        entry = { id: e.id, nextSet: 0 };
        entryIds.set(entryKey, entry);
      }
      for (const p of pairs) {
        await tx.insert(t.sets).values({ entryId: entry.id, position: entry.nextSet++, ...p });
      }
      imported++;
    }

    // Körpergewicht: ab Zeile 4. Beispielzeile aus der Vorlage überspringen.
    const bw = sheet("Körpergewicht");
    let weights = 0;
    for (let r = 4; r <= bw.rowCount; r++) {
      const row = bw.getRow(r);
      const date = isoDate(row.getCell(1).value);
      const kg = num(row.getCell(2).value);
      const note = str(row.getCell(4).value);
      if (!date || kg === null || note?.startsWith("Beispielzeile")) continue;
      await tx.insert(t.bodyWeights).values({ date, kg, note }).onConflictDoNothing();
      weights++;
    }

    return { exercises: exerciseIds.size, workouts: workoutIds.size, rows: imported, weights };
  });
}
