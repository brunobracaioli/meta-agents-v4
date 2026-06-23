"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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

const MIN_PASSWORD = 8;

export function SignupForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [scriptReady, setScriptReady] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const widgetContainer = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const captchaEnabled = Boolean(turnstileSiteKey);

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

  function resetCaptcha() {
    setCaptchaToken(null);
    if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(displayName ? { displayName } : {}),
          ...(captchaToken ? { turnstileToken: captchaToken } : {}),
        }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      if (res.status === 429) {
        setError("Muitas tentativas. Aguarde um minuto.");
      } else if (res.status === 403) {
        setError("Verificação de segurança falhou. Tente novamente.");
      } else if (res.status === 404) {
        setError("Cadastro indisponível.");
      } else {
        setError("Não foi possível criar a conta. Revise os dados e tente novamente.");
      }
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
    email.length === 0 ||
    password.length < MIN_PASSWORD ||
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
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-[var(--color-navy-soft)] p-8 shadow-xl">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-white">Criar conta de operador</h1>
          <p className="text-sm text-white/60">Agência de Agents</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-white/80">
              Conta criada. Se a confirmação por e-mail estiver ativa, verifique sua caixa de
              entrada antes de entrar.
            </p>
            <Link
              href="/login"
              className="block w-full rounded-lg bg-[var(--color-orange)] px-4 py-2 text-center font-medium text-black"
            >
              Ir para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
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

            <div className="space-y-2">
              <label htmlFor="displayName" className="block text-sm text-white/80">
                Nome (opcional)
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[var(--color-orange)]"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm text-white/80">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[var(--color-orange)]"
                minLength={MIN_PASSWORD}
                required
              />
              <p className="text-xs text-white/40">Mínimo {MIN_PASSWORD} caracteres.</p>
            </div>

            {turnstileSiteKey && <div ref={widgetContainer} className="min-h-[65px]" />}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitDisabled}
              className="w-full rounded-lg bg-[var(--color-orange)] px-4 py-2 font-medium text-black transition disabled:opacity-50"
            >
              {loading ? "Criando…" : "Criar conta"}
            </button>

            <p className="text-center text-sm text-white/60">
              Já tem conta?{" "}
              <Link href="/login" className="text-[var(--color-orange)] hover:underline">
                Entrar
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
