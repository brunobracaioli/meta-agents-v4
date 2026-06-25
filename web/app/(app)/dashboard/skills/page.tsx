import Link from "next/link";
import { listSkillsForOperator } from "@/lib/services/skills-admin";
import { SkillsManager } from "@/components/skills/skills-manager";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const skills = await listSkillsForOperator();

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Skills</h1>
          <p className="mt-1 text-sm text-white/40">
            {skills.length} skill{skills.length === 1 ? "" : "s"} · automações que seus agentes executam
          </p>
        </div>
        <Link
          href="/dashboard/skills/new"
          className="rounded-lg border border-orange-300/35 bg-orange-400/10 px-4 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-400/20"
        >
          + Nova skill
        </Link>
      </div>
      <SkillsManager initialSkills={skills} />
    </div>
  );
}
