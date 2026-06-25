import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlugs } from "@/lib/services/products-admin";
import { SkillWizard } from "@/components/skills/skill-wizard";

export const dynamic = "force-dynamic";

export default async function NewProductSkillPage({
  params,
}: {
  params: Promise<{ slug: string; product: string }>;
}) {
  const { slug, product } = await params;
  const prod = await getProductBySlugs(slug, product);
  if (!prod) notFound();

  return (
    <div className="space-y-7">
      <div>
        <Link
          href={`/dashboard/clients/${slug}/${product}`}
          className="text-sm text-cyan-100/50 hover:text-cyan-100/80"
        >
          ← {prod.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Nova skill</h1>
        <p className="mt-1 text-sm text-white/40">
          Descreva o objetivo; a IA redige a automação para este produto e você revisa antes de publicar.
        </p>
      </div>
      <SkillWizard product={{ id: prod.id, slug: prod.slug, name: prod.name }} clientSlug={slug} />
    </div>
  );
}
