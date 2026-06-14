import "@fontsource/share-tech-mono";

import { getFunnelDirectory, getLatestFunnel } from "@/lib/services/funnel";
import { FunnelView } from "@/components/funnel/funnel-view";

export const dynamic = "force-dynamic";

// Visual event funnel (impression → … → purchase) from the latest funnel-analytics
// run, read from funnel_events (ADR 0025). Client/account picked via ?client=&account=.
// Read-only.
export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; account?: string }>;
}) {
  const sp = await searchParams;
  const clients = await getFunnelDirectory();

  const empty = (
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

  const selClient = clients.find((c) => c.clientId === sp.client) ?? clients[0];
  if (!selClient) return empty;
  const selAccount =
    selClient.accounts.find((a) => a.accountId === sp.account) ?? selClient.accounts[0];

  const data = await getLatestFunnel({
    clientId: selClient.clientId,
    ...(selAccount ? { accountId: selAccount.accountId } : {}),
  });
  if (!data) return empty;

  return (
    <FunnelView
      data={data}
      clients={clients}
      selectedClientId={selClient.clientId}
      selectedAccountId={selAccount?.accountId ?? ""}
    />
  );
}
