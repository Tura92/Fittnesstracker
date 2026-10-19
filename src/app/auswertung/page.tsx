import { Suspense } from "react";
import { AnalysisView } from "@/components/analysis-view";
import { analyzeBlocks } from "@/lib/analysis";
import { getAnalysisEntries, getPlanDayOptions } from "@/lib/queries";

export default function AuswertungPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Auswertung</h1>
      <Suspense fallback={<p className="text-muted">Lädt…</p>}>
        <Analysis />
      </Suspense>
    </>
  );
}

async function Analysis() {
  const [entries, days] = await Promise.all([getAnalysisEntries(), getPlanDayOptions()]);
  // Ohne Plan: 5 Einheiten pro Woche wie in der Excel-Vorlage
  const blocks = analyzeBlocks(entries, days.length || 5);
  if (blocks.length === 0) return <p className="text-muted">Noch keine Einheiten zum Auswerten.</p>;
  return <AnalysisView blocks={blocks} />;
}
