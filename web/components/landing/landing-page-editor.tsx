"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentDoc, Settings, Theme } from "@b2tech/lp-render/content-doc";
import { FieldEditor, ImageField, SECTION_IMAGE_KEYS } from "@/components/landing/field-editor";
import { FONT_ALLOWLIST, COLOR_TOKENS } from "@/lib/landing/constants";
import {
  reconcile,
  sectionDirtyKey,
  THEME_DIRTY_KEY,
  SETTINGS_DIRTY_KEY,
} from "@/lib/landing/reconcile";
import {
  LANDING_EDIT_CHANNEL,
  LANDING_EDIT_EVENT,
  isLandingEditSignal,
} from "@/lib/ultron/agent-trigger";
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
  ccaf: "Certificação",
  offer: "Oferta",
  guarantee: "Garantia",
  faq: "FAQ",
  finalCta: "CTA final",
  footer: "Rodapé",
};

const TAB_THEME = "__theme";
const TAB_SETTINGS = "__settings";
const TAB_TRACKING = "__tracking";

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
  // Keys (sectionDirtyKey/THEME_DIRTY_KEY/SETTINGS_DIRTY_KEY) the operator is actively
  // editing: reconcile leaves these alone so a remote (Ultron) edit can't clobber typing.
  const dirty = useRef(new Set<string>());

  const readOnly = meta.draft_status === "generating" || meta.draft_status === "publishing";
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

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

  // Merge a freshly-fetched remote draft into local state without losing in-flight edits.
  // "Local wins": dirty sections/theme/settings are skipped (resolved at save by the 409
  // guard). Only applies changes — and re-renders / re-posts to the iframe — when something
  // actually advanced, so an idle poll is a no-op.
  const reconcileWith = useCallback(
    (remoteDoc: ContentDoc, remoteVersions: Record<string, number>) => {
      const result = reconcile({
        localDoc: docRef.current,
        localVersions: versionsRef.current,
        remoteDoc,
        remoteVersions,
        dirty: dirty.current,
      });
      if (!result.changed) return;
      setDoc(result.doc);
      setVersions(result.versions);
      postDoc(result.doc);
    },
    [postDoc],
  );

  const reconcileFromServer = useCallback(async () => {
    if (readOnlyRef.current) return;
    try {
      const res = await fetch(`/api/landing-pages/${meta.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { doc: ContentDoc; versions: Record<string, number> };
      reconcileWith(body.doc, body.versions);
    } catch {
      /* transient; the safety poll retries */
    }
  }, [meta.id, reconcileWith]);

  // Push path: Ultron writes edits straight to Supabase, then the chat reply fans the
  // applied edit back to this browser as a CustomEvent (same tab) / BroadcastChannel
  // (cross tab). On a signal for THIS page we refetch and reconcile — near-instant.
  useEffect(() => {
    const onSignal = (value: unknown) => {
      if (!isLandingEditSignal(value) || value.landingPageId !== meta.id) return;
      void reconcileFromServer();
    };
    const onLocal = (event: Event) => onSignal((event as CustomEvent<unknown>).detail);
    window.addEventListener(LANDING_EDIT_EVENT, onLocal);

    if (!("BroadcastChannel" in window)) {
      return () => window.removeEventListener(LANDING_EDIT_EVENT, onLocal);
    }
    const channel = new BroadcastChannel(LANDING_EDIT_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => onSignal(event.data);
    return () => {
      window.removeEventListener(LANDING_EDIT_EVENT, onLocal);
      channel.close();
    };
  }, [meta.id, reconcileFromServer]);

  // Safety poll: once the draft is editable, reconcile every few seconds while the tab is
  // visible. Catches edits from any source the push path can't reach (headless runner,
  // cron, another device/tab without the widget). Pauses when hidden; catches up on focus.
  useEffect(() => {
    if (meta.draft_status === "generating" || readOnly) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void reconcileFromServer();
    };
    const iv = setInterval(tick, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcileFromServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [meta.draft_status, readOnly, reconcileFromServer]);

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
      } finally {
        // Section is no longer in-flight — remote reconciles may touch it again.
        dirty.current.delete(sectionDirtyKey(type));
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
      } finally {
        dirty.current.delete(THEME_DIRTY_KEY);
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
      } finally {
        dirty.current.delete(SETTINGS_DIRTY_KEY);
      }
    },
    [meta.id],
  );

  const onSectionChange = useCallback(
    (type: string, fields: Record<string, unknown>) => {
      dirty.current.add(sectionDirtyKey(type));
      const next = withSectionFields(docRef.current, type, fields);
      setDoc(next);
      postDoc(next);
      schedule(`section:${type}`, () => saveSection(type, fields));
    },
    [postDoc, schedule, saveSection],
  );

  const onThemeChange = useCallback(
    (theme: Theme) => {
      dirty.current.add(THEME_DIRTY_KEY);
      const next = { ...docRef.current, theme };
      setDoc(next);
      postDoc(next);
      schedule("theme", () => saveTheme(theme));
    },
    [postDoc, schedule, saveTheme],
  );

  const onSettingsChange = useCallback(
    (settings: Settings) => {
      dirty.current.add(SETTINGS_DIRTY_KEY);
      const next = { ...docRef.current, settings };
      setDoc(next);
      postDoc(next);
      schedule("settings", () => saveSettings(settings));
    },
    [postDoc, schedule, saveSettings],
  );

  // Tracking lives inside settings.tracking, but only the PUBLIC ID arrays are editable
  // here — consent_key and the legacy single fields are preserved server-side by the
  // shallow merge. Server-side CAPI secrets never pass through this path (Phase 2).
  const saveTracking = useCallback(
    async (tracking: Settings["tracking"]) => {
      const patch = {
        tracking: {
          meta_pixels: tracking.meta_pixels ?? [],
          ga4_ids: tracking.ga4_ids ?? [],
          google_ads_ids: tracking.google_ads_ids ?? [],
        },
      };
      setSave({ kind: "saving" });
      try {
        const res = await fetch(`/api/landing-pages/${meta.id}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        setSave(res.ok ? { kind: "saved" } : { kind: "error", msg: "Falha ao salvar o tracking." });
      } catch {
        setSave({ kind: "error", msg: "Erro de rede ao salvar." });
      } finally {
        dirty.current.delete(SETTINGS_DIRTY_KEY);
      }
    },
    [meta.id],
  );

  const onTrackingChange = useCallback(
    (tracking: Settings["tracking"]) => {
      dirty.current.add(SETTINGS_DIRTY_KEY);
      const next = { ...docRef.current, settings: { ...docRef.current.settings, tracking } };
      setDoc(next);
      postDoc(next);
      schedule("tracking", () => saveTracking(tracking));
    },
    [postDoc, schedule, saveTracking],
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
            <button
              type="button"
              onClick={() => setActive(TAB_TRACKING)}
              className={`rounded px-2 py-1 text-xs transition ${
                active === TAB_TRACKING ? "bg-orange-300/15 text-orange-100" : "text-white/55 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              Tracking
            </button>
          </div>

          {/* Active panel */}
          <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
            {active === TAB_THEME ? (
              <ThemeEditor theme={doc.theme} onChange={onThemeChange} />
            ) : active === TAB_SETTINGS ? (
              <SettingsEditor settings={doc.settings} landingPageId={meta.id} onChange={onSettingsChange} />
            ) : active === TAB_TRACKING ? (
              <TrackingEditor tracking={doc.settings.tracking} onChange={onTrackingChange} lpId={meta.id} />
            ) : activeSection ? (
              <FieldEditor
                value={activeSection.fields}
                landingPageId={meta.id}
                imageKeys={SECTION_IMAGE_KEYS[activeSection.type] ?? []}
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
function SettingsEditor({
  settings,
  landingPageId,
  onChange,
}: {
  settings: Settings;
  landingPageId: string;
  onChange: (s: Settings) => void;
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className={PANEL_LABEL}>Marca</span>
        <ImageField
          label="Logo (topo do hero)"
          value={settings.logo ?? ""}
          landingPageId={landingPageId}
          onChange={(v) => set({ logo: v })}
        />
      </div>

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
        <ImageField
          label="Imagem OG (preview social, 1200×630)"
          value={settings.seo.ogImage ?? ""}
          landingPageId={landingPageId}
          onChange={(v) => set({ seo: { ...settings.seo, ogImage: v } })}
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

// ---------- Tracking editor ----------
// Manages the PUBLIC tracking IDs only (Meta pixels, GA4, Google Ads). These get baked into
// the public static site, so they're never secret. The server-side CAPI tokens / API secrets
// are a separate, write-only store (Phase 2) — never entered through this object. SPEC-015.
type Tracking = Settings["tracking"];

// Light client-side format hints (mirror the strict server schema in lib/landing/validate.ts).
const ID_PATTERNS: Record<"meta_pixels" | "ga4_ids" | "google_ads_ids", RegExp> = {
  meta_pixels: /^\d{15,16}$/,
  ga4_ids: /^G-[A-Z0-9]{6,12}$/,
  google_ads_ids: /^AW-[0-9]{9,12}(\/[A-Za-z0-9_-]{1,40})?$/,
};
const MAX_TRACKING_IDS = 10;

function IdListField({
  label,
  hint,
  placeholder,
  pattern,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  pattern: RegExp;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const setAt = (i: number, v: string) => onChange(values.map((x, j) => (j === i ? v : x)));
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => {
    if (values.length >= MAX_TRACKING_IDS) return;
    onChange([...values, ""]);
  };
  return (
    <div className="space-y-2">
      <span className={PANEL_LABEL}>{label}</span>
      {values.length === 0 && <p className="text-[11px] text-white/35">Nenhum configurado.</p>}
      {values.map((value, i) => {
        const invalid = value.trim() !== "" && !pattern.test(value.trim());
        return (
          <div key={i} className="flex items-center gap-2">
            <input
              className={`${PANEL_INPUT} ${invalid ? "border-amber-300/50" : ""}`}
              placeholder={placeholder}
              value={value}
              onChange={(e) => setAt(i, e.target.value)}
              aria-invalid={invalid}
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="shrink-0 rounded border border-white/10 px-2 py-1.5 text-xs text-white/50 transition hover:border-amber-300/40 hover:text-amber-100"
              aria-label={`Remover ${label}`}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        disabled={values.length >= MAX_TRACKING_IDS}
        className="rounded border border-white/10 px-2 py-1 text-xs text-white/60 transition hover:border-cyan-200/40 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Adicionar
      </button>
      <p className="text-[10px] text-white/30">{hint}</p>
    </div>
  );
}

function TrackingEditor({
  tracking,
  onChange,
  lpId,
}: {
  tracking: Tracking;
  onChange: (t: Tracking) => void;
  lpId: string;
}) {
  // Read with back-compat: if the multi arrays are empty, surface the legacy single field so
  // the operator sees the pixel the page was generated with and can grow the list from there.
  const metaPixels = tracking.meta_pixels?.length
    ? tracking.meta_pixels
    : tracking.fb_pixel_id
      ? [tracking.fb_pixel_id]
      : [];
  const ga4Ids = tracking.ga4_ids?.length ? tracking.ga4_ids : tracking.ga4_id ? [tracking.ga4_id] : [];
  const googleAdsIds = tracking.google_ads_ids ?? [];

  const setList = (key: "meta_pixels" | "ga4_ids" | "google_ads_ids", next: string[]) =>
    onChange({ ...tracking, [key]: next });

  return (
    <div className="space-y-5">
      <p className="text-[11px] leading-relaxed text-white/40">
        IDs públicos disparados na página (após o consentimento LGPD). O checkout em si é
        traqueado pela plataforma (Hubla/Hotmart). Você pode ter mais de um de cada.
      </p>

      <IdListField
        label="Meta Pixel"
        placeholder="653995666521954"
        hint="ID numérico do Pixel (15–16 dígitos)."
        pattern={ID_PATTERNS.meta_pixels}
        values={metaPixels}
        onChange={(next) => setList("meta_pixels", next)}
      />

      <IdListField
        label="Google Analytics 4"
        placeholder="G-XXXXXXXXXX"
        hint="Measurement ID do GA4 (começa com G-)."
        pattern={ID_PATTERNS.ga4_ids}
        values={ga4Ids}
        onChange={(next) => setList("ga4_ids", next)}
      />

      <IdListField
        label="Google Ads"
        placeholder="AW-123456789"
        hint="ID de conversão do Google Ads (AW-…), com label opcional após a barra."
        pattern={ID_PATTERNS.google_ads_ids}
        values={googleAdsIds}
        onChange={(next) => setList("google_ads_ids", next)}
      />

      <CapiSecretsEditor lpId={lpId} metaPixels={metaPixels} />

      <TrackingHealth lpId={lpId} />
    </div>
  );
}

// Read-only health panel over the lp_events mirror (last 7d). No PII — only volume, CAPI
// success rate, match-proxy and UTM coverage. Renders nothing until there are events.
function TrackingHealth({ lpId }: { lpId: string }) {
  const [data, setData] = useState<{
    total: number;
    byName: Record<string, number>;
    capi: { attempted: number; ok: number };
    match: { email: number; phone: number };
    utmCoverage: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/landing-pages/${lpId}/tracking-health`);
        if (r.ok && alive) setData(await r.json());
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      alive = false;
    };
  }, [lpId]);

  if (!data) return null;
  if (data.total === 0) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/[0.015] p-3">
        <span className={PANEL_LABEL}>Saúde do tracking (7d)</span>
        <p className="mt-1 text-[10px] text-white/30">Sem eventos server-side ainda.</p>
      </div>
    );
  }
  const capiPct = data.capi.attempted ? Math.round((100 * data.capi.ok) / data.capi.attempted) : null;
  const topEvents = Object.entries(data.byName).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.015] p-3">
      <span className={PANEL_LABEL}>Saúde do tracking (7d)</span>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="font-mono text-lg text-white/85">{data.total}</div>
          <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">Eventos</div>
        </div>
        <div>
          <div className="font-mono text-lg text-white/85">{capiPct === null ? "—" : `${capiPct}%`}</div>
          <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">CAPI 200</div>
        </div>
        <div>
          <div className="font-mono text-lg text-white/85">
            {data.total ? Math.round((100 * data.utmCoverage) / data.total) : 0}%
          </div>
          <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">UTM</div>
        </div>
      </div>
      <div className="space-y-1 border-t border-white/8 pt-2">
        {topEvents.map(([name, n]) => (
          <div key={name} className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-white/55">{name}</span>
            <span className="text-white/40">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Write-only editor for the server-side conversion SECRETS (Meta CAPI). Tokens are sent to the
// isolated, RLS-locked store via PUT and are NEVER read back — the status endpoint only tells us
// which pixels already have a token. Saving activates server-side on the next publish.
// See ADR 0021 / SPEC-015 §7.5.
function CapiSecretsEditor({ lpId, metaPixels }: { lpId: string; metaPixels: string[] }) {
  const [configured, setConfigured] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/landing-pages/${lpId}/tracking-secrets/status`);
      if (!r.ok) return;
      const d = (await r.json()) as { secrets?: { provider: string; public_id: string }[] };
      setConfigured(new Set((d.secrets ?? []).filter((s) => s.provider === "meta").map((s) => s.public_id)));
    } catch {
      /* status is best-effort */
    }
  }, [lpId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (pixel: string) => {
    const token = (tokens[pixel] ?? "").trim();
    if (token.length < 10) {
      setMsg("Token CAPI muito curto.");
      return;
    }
    setBusy(pixel);
    setMsg("");
    try {
      const entry: Record<string, unknown> = { provider: "meta", public_id: pixel, secret: { capi_token: token } };
      const code = (codes[pixel] ?? "").trim();
      if (code) entry.test_event_code = code;
      const r = await fetch(`/api/landing-pages/${lpId}/tracking-secrets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: [entry] }),
      });
      if (r.ok) {
        setTokens((t) => ({ ...t, [pixel]: "" }));
        setMsg("Token salvo. Republique a página para ativar o server-side.");
        await load();
      } else {
        const d = (await r.json().catch(() => ({}))) as { detail?: string };
        setMsg(d.detail ?? "Falha ao salvar o token.");
      }
    } catch {
      setMsg("Erro de rede ao salvar.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (pixel: string) => {
    setBusy(pixel);
    setMsg("");
    try {
      const r = await fetch(`/api/landing-pages/${lpId}/tracking-secrets`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "meta", public_id: pixel }),
      });
      setMsg(r.ok ? "Token removido." : "Falha ao remover.");
      await load();
    } catch {
      setMsg("Erro de rede ao remover.");
    } finally {
      setBusy(null);
    }
  };

  const pixels = metaPixels.filter((p) => p.trim() !== "");

  return (
    <div className="space-y-3 rounded-lg border border-white/8 bg-white/[0.015] p-3">
      <span className={PANEL_LABEL}>Conversões server-side (Meta CAPI)</span>
      <p className="text-[10px] leading-relaxed text-white/35">
        Envio server-side via Cloudflare (CAPI + dedup por event_id) para EMQ alto. O token é um
        segredo: vai para um cofre isolado e <strong>nunca</strong> aparece na página nem é
        devolvido. Salvar ativa no <strong>próximo publish</strong>.
      </p>

      {pixels.length === 0 && (
        <p className="text-[11px] text-white/35">Adicione um Meta Pixel acima para configurar o CAPI.</p>
      )}

      {pixels.map((pixel) => (
        <div key={pixel} className="space-y-2 rounded border border-white/8 p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-white/70">{pixel}</span>
            {configured.has(pixel) ? (
              <span className="rounded border border-emerald-300/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-200/80">
                configurado
              </span>
            ) : (
              <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                sem token
              </span>
            )}
          </div>
          <input
            type="password"
            autoComplete="off"
            className={PANEL_INPUT}
            placeholder={configured.has(pixel) ? "Substituir token CAPI…" : "Colar o token CAPI…"}
            value={tokens[pixel] ?? ""}
            onChange={(e) => setTokens((t) => ({ ...t, [pixel]: e.target.value }))}
          />
          <input
            className={PANEL_INPUT}
            placeholder="test_event_code (opcional, só homologação)"
            value={codes[pixel] ?? ""}
            onChange={(e) => setCodes((c) => ({ ...c, [pixel]: e.target.value }))}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => save(pixel)}
              disabled={busy === pixel}
              className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 transition hover:border-emerald-200/40 hover:text-emerald-100 disabled:opacity-40"
            >
              {busy === pixel ? "Salvando…" : "Salvar token"}
            </button>
            {configured.has(pixel) && (
              <button
                type="button"
                onClick={() => remove(pixel)}
                disabled={busy === pixel}
                className="rounded border border-white/10 px-2 py-1 text-xs text-white/50 transition hover:border-amber-300/40 hover:text-amber-100 disabled:opacity-40"
              >
                Remover
              </button>
            )}
          </div>
        </div>
      ))}

      {msg && <p className="text-[10px] text-white/45">{msg}</p>}
    </div>
  );
}
