"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentDoc, Settings, Theme } from "@b2tech/lp-render/content-doc";
import { FieldEditor } from "@/components/landing/field-editor";
import { FONT_ALLOWLIST, COLOR_TOKENS } from "@/lib/landing/constants";
import type { LandingPageMeta } from "@/lib/services/landing-page";

type SaveState = { kind: "idle" | "saving" | "saved" | "error"; msg?: string };

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero",
  urgency: "Urgência",
  problem: "Problema",
  comparison: "Comparação",
  solution: "Solução",
  features: "Recursos",
  curriculum: "Conteúdo",
  stats: "Números",
  proof: "Provas",
  logos: "Logos",
  persona: "Persona",
  authority: "Autoridade",
  offer: "Oferta",
  guarantee: "Garantia",
  faq: "FAQ",
  finalCta: "CTA final",
  footer: "Rodapé",
};

const TAB_THEME = "__theme";
const TAB_SETTINGS = "__settings";

function withSectionFields(doc: ContentDoc, type: string, fields: Record<string, unknown>): ContentDoc {
  return {
    ...doc,
    sections: doc.sections.map((s) => (s.type === type ? { ...s, fields } : s)),
  };
}

const PANEL_INPUT =
  "w-full rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm text-white/90 outline-none focus:border-cyan-200/40";
const PANEL_LABEL = "block font-mono text-[10px] uppercase tracking-[0.14em] text-white/40";

export function LandingPageEditor({
  slug,
  product,
  meta: initialMeta,
  initialDoc,
  initialVersions,
}: {
  slug: string;
  product: string;
  meta: LandingPageMeta;
  initialDoc: ContentDoc;
  initialVersions: Record<string, number>;
}) {
  const [doc, setDoc] = useState<ContentDoc>(initialDoc);
  const [versions, setVersions] = useState<Record<string, number>>(initialVersions);
  const [meta, setMeta] = useState<LandingPageMeta>(initialMeta);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [active, setActive] = useState<string>(doc.sections[0]?.type ?? TAB_THEME);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [publishing, setPublishing] = useState(false);
  const [goLive, setGoLive] = useState(!initialMeta.noindex);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const versionsRef = useRef(versions);
  versionsRef.current = versions;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const readOnly = meta.draft_status === "generating" || meta.draft_status === "publishing";

  const postDoc = useCallback((d: ContentDoc) => {
    iframeRef.current?.contentWindow?.postMessage({ type: "lp-preview:doc", doc: d }, window.location.origin);
  }, []);

  const postScrollTo = useCallback((type: string) => {
    // Best-effort scroll: section roots have no stable per-type id, so target the index
    // within the enabled, ordered render list (matches the iframe's <section> order).
    const index = docRef.current.sections.filter((s) => s.enabled).findIndex((s) => s.type === type);
    if (index < 0) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "lp-preview:scrollTo", index },
      window.location.origin,
    );
  }, []);

  // Push the live doc to the iframe whenever it announces it's ready (it may mount after us).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type === "lp-preview:ready") postDoc(docRef.current);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postDoc]);

  // While the agents are still generating, poll the draft so blocks appear as they're written.
  useEffect(() => {
    if (meta.draft_status !== "generating") return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/landing-pages/${meta.id}`);
        if (!res.ok) return;
        const body = (await res.json()) as { meta: LandingPageMeta; doc: ContentDoc; versions: Record<string, number> };
        setDoc(body.doc);
        setVersions(body.versions);
        setMeta(body.meta);
        postDoc(body.doc);
      } catch {
        /* transient; next tick retries */
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [meta.draft_status, meta.id, postDoc]);

  const schedule = useCallback((key: string, fn: () => void, ms = 600) => {
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(key, setTimeout(fn, ms));
  }, []);

  const saveSection = useCallback(
    async (type: string, fields: Record<string, unknown>) => {
      setSave({ kind: "saving" });
      try {
        const res = await fetch(`/api/landing-pages/${meta.id}/sections/${type}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fields, version: versionsRef.current[type] ?? 1 }),
        });
        if (res.status === 409) {
          const body = (await res.json()) as { current: { version: number; fields: Record<string, unknown> } };
          setVersions((v) => ({ ...v, [type]: body.current.version }));
          const reconciled = withSectionFields(docRef.current, type, body.current.fields);
          setDoc(reconciled);
          postDoc(reconciled);
          setSave({ kind: "error", msg: "Recarregado: havia uma versão mais nova." });
          return;
        }
        if (res.status === 423) {
          setSave({ kind: "error", msg: "Página ocupada (gerando/publicando)." });
          return;
        }
        if (!res.ok) {
          setSave({ kind: "error", msg: "Falha ao salvar a seção." });
          return;
        }
        const body = (await res.json()) as { version: number };
        setVersions((v) => ({ ...v, [type]: body.version }));
        setSave({ kind: "saved" });
      } catch {
        setSave({ kind: "error", msg: "Erro de rede ao salvar." });
      }
    },
    [meta.id, postDoc],
  );

  const saveTheme = useCallback(
    async (theme: Theme) => {
      setSave({ kind: "saving" });
      try {
        const res = await fetch(`/api/landing-pages/${meta.id}/theme`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(theme),
        });
        setSave(res.ok ? { kind: "saved" } : { kind: "error", msg: "Falha ao salvar o tema." });
      } catch {
        setSave({ kind: "error", msg: "Erro de rede ao salvar o tema." });
      }
    },
    [meta.id],
  );

  const saveSettings = useCallback(
    async (settings: Settings) => {
      const patch: Record<string, unknown> = {
        seo: { title: settings.seo.title, description: settings.seo.description, ogAlt: settings.seo.ogAlt },
        price_cents: settings.price_cents,
        cart_state: settings.cart_state,
        cartClosed: {
          headline: settings.cartClosed.headline,
          subhead: settings.cartClosed.subhead,
          waitlistCtaLabel: settings.cartClosed.waitlistCtaLabel,
        },
      };
      if (/^https?:\/\//i.test(settings.checkout_url)) patch.checkout_url = settings.checkout_url;
      if (settings.waitlist_url && /^https?:\/\//i.test(settings.waitlist_url)) patch.waitlist_url = settings.waitlist_url;
      if (settings.deadline) patch.deadline = settings.deadline;
      setSave({ kind: "saving" });
      try {
        const res = await fetch(`/api/landing-pages/${meta.id}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        setSave(res.ok ? { kind: "saved" } : { kind: "error", msg: "Falha ao salvar as configurações." });
      } catch {
        setSave({ kind: "error", msg: "Erro de rede ao salvar." });
      }
    },
    [meta.id],
  );

  const onSectionChange = useCallback(
    (type: string, fields: Record<string, unknown>) => {
      const next = withSectionFields(docRef.current, type, fields);
      setDoc(next);
      postDoc(next);
      schedule(`section:${type}`, () => saveSection(type, fields));
    },
    [postDoc, schedule, saveSection],
  );

  const onThemeChange = useCallback(
    (theme: Theme) => {
      const next = { ...docRef.current, theme };
      setDoc(next);
      postDoc(next);
      schedule("theme", () => saveTheme(theme));
    },
    [postDoc, schedule, saveTheme],
  );

  const onSettingsChange = useCallback(
    (settings: Settings) => {
      const next = { ...docRef.current, settings };
      setDoc(next);
      postDoc(next);
      schedule("settings", () => saveSettings(settings));
    },
    [postDoc, schedule, saveSettings],
  );

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const res = await fetch(`/api/landing-pages/${meta.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noindex: !goLive }),
      });
      const body = (await res.json().catch(() => ({}))) as { enqueued?: boolean; reason?: string };
      if (res.ok && body.enqueued) {
        setSave({ kind: "saved", msg: "Publicação enfileirada — os agents publicam em até 1 min." });
        setMeta((m) => ({ ...m, draft_status: "publishing" }));
      } else {
        setSave({ kind: "error", msg: body.reason ?? "Falha ao enfileirar a publicação." });
      }
    } catch {
      setSave({ kind: "error", msg: "Erro de rede ao publicar." });
    } finally {
      setPublishing(false);
    }
  }, [meta.id, goLive]);

  const activeSection = useMemo(() => doc.sections.find((s) => s.type === active), [doc.sections, active]);

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/clients/${slug}/${product}`}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/40 hover:text-white"
          >
            ← {product}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold text-white">
            <span className="truncate">{meta.name}</span>
            <a
              href={meta.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs font-normal text-cyan-200/70 hover:text-cyan-100"
            >
              {meta.subdomain}.b2tech.io ↗
            </a>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label="rascunho" value={meta.draft_status} />
          <StatusBadge label="deploy" value={meta.status} />
          <SaveIndicator save={save} />
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {meta.draft_status === "generating"
            ? "Os agents estão gerando esta página — os blocos aparecem ao vivo e a edição fica travada até concluir."
            : "Publicação em andamento — edição temporariamente travada."}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[400px_1fr]">
        {/* Left: editor panels */}
        <div className="flex min-h-0 flex-col rounded-xl border border-white/8 bg-white/[0.02]">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1 border-b border-white/8 p-2">
            {doc.sections.map((s) => (
              <button
                key={s.type}
                type="button"
                onClick={() => {
                  setActive(s.type);
                  postScrollTo(s.type);
                }}
                className={`rounded px-2 py-1 text-xs transition ${
                  active === s.type
                    ? "bg-cyan-300/15 text-cyan-100"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {SECTION_LABELS[s.type] ?? s.type}
              </button>
            ))}
            <span className="mx-1 w-px self-stretch bg-white/10" />
            <button
              type="button"
              onClick={() => setActive(TAB_THEME)}
              className={`rounded px-2 py-1 text-xs transition ${
                active === TAB_THEME ? "bg-orange-300/15 text-orange-100" : "text-white/55 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              Tema
            </button>
            <button
              type="button"
              onClick={() => setActive(TAB_SETTINGS)}
              className={`rounded px-2 py-1 text-xs transition ${
                active === TAB_SETTINGS ? "bg-orange-300/15 text-orange-100" : "text-white/55 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              Config
            </button>
          </div>

          {/* Active panel */}
          <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
            {active === TAB_THEME ? (
              <ThemeEditor theme={doc.theme} onChange={onThemeChange} />
            ) : active === TAB_SETTINGS ? (
              <SettingsEditor settings={doc.settings} onChange={onSettingsChange} />
            ) : activeSection ? (
              <FieldEditor
                value={activeSection.fields}
                onChange={(fields) => onSectionChange(activeSection.type, fields)}
              />
            ) : (
              <p className="text-sm text-white/40">Selecione uma seção.</p>
            )}
          </div>

          {/* Publish footer */}
          <div className="space-y-2 border-t border-white/8 p-3">
            <label className="flex items-center gap-2 text-xs text-white/60">
              <input type="checkbox" checked={goLive} onChange={(e) => setGoLive(e.target.checked)} />
              Publicar indexável (go-live){goLive ? "" : " — preview noindex"}
            </label>
            <button
              type="button"
              onClick={publish}
              disabled={publishing || meta.draft_status === "publishing"}
              className="w-full rounded-lg border border-orange-300/30 bg-orange-400/15 px-3 py-2 text-sm font-medium text-orange-100 transition hover:border-orange-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishing || meta.draft_status === "publishing" ? "Publicando…" : "Publicar no Cloudflare"}
            </button>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="flex min-h-0 flex-col rounded-xl border border-white/8 bg-[#0b1018]">
          <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">Pré-visualização ao vivo</span>
            <div className="flex gap-1">
              <DeviceButton active={device === "desktop"} onClick={() => setDevice("desktop")} label="Desktop" />
              <DeviceButton active={device === "mobile"} onClick={() => setDevice("mobile")} label="Mobile" />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-[#05080f] p-3">
            <iframe
              ref={iframeRef}
              src={`/lp-preview/${meta.id}`}
              title="Pré-visualização da landing page"
              className="h-full rounded-md border border-white/10 bg-white shadow-2xl transition-[width]"
              style={{ width: device === "mobile" ? 390 : "100%", maxWidth: "100%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
      {label}: <span className="text-white/80">{value}</span>
    </span>
  );
}

function SaveIndicator({ save }: { save: SaveState }) {
  const text =
    save.kind === "saving"
      ? "salvando…"
      : save.kind === "saved"
        ? (save.msg ?? "salvo")
        : save.kind === "error"
          ? (save.msg ?? "erro")
          : "";
  if (!text) return null;
  const color =
    save.kind === "error" ? "text-amber-200" : save.kind === "saving" ? "text-white/40" : "text-emerald-200";
  return <span className={`text-xs ${color}`}>{text}</span>;
}

function DeviceButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs transition ${
        active ? "bg-cyan-300/15 text-cyan-100" : "text-white/50 hover:bg-white/[0.04] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// ---------- Theme editor ----------
function ThemeEditor({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const colors = theme.colors ?? {};
  const fonts = theme.fonts ?? {};
  const setColor = (key: string, value: string) => onChange({ ...theme, colors: { ...colors, [key]: value } });
  const setFont = (key: "title" | "body", value: string) =>
    onChange({ ...theme, fonts: { ...fonts, [key]: value } });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className={PANEL_LABEL}>Cores</span>
        {COLOR_TOKENS.map(({ key, label }) => {
          const current = (colors as Record<string, string | undefined>)[key] ?? "";
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : "#000000"}
                onChange={(e) => setColor(key, e.target.value)}
                className="h-7 w-9 shrink-0 rounded border border-white/10 bg-transparent"
                aria-label={label}
              />
              <input
                className={PANEL_INPUT}
                placeholder={label}
                value={current}
                onChange={(e) => setColor(key, e.target.value)}
              />
              <span className="w-28 shrink-0 truncate text-[10px] text-white/35">{label}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={PANEL_LABEL}>Fonte títulos</span>
          <select className={PANEL_INPUT} value={fonts.title ?? ""} onChange={(e) => setFont("title", e.target.value)}>
            <option value="">(padrão)</option>
            {FONT_ALLOWLIST.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={PANEL_LABEL}>Fonte corpo</span>
          <select className={PANEL_INPUT} value={fonts.body ?? ""} onChange={(e) => setFont("body", e.target.value)}>
            <option value="">(padrão)</option>
            {FONT_ALLOWLIST.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1">
        <span className={PANEL_LABEL}>Escala tipográfica ({(theme.scale ?? 1).toFixed(2)}×)</span>
        <input
          type="range"
          min={0.8}
          max={1.3}
          step={0.01}
          value={theme.scale ?? 1}
          onChange={(e) => onChange({ ...theme, scale: Number(e.target.value) })}
          className="w-full"
        />
      </label>
    </div>
  );
}

// ---------- Settings editor ----------
function SettingsEditor({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className={PANEL_LABEL}>SEO</span>
        <input
          className={PANEL_INPUT}
          placeholder="Título"
          value={settings.seo.title}
          onChange={(e) => set({ seo: { ...settings.seo, title: e.target.value } })}
        />
        <textarea
          className={`${PANEL_INPUT} min-h-[60px] resize-y`}
          placeholder="Descrição"
          value={settings.seo.description}
          onChange={(e) => set({ seo: { ...settings.seo, description: e.target.value } })}
        />
        <input
          className={PANEL_INPUT}
          placeholder="Texto alternativo da imagem OG"
          value={settings.seo.ogAlt}
          onChange={(e) => set({ seo: { ...settings.seo, ogAlt: e.target.value } })}
        />
      </div>

      <div className="space-y-2">
        <span className={PANEL_LABEL}>Oferta</span>
        <label className="flex items-center gap-2 text-xs text-white/60">
          Estado do carrinho:
          <select
            className={`${PANEL_INPUT} w-auto`}
            value={settings.cart_state}
            onChange={(e) => set({ cart_state: e.target.value === "closed" ? "closed" : "open" })}
          >
            <option value="open">aberto</option>
            <option value="closed">fechado (waitlist)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={PANEL_LABEL}>Preço (centavos)</span>
          <input
            type="number"
            className={PANEL_INPUT}
            value={settings.price_cents}
            onChange={(e) => set({ price_cents: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
        </label>
        <label className="space-y-1">
          <span className={PANEL_LABEL}>URL de checkout</span>
          <input
            className={PANEL_INPUT}
            value={settings.checkout_url}
            onChange={(e) => set({ checkout_url: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className={PANEL_LABEL}>URL da waitlist</span>
          <input
            className={PANEL_INPUT}
            value={settings.waitlist_url ?? ""}
            onChange={(e) => set({ waitlist_url: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className={PANEL_LABEL}>Deadline (ISO 8601, opcional)</span>
          <input
            className={PANEL_INPUT}
            placeholder="2026-12-31T23:59:00-03:00"
            value={settings.deadline ?? ""}
            onChange={(e) => set({ deadline: e.target.value })}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className={PANEL_LABEL}>Carrinho fechado (waitlist)</span>
        <input
          className={PANEL_INPUT}
          placeholder="Headline"
          value={settings.cartClosed.headline}
          onChange={(e) => set({ cartClosed: { ...settings.cartClosed, headline: e.target.value } })}
        />
        <textarea
          className={`${PANEL_INPUT} min-h-[56px] resize-y`}
          placeholder="Subhead"
          value={settings.cartClosed.subhead}
          onChange={(e) => set({ cartClosed: { ...settings.cartClosed, subhead: e.target.value } })}
        />
        <input
          className={PANEL_INPUT}
          placeholder="Rótulo do CTA da waitlist"
          value={settings.cartClosed.waitlistCtaLabel}
          onChange={(e) => set({ cartClosed: { ...settings.cartClosed, waitlistCtaLabel: e.target.value } })}
        />
      </div>
    </div>
  );
}
