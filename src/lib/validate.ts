/** Prüft Eingaben aus Formularen und vom Abgleich; wirft bei Unsinn statt still falsche Werte zu speichern */

export function intOrNull(v: unknown, min: number, maxValue: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > maxValue) throw new Error(`Ungültiger Wert: ${v}`);
  return n;
}

export function numOrNull(v: unknown, min: number, maxValue: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > maxValue) throw new Error(`Ungültiger Wert: ${v}`);
  return n;
}

export function isoDate(v: unknown): string {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Ungültiges Datum");
  return s;
}

export function textOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s.slice(0, 2000);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(v: unknown): string {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new Error("Ungültige ID");
  return s.toLowerCase();
}
