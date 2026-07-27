import Link from "next/link";
import { getAllFlows } from "@/lib/services/flows";
import { listClientsForOperator } from "@/lib/services/clients-admin";
import { CreateFlowButton } from "@/components/flows/create-flow-button";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-white/8 text-white/60 border-white/15",
  active: "bg-emerald-400/12 text-emerald-200 border-emerald-300/25",
};

export default async function FlowsIndexPage() {
  const [flows, clients] = await Promise.all([getAllFlows(), listClientsForOperator()]);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Flows</h1>
          <p className="mt-1 text-sm text-white/40">
            Monte pipelines visuais — scraping, copy, criativos, aprovação e campanha Meta.
          </p>
        </div>
        <CreateFlowButton clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      {flows.length === 0 ? (
        <p className="text-sm text-white/50">
          Nenhum flow ainda. Crie o primeiro — ele já nasce com o pipeline completo e a aprovação
          humana antes do card Meta.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {flows.map((flow) => (
            <li key={flow.id} className="tech-panel rounded-xl border border-white/8 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-white/90">{flow.name}</span>
                <span
                  className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    STATUS_STYLES[flow.status] ?? STATUS_STYLES.draft
                  }`}
                >
                  {flow.status}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-white/40">
                <span className="text-white/55">{flow.clientName ?? "sem cliente"}</span>
                {" · "}editado {formatDateTime(flow.updated_at)}
              </p>
              <div className="mt-3 text-xs">
                <Link href={`/dashboard/flows/${flow.id}`} className="text-cyan-200/80 transition hover:text-cyan-100">
                  Abrir editor →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
