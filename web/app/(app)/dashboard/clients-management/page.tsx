import { listClientsForOperator } from "@/lib/services/clients-admin";
import { ClientsManager } from "@/components/clients/clients-manager";

export const dynamic = "force-dynamic";

export default async function ClientsManagementPage() {
  const clients = await listClientsForOperator();

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-white">Clientes</h1>
        <p className="mt-1 text-sm text-white/40">
          {clients.length} cliente{clients.length === 1 ? "" : "s"} · crie e configure as contas que seus
          agentes gerenciam
        </p>
      </div>
      <ClientsManager initialClients={clients} />
    </div>
  );
}
