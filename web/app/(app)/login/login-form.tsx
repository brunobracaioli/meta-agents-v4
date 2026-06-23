"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export function LoginForm({
  turnstileSiteKey,
  authMode = "password",
  allowSignup = false,
}: {
  turnstileSiteKey: string | null;
  authMode?: "password" | "supabase";
  allowSignup?: boolean;
}) {
  const router = useRouter();
  // Per-operator (AUTH_MODE=supabase) needs an email; legacy single-password mode does not.
  const isSupabase = authMode === "supabase";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Turnstile state. captchaToken is set by the widget's callback; we require it
  // before enabling submit when a site key is configured.
  const [scriptReady, setScriptReady] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const widgetContainer = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const captchaEnabled = Boolean(turnstileSiteKey);

  // Explicit render: more reliable than implicit auto-render inside a React tree.
  useEffect(() => {
    if (!turnstileSiteKey || !scriptReady) return;
    if (!widgetContainer.current || widgetId.current) return;
    if (!window.turnstile) return;
    widgetId.current = window.turnstile.render(widgetContainer.current, {
      sitekey: turnstileSiteKey,
      theme: "dark",
      callback: (token) => setCaptchaToken(token),
      "error-callback": () => setCaptchaToken(null),
      "expired-callback": () => setCaptchaToken(null),
    });
  }, [turnstileSiteKey, scriptReady]);

  // Tokens are single-use; after a rejected attempt we must force a fresh challenge.
  function resetCaptcha() {
    setCaptchaToken(null);
    if (window.turnstile && widgetId.current) {
      window.turnstile.reset(widgetId.current);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isSupabase ? { email } : {}),
          password,
          ...(captchaToken ? { turnstileToken: captchaToken } : {}),
        }),
      });
      if (res.ok) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      if (res.status === 429) {
        setError("Muitas tentativas. Aguarde um minuto.");
      } else if (res.status === 403) {
        setError("Verificação de segurança falhou. Tente novamente.");
      } else if (res.status === 400 && captchaEnabled) {
        setError("Confirme a verificação de segurança e tente novamente.");
      } else {
        setError("Senha incorreta.");
      }
      // Any non-OK response invalidates the single-use token.
      if (captchaEnabled) resetCaptcha();
    } catch {
      setError("Falha de conexão. Tente novamente.");
      if (captchaEnabled) resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  const submitDisabled =
    loading ||
    password.length === 0 ||
    (isSupabase && email.length === 0) ||
    (captchaEnabled && !captchaToken);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {turnstileSiteKey && (
        <Script
          src={TURNSTILE_SCRIPT_URL}
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
      )}
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-[var(--color-navy-soft)] p-8 shadow-xl"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-white">Agência de Agents</h1>
          <p className="text-sm text-white/60">Acesso do operador</p>
        </div>

        {isSupabase && (
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm text-white/80">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[var(--color-orange)]"
              required
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm text-white/80">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[var(--color-orange)]"
            required
          />
        </div>

        {turnstileSiteKey && <div ref={widgetContainer} className="min-h-[65px]" />}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitDisabled}
          className="w-full rounded-lg bg-[var(--color-orange)] px-4 py-2 font-medium text-black transition disabled:opacity-50"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>

        {isSupabase && allowSignup && (
          <p className="text-center text-sm text-white/60">
            Não tem conta?{" "}
            <Link href="/signup" className="text-[var(--color-orange)] hover:underline">
              Criar conta
            </Link>
          </p>
        )}
      </form>
    </main>
  );
}
