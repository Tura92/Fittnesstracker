"use client";

import { useState } from "react";
import { MUSCLE_TARGETS, type BlockAnalysis, type ExerciseStats, type MuscleStats } from "@/lib/analysis";
import { formatDate, formatKg } from "@/lib/format";

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const muscleOrder = new Map(MUSCLE_TARGETS.map((m, i) => [m.muscle, i]));

export function AnalysisView({ blocks }: { blocks: BlockAnalysis[] }) {
  const [selected, setSelected] = useState(blocks[blocks.length - 1].block);
  const block = blocks.find((b) => b.block === selected) ?? blocks[blocks.length - 1];

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Block">
        {blocks.map((b) => (
          <button
            key={b.block}
            type="button"
            role="tab"
            aria-selected={b.block === block.block}
            onClick={() => setSelected(b.block)}
            className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium ${
              b.block === block.block ? "bg-accent text-white dark:text-zinc-950" : "border border-border bg-surface"
            }`}
          >
            Block {b.block}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">
        {formatDate(block.from)} bis {formatDate(block.to)} · {block.sessions === 1 ? "1 Einheit" : `${block.sessions} Einheiten`} ={" "}
        {block.weeks === 1 ? "1 Woche" : `${block.weeks} Wochen`}
      </p>

      <MuscleSection block={block} />
      <ExerciseSection exercises={block.exercises} />
      {blocks.length > 1 && <HistorySection blocks={blocks} current={block.block} />}
    </div>
  );
}

function StatusLabel({ m }: { m: MuscleStats }) {
  if (!m.status) return null;
  if (m.status === "im") return <span className="text-accent">✓ im Ziel</span>;
  return <span className="text-warning">{m.status === "unter" ? "↓ unter Ziel" : "↑ über Ziel"}</span>;
}

/** Sätze pro Woche je Muskel als Balken, Zielbereich grau hinterlegt */
function MuscleSection({ block }: { block: BlockAnalysis }) {
  const rows = block.muscles.filter((m) => m.target || m.total > 0);
  const scaleMax = Math.max(25, ...rows.map((m) => m.perWeek));
  const pct = (v: number) => `${(v / scaleMax) * 100}%`;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Sätze pro Woche</h2>
      <p className="mb-3 text-sm text-muted">Hauptmuskel zählt 1,0, Nebenmuskel 0,5. Grau ist der Zielbereich.</p>
      <ul className="space-y-3">
        {rows.map((m) => (
          <li key={m.muscle} title={`direkt ${number.format(m.direct)} · gesamt ${number.format(m.total)} Sätze`}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{m.muscle}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{number.format(m.perWeek)}</span>
                {m.target && <span className="text-muted"> / {m.target.min}–{m.target.max}</span>}
                {m.status && <span className="ml-2 text-xs"><StatusLabel m={m} /></span>}
              </span>
            </div>
            <div className="relative mt-1 h-2 rounded-full bg-background">
              {m.target && (
                <div
                  className="absolute inset-y-0 rounded-sm bg-band"
                  style={{ left: pct(m.target.min), width: pct(m.target.max - m.target.min) }}
                />
              )}
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${
                  m.status === "im" ? "bg-accent" : m.status ? "bg-warning" : "bg-muted"
                }`}
                style={{ width: pct(m.perWeek) }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExerciseSection({ exercises }: { exercises: ExerciseStats[] }) {
  const sorted = [...exercises].sort(
    (a, b) =>
      (muscleOrder.get(a.primaryMuscle) ?? 99) - (muscleOrder.get(b.primaryMuscle) ?? 99) ||
      a.name.localeCompare(b.name, "de"),
  );
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Übungen</h2>
      <p className="mb-2 text-sm text-muted">Bestes Gewicht und Veränderung zum Block davor.</p>
      <ul className="divide-y divide-border">
        {sorted.map((e) => (
          <li key={e.exerciseId} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium leading-snug">{e.name}</span>
              <span className="shrink-0 text-right tabular-nums">
                {e.bestWeight !== null ? <span className="font-semibold">{formatKg(e.bestWeight)} kg</span> : <span className="text-muted">–</span>}
                {e.weightDelta !== null && e.weightDelta !== 0 && (
                  <span className={`ml-1.5 text-sm ${e.weightDelta > 0 ? "text-accent" : "text-warning"}`}>
                    {e.weightDelta > 0 ? "+" : "−"}
                    {formatKg(Math.abs(e.weightDelta))}
                  </span>
                )}
                {e.weightDelta === 0 && <span className="ml-1.5 text-sm text-muted">±0</span>}
              </span>
            </div>
            <p className="text-sm text-muted">
              {e.primaryMuscle} · {e.sets} {e.sets === 1 ? "Satz" : "Sätze"}
              {e.volume !== null && ` · Volumen ${number.format(e.volume)} kg`}
              {e.bestSetVolume !== null && ` · bester Satz ${number.format(e.bestSetVolume)}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sätze pro Woche je Muskel über alle Blöcke, wie das Excel-Blatt "Fortschritt" */
function HistorySection({ blocks, current }: { blocks: BlockAnalysis[]; current: number }) {
  const muscles = blocks[blocks.length - 1].muscles.filter((m) =>
    blocks.some((b) => (b.muscles.find((x) => x.muscle === m.muscle)?.total ?? 0) > 0),
  );
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Verlauf</h2>
      <p className="mb-2 text-sm text-muted">Sätze pro Woche je Block. Abweichungen vom Ziel mit ↓ oder ↑.</p>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-muted">
              <th className="py-1.5 pr-2 text-left font-medium">Muskel</th>
              {blocks.map((b) => (
                <th key={b.block} className={`px-1.5 py-1.5 text-right font-medium ${b.block === current ? "text-foreground" : ""}`}>
                  B{b.block}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {muscles.map((m) => (
              <tr key={m.muscle}>
                <td className="py-1.5 pr-2 whitespace-nowrap">{m.muscle}</td>
                {blocks.map((b) => {
                  const x = b.muscles.find((y) => y.muscle === m.muscle);
                  return (
                    <td
                      key={b.block}
                      className={`px-1.5 py-1.5 text-right whitespace-nowrap ${b.block === current ? "font-semibold" : ""} ${
                        x?.status && x.status !== "im" ? "text-warning" : ""
                      }`}
                    >
                      {x && x.total > 0 ? number.format(x.perWeek) : "–"}
                      {x?.status === "unter" && " ↓"}
                      {x?.status === "über" && " ↑"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
