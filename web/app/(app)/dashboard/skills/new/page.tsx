import Link from "next/link";
import { listClientsLite } from "@/lib/services/skills-admin";
import { SkillWizard } from "@/components/skills/skill-wizard";

export const dynamic = "force-dynamic";

export default async function NewSkillPage() {
  const clients = await listClientsLite();

  return (
    <div className="space-y-7">
      <div>
        <Link href="/dashboard/skills" className="text-sm text-cyan-100/50 hover:text-cyan-100/80">
          ← Skills
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Nova skill</h1>
        <p className="mt-1 text-sm text-white/40">
          Descreva o objetivo; a IA redige a automação e você revisa antes de publicar.
        </p>
      </div>
      {clients.length === 0 ? (
        <p className="text-sm text-white/50">
          Você precisa cadastrar um cliente primeiro em{" "}
          <Link href="/dashboard/clients-management" className="text-orange-200">
            Clientes
          </Link>
          .
        </p>
      ) : (
        <SkillWizard clients={clients} />
      )}
    </div>
  );
}
