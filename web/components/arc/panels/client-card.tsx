"use client";

// SPEC-019 Wave B — the client card panel (client element), screen 3 of the folder flow. Shows
// the avatar (initial), name, site, products and skills the open_client render-tool resolved from
// `products` + `client_skills` (SPEC-018). `data` is opaque on the transport, so every field is
// narrowed defensively; a missing/odd shape degrades to a notice instead of crashing the stage.

type ProductRow = { slug: string; name: string; default_subdomain: string | null; status: string };
type SkillRow = {
  slug: string;
  name: string;
  capability: "read" | "write" | string;
  status: string;
  ultron_enabled: boolean;
};
type ClientCard = {
  slug: string;
  name: string;
  site: string | null;
  products: ProductRow[];
  skills: SkillRow[];
};

function asArray<T>(v: unknown, guard: (x: unknown) => x is T): T[] {
  return Array.isArray(v) ? v.filter(guard) : [];
}
function isProduct(v: unknown): v is ProductRow {
  return !!v && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string";
}
function isSkill(v: unknown): v is SkillRow {
  return !!v && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string";
}
function isClientCard(data: unknown): data is ClientCard {
  return !!data && typeof data === "object" && typeof (data as Record<string, unknown>).name === "string";
}

function safeUrl(site: string | null): { href: string; label: string } | null {
  if (!site) return null;
  try {
    const u = new URL(site.startsWith("http") ? site : `https://${site}`);
    return { href: u.toString(), label: u.host + (u.pathname !== "/" ? u.pathname : "") };
  } catch {
    return null;
  }
}

export function ClientCardPanel({ data }: { data: unknown }) {
  if (!isClientCard(data)) {
    return <p className="font-hud text-xs text-cyan-100/60">Sem dados do cliente para mostrar.</p>;
  }
  const products = asArray(data.products, isProduct);
  const skills = asArray(data.skills, isSkill);
  const link = safeUrl(data.site);

  return (
    <div className="w-[min(88vw,420px)] space-y-4">
      <div className="flex items-center gap-3 border-b border-cyan-300/15 pb-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-cyan-300/40 font-hud text-lg text-cyan-50 shadow-[0_0_18px_rgba(103,232,249,0.3)]">
          {data.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0">
          <div className="truncate font-hud text-base text-cyan-50">{data.name}</div>
          {link ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-hud text-[0.7rem] text-cyan-200/70 underline-offset-2 hover:underline"
            >
              {link.label}
            </a>
          ) : (
            <span className="block truncate font-hud text-[0.65rem] uppercase tracking-[0.14em] text-cyan-100/40">
              {data.slug}
            </span>
          )}
        </div>
      </div>

      <Section label={`Produtos (${products.length})`}>
        {products.length === 0 ? (
          <Empty>Nenhum produto cadastrado.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {products.map((p) => (
              <li key={p.slug} className="flex items-center justify-between gap-3">
                <span className="truncate font-hud text-xs text-cyan-100/80">{p.name}</span>
                <StatusChip status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label={`Skills (${skills.length})`}>
        {skills.length === 0 ? (
          <Empty>Nenhuma skill cadastrada.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {skills.map((s) => (
              <li key={s.slug} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {s.ultron_enabled ? (
                    <span aria-label="Ultron pode acionar" title="Ultron pode acionar" className="text-cyan-300/80">
                      ◆
                    </span>
                  ) : null}
                  <span className="truncate font-hud text-xs text-cyan-100/80">{s.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`font-hud text-[0.55rem] uppercase tracking-[0.12em] ${
                      s.capability === "write" ? "text-amber-200/80" : "text-cyan-100/45"
                    }`}
                  >
                    {s.capability === "write" ? "escrita" : "leitura"}
                  </span>
                  <StatusChip status={s.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="font-hud text-[0.65rem] uppercase tracking-[0.18em] text-cyan-100/45">{label}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-hud text-xs text-cyan-100/45">{children}</p>;
}

function StatusChip({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={`hud-chip shrink-0 font-hud text-[0.55rem] uppercase tracking-[0.12em] ${
        active ? "text-emerald-200/80" : "text-cyan-100/40"
      }`}
    >
      {status}
    </span>
  );
}
