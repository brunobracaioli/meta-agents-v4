import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlugs } from "@/lib/services/products-admin";
import { getSkillForEdit, getScheduleForSkill } from "@/lib/services/skills-admin";
import { SkillWizard } from "@/components/skills/skill-wizard";
import { ScheduleEditor } from "@/components/skills/schedule-editor";

export const dynamic = "force-dynamic";

export default async function EditProductSkillPage({
  params,
}: {
  params: Promise<{ slug: string; product: string; skillId: string }>;
}) {
  const { slug, product, skillId } = await params;
  const prod = await getProductBySlugs(slug, product);
  if (!prod) notFound();

  const [skill, schedule] = await Promise.all([getSkillForEdit(skillId), getScheduleForSkill(skillId)]);
  // Defence in depth: the skill must belong to THIS product (not just be owned by the operator).
  if (!skill || skill.product_id !== prod.id) notFound();

  return (
    <div className="space-y-7">
      <div>
        <Link
          href={`/dashboard/clients/${slug}/${product}`}
          className="text-sm text-cyan-100/50 hover:text-cyan-100/80"
        >
          ← {prod.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">{skill.name}</h1>
        <p className="mt-1 font-mono text-sm text-white/40">{skill.slug}</p>
      </div>
      <SkillWizard
        product={{ id: prod.id, slug: prod.slug, name: prod.name }}
        clientSlug={slug}
        existingSkill={skill}
      />
      <ScheduleEditor skillId={skill.id} initial={schedule} />
    </div>
  );
}
