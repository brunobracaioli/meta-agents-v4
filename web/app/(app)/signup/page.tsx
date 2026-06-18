import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { SignupForm } from "./signup-form";

// Signup only exists in per-operator mode (AUTH_MODE=supabase) with open signup enabled.
// Otherwise it does not apply — bounce to login. The /api/auth/signup handler enforces the
// same rule server-side (404), and onboarding is invite/admin-gated by default (threat model).
export default function SignupPage() {
  if (env.authMode() !== "supabase" || !env.allowSignup()) redirect("/login");
  return <SignupForm turnstileSiteKey={env.turnstileSiteKey() ?? null} />;
}
