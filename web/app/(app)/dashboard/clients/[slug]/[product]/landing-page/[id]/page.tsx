import { notFound } from "next/navigation";
import { getLandingPageFullForRoute } from "@/lib/services/landing-page";
import { LandingPageEditor } from "@/components/landing/landing-page-editor";

export const dynamic = "force-dynamic";

export default async function LandingPageEditorPage({
  params,
}: {
  params: Promise<{ slug: string; product: string; id: string }>;
}) {
  const { slug, product, id } = await params;
  const full = await getLandingPageFullForRoute(slug, product, id);
  if (!full) notFound();
  return (
    <LandingPageEditor
      slug={slug}
      product={product}
      meta={full.meta}
      initialDoc={full.doc}
      initialVersions={full.versions}
    />
  );
}
