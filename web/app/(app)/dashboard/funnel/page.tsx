import "@fontsource/share-tech-mono";

import { getLatestFunnel } from "@/lib/services/funnel";
import { FunnelView } from "@/components/funnel/funnel-view";

export const dynamic = "force-dynamic";

// Visual event funnel (impression → … → purchase) from the latest funnel-analytics
// run, read from funnel_events (ADR 0025). Read-only.
export default async function FunnelPage() {
  const data = await getLatestFunnel();

  if (!data) {
    return (
      <div className="space-y-3">
        <h1 className="font-hud text-2xl uppercase tracking-[0.12em] text-white">
          Funil de conversão
        </h1>
        <p className="text-sm text-white/50">
          Nenhum funil ainda. A análise diária (funnel-analytics) popula a tabela
          <code className="mx-1 rounded bg-white/5 px-1 font-hud text-cyan-200/80">funnel_events</code>.
        </p>
      </div>
    );
  }

  return <FunnelView data={data} />;
}
