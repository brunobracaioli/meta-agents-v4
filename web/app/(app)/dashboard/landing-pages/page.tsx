import Link from "next/link";
import { getAllLandingPages } from "@/lib/services/landing-page";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Draft (Supabase) state badge — mirrors the per-product list so the two views read the same.
const DRAFT_STYLES: Record<string, string> = {
  generating: "bg-amber-400/15 text-amber-200 border-amber-300/25",
  ready: "bg-emerald-400/12 text-emerald-200 border-emerald-300/25",
  editing: "bg-cyan-400/12 text-cyan-100 border-cyan-300/25",
  publishing: "bg-violet-400/15 text-violet-200 border-violet-300/25",
  empty: "bg-white/8 text-white/50 border-white/15",
};

export default async function LandingPagesIndexPage() {
  const pages = await getAllLandingPages();
  const liveCount = pages.filter((p) => p.status === "deployed" && !p.noindex).length;
  const previewCount = pages.filter((p) => p.status === "deployed" && p.noindex).length;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-white">Landing pages</h1>
        <p className="mt-1 text-sm text-white/40">
          {pages.length} no total · {liveCount} no ar (indexável) · {previewCount} em preview
        </p>
      </div>

      {pages.length === 0 ? (
        <p className="text-sm text-white/50">
          Nenhuma landing page ainda. O Ultron cria uma nova pedindo cliente + produto.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pages.map((lp) => {
            const editHref =
              lp.clientSlug && lp.productSlug
                ? `/dashboard/clients/${lp.clientSlug}/${lp.productSlug}/landing-page/${lp.id}`
                : null;
            return (
              <li key={lp.id} className="tech-panel rounded-xl border border-white/8 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white/90">{lp.name}</span>
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                      DRAFT_STYLES[lp.draft_status] ?? DRAFT_STYLES.empty
                    }`}
                  >
                    {lp.draft_status}
                  </span>
                </div>

                <p className="mt-1 font-mono text-xs text-cyan-200/60">{lp.subdomain}.b2tech.io</p>

                <p className="mt-2 text-[11px] text-white/40">
                  <span className="text-white/55">{lp.clientName}</span>
                  {lp.productName ? (
                    <> · {lp.productName}</>
                  ) : (
                    <>
                      {" · "}
                      <span className="text-white/30">sem produto</span>
                    </>
                  )}
                  {" · "}deploy: {lp.status}
                  {lp.published_at ? ` · publicado ${formatDateTime(lp.published_at)}` : ""}
                </p>

                <div className="mt-3 flex items-center gap-3 text-xs">
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                      lp.noindex
                        ? "border-amber-300/25 bg-amber-400/10 text-amber-200/80"
                        : "border-emerald-300/25 bg-emerald-400/10 text-emerald-200/80"
                    }`}
                  >
                    {lp.noindex ? "preview" : "no ar"}
                  </span>
                  {editHref ? (
                    <Link href={editHref} className="text-cyan-200/80 transition hover:text-cyan-100">
                      Editar →
                    </Link>
                  ) : (
                    <span
                      className="text-white/25"
                      title="LP sem produto associado — edite pelo Ultron ou associe um produto"
                    >
                      sem editor
                    </span>
                  )}
                  {lp.status === "deployed" ? (
                    <a
                      href={lp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/45 transition hover:text-white"
                    >
                      Ver no ar ↗
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
