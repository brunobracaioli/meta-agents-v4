import { getAnalysisRounds } from "@/lib/services/analyses";
import { AnalysesTable } from "@/components/analyses/analyses-table";

export const dynamic = "force-dynamic";

export default async function AnalysesPage() {
  const rounds = await getAnalysisRounds();

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-white">Análises</h1>
        <p className="mt-1 text-sm text-white/40">
          {rounds.length} rodada{rounds.length === 1 ? "" : "s"} · geradas pela IA diariamente
        </p>
      </div>

      {rounds.length === 0 ? (
        <p className="text-sm text-white/50">
          Nenhuma análise ainda. A skill de análise roda diariamente.
        </p>
      ) : (
        <AnalysesTable rounds={rounds} />
      )}
    </div>
  );
}
