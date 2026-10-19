export type SetValues = { reps: number | null; weight: number | null };

const kgFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export function formatKg(kg: number | null | undefined): string {
  return kg === null || kg === undefined ? "" : kgFormat.format(kg);
}

/** "12×30", bei fehlendem Gewicht nur "12" */
export function formatSet(s: SetValues): string {
  const reps = s.reps ?? "–";
  return s.weight === null ? `${reps}` : `${reps}×${formatKg(s.weight)}`;
}

export function formatSets(sets: SetValues[], setCount?: number | null): string {
  if (sets.length === 0) {
    return setCount ? `${setCount} ${setCount === 1 ? "Satz" : "Sätze"}` : "keine Sätze";
  }
  return sets.map(formatSet).join(" · ");
}

/** ISO-Datum "2026-10-17" → "Sa, 17.10.26" */
export function formatDate(iso: string, opts: { year?: boolean } = {}): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: opts.year ? "2-digit" : undefined,
    timeZone: "UTC",
  });
}

/** Heutiges Datum als ISO-String in deutscher Zeit */
export function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

/** Akzeptiert "7,5" und "7.5"; leer → null */
export function parseNumber(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
