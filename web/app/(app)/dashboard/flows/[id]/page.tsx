import { notFound } from "next/navigation";
import { getFlowAssets, getFlowDetail } from "@/lib/services/flows";
import { FlowEditor } from "@/components/flows/flow-editor";

export const dynamic = "force-dynamic";

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await getFlowDetail(id);
  if (!flow || flow.status === "archived") notFound();
  const assets = await getFlowAssets(id);

  return (
    <FlowEditor
      flow={{
        id: flow.id,
        name: flow.name,
        status: flow.status,
        version: flow.version,
        graph: flow.graph,
        clientName: flow.clientName,
      }}
      initialAssets={assets}
    />
  );
}
