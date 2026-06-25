import Link from "next/link";
import { notFound } from "next/navigation";
import { getSkillForEdit, getScheduleForSkill, listClientsLite } from "@/lib/services/skills-admin";
import { SkillWizard } from "@/components/skills/skill-wizard";
import { ScheduleEditor } from "@/components/skills/schedule-editor";

export const dynamic = "force-dynamic";

export default async function EditSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [skill, clients, schedule] = await Promise.all([
    getSkillForEdit(id),
    listClientsLite(),
    getScheduleForSkill(id),
  ]);
  if (!skill) notFound();

  return (
    <div className="space-y-7">
      <div>
        <Link href="/dashboard/skills" className="text-sm text-cyan-100/50 hover:text-cyan-100/80">
          ← Skills
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">{skill.name}</h1>
        <p className="mt-1 font-mono text-sm text-white/40">{skill.slug}</p>
      </div>
      <SkillWizard clients={clients} existingSkill={skill} />
      <ScheduleEditor skillId={skill.id} initial={schedule} />
    </div>
  );
}
