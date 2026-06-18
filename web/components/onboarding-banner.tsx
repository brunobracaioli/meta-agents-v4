import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { getCurrentOperatorId, getOperatorStatus, type OperatorStatus } from "@/lib/auth/current-operator";

/**
 * Thin onboarding bar shown until the operator's runner is ready (ADR 0027, Phase 6).
 * Renders nothing in password mode (no operator concept) or when fully onboarded.
 */
function stepMessage(st: OperatorStatus): string | null {
  if (st.status === "suspended") return "Sua conta está suspensa — fale com o suporte.";
  if (st.runner_status === "ready") return null; // fully onboarded
  if (st.runner_status === "error")
    return "Houve um erro no provisionamento do seu runner. Verifique os logs e tente novamente.";
  if (st.runner_status === "provisioned")
    return "Runner provisionado — conclua o login do Claude (claude login) e conecte Meta/Google nos connectors do claude.ai.";
  // 'none'
  return "Configure seu runner para começar: provisione o app Fly e conecte os connectors (Meta/Google).";
}

export async function OnboardingBanner() {
  if (env.authMode() !== "supabase") return null;
  const store = await cookies();
  const operatorId = await getCurrentOperatorId({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: () => {},
  });
  if (!operatorId) return null;

  const st = await getOperatorStatus(operatorId);
  if (!st) return null;
  const msg = stepMessage(st);
  if (!msg) return null;

  return (
    <div className="border-b border-amber-300/20 bg-amber-400/10 px-4 py-2 text-center text-sm text-amber-100 sm:px-6">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-200/70">Onboarding</span>{" "}
      {msg}
    </div>
  );
}
