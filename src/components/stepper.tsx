"use client";

import { useState } from "react";
import { formatKg, parseNumber } from "@/lib/format";

/** Zahlenfeld mit großen −/+ Tasten. Tippen ins Feld bleibt möglich. */
export function Stepper({
  value,
  onChange,
  step,
  label,
  decimal = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step: number;
  label: string;
  decimal?: boolean;
}) {
  const display = decimal ? formatKg(value) : value === null ? "" : String(value);
  // Eigener Text nur während der Eingabe, damit "7," nicht sofort zu "7" wird
  const [draft, setDraft] = useState<string | null>(null);

  const bump = (dir: 1 | -1) => {
    const next = Math.max(0, Math.round(((value ?? 0) + dir * step) * 100) / 100);
    setDraft(null);
    onChange(next);
  };

  return (
    <div className="flex h-11 items-center rounded-xl border border-border bg-background">
      <button
        type="button"
        aria-label={`${label} verringern`}
        onClick={() => bump(-1)}
        className="h-full w-9 shrink-0 text-xl text-muted active:text-foreground"
      >
        −
      </button>
      <input
        aria-label={label}
        inputMode={decimal ? "decimal" : "numeric"}
        value={draft ?? display}
        placeholder="–"
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNumber(e.target.value);
          if (e.target.value.trim() === "" || n !== null) onChange(decimal || n === null ? n : Math.round(n));
        }}
        onBlur={() => setDraft(null)}
        className="h-full w-11 min-w-0 bg-transparent text-center text-lg font-semibold tabular-nums outline-none"
      />
      <button
        type="button"
        aria-label={`${label} erhöhen`}
        onClick={() => bump(1)}
        className="h-full w-9 shrink-0 text-xl text-muted active:text-foreground"
      >
        +
      </button>
    </div>
  );
}
