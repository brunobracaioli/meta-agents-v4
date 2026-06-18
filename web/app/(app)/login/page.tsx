import { env } from "@/lib/env";
import { LoginForm } from "./login-form";

// Server component: reads the (public) Turnstile site key server-side so we don't
// need a NEXT_PUBLIC_ var, then hands it to the client form. Null when Turnstile
// is not configured, in which case the widget is skipped.
export default function LoginPage() {
  return (
    <LoginForm
      turnstileSiteKey={env.turnstileSiteKey() ?? null}
      authMode={env.authMode()}
      allowSignup={env.allowSignup()}
    />
  );
}
