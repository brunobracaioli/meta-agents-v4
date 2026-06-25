import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductWithLandingPages } from "@/lib/services/landing-page";
import { listSkillsForProduct } from "@/lib/services/skills-admin";
import { SkillsManager } from "@/components/skills/skills-manager";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const DRAFT_STYLES: Record<string, string> = {
  generating: "bg-amber-400/15 text-amber-200 border-amber-300/25",
  ready: "bg-emerald-400/12 text-emerald-200 border-emerald-300/25",
  editing: "bg-cyan-400/12 text-cyan-100 border-cyan-300/25",
  publishing: "bg-violet-400/15 text-violet-200 border-violet-300/25",
  empty: "bg-white/8 text-white/50 border-white/15",
};

export default async function ProductLandingPagesPage({
  params,
}: {
  params: Promise<{ slug: string; product: string }>;
}) {
  const { slug, product } = await params;
  const data = await getProductWithLandingPages(slug, product);
  if (!data) notFound();
  const { product: prod, landingPages } = data;
  const skills = await listSkillsForProduct(prod.id);

  return (
    <div className="space-y-7">
      <div>
        <Link
          href={`/dashboard/clients/${slug}`}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/40 hover:text-white"
        >
          ← {slug}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">{prod.name}</h1>
        <p className="mt-1 text-sm text-white/40">
          Produto <span className="font-mono text-white/55">{prod.slug}</span> · {landingPages.length} landing page
          {landingPages.length === 1 ? "" : "s"}
        </p>
      </div>

      {landingPages.length === 0 ? (
        <p className="text-sm text-white/50">
          Nenhuma landing page ainda. O Ultron cria uma nova pedindo cliente + produto.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {landingPages.map((lp) => (
            <li key={lp.id}>
              <Link
                href={`/dashboard/clients/${slug}/${product}/landing-page/${lp.id}`}
                className="tech-panel block rounded-xl border border-white/8 p-4 transition hover:border-cyan-200/25"
              >
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
                <p className="mt-2 text-[11px] text-white/35">
                  deploy: {lp.status}
                  {lp.published_at ? ` · publicado ${formatDateTime(lp.published_at)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Skills attached to this product (SPEC-018.1) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Skills</h2>
            <p className="mt-1 text-sm text-white/40">
              {skills.length} skill{skills.length === 1 ? "" : "s"} · automações que seus agentes executam para este produto
            </p>
          </div>
          <Link
            href={`/dashboard/clients/${slug}/${product}/skills/new`}
            className="rounded-lg border border-orange-300/35 bg-orange-400/10 px-4 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-400/20"
          >
            + Nova skill
          </Link>
        </div>
        <SkillsManager initialSkills={skills} clientSlug={slug} productSlug={product} />
      </section>
    </div>
  );
}
