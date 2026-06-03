import { notFound } from "next/navigation";
import { getLandingPageFull } from "@/lib/services/landing-page";
import { PreviewClient } from "./preview-client";

// The live draft preview, embedded in an <iframe> by the editor. Renders the SAME section
// components as the published static page (from @b2tech/lp-render), so what the operator
// sees here is what publish will build. Dynamic: always reflects the current Supabase draft.
export const dynamic = "force-dynamic";

export default async function LpPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getLandingPageFull(id);
  if (!full) notFound();
  return <PreviewClient initialDoc={full.doc} />;
}
