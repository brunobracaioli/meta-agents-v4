import { describe, it, expect } from "vitest";
import { contentDocToFiles } from "../serialize";
import type { ContentDoc, SectionDoc } from "../content-doc";

// A ContentDoc equivalent to the seed `cca` landing page. The serializer must turn it
// back into the messages/pt.json + content-spec.json shapes the static build consumes.
// (We assert the transform, not byte-identity with the divergent seed files — the build
// regression guard in Wave 1 covers byte fidelity.)

const SECTION_ORDER: SectionDoc["type"][] = [
  "hero",
  "urgency",
  "problem",
  "comparison",
  "solution",
  "features",
  "curriculum",
  "stats",
  "proof",
  "logos",
  "persona",
  "authority",
  "offer",
  "guarantee",
  "faq",
  "finalCta",
  "footer",
];

function section(type: SectionDoc["type"], position: number, fields: Record<string, unknown>): SectionDoc {
  return { type, position, enabled: true, fields };
}

function ccaDoc(): ContentDoc {
  return {
    settings: {
      subdomain: "cca",
      name: "CCA",
      product: "Claude Code Architect",
      site_url: "https://cca.b2tech.io",
      seo: {
        title: "Claude Code Architect — engenharia com IA na prática",
        description:
          "O curso para devs que querem construir software de verdade com Claude Code: arquitetura, agentes e automação.",
        ogAlt: "Claude Code Architect",
      },
      tracking: { fb_pixel_id: "653995666521954", ga4_id: "G-Z60CJ7W2Z8", consent_key: "b2tech_consent_v1" },
      checkout_url: "https://pay.hub.la/KiIZ2UcpwcbOps224hbI",
      waitlist_url: "https://wa.me/5500000000000?text=Quero",
      price_cents: 149700,
      cart_state: "open",
      noindex: true,
      deadline: "2026-12-31T23:59:59-03:00",
      cartClosed: {
        headline: "As inscrições estão fechadas no momento",
        subhead: "Entre na lista de espera e seja avisado na próxima turma.",
        waitlistCtaLabel: "Entrar na lista",
      },
    },
    theme: {
      fonts: { title: "Sora", body: "DM Sans" },
      scale: 1.05,
      colors: { orange: "#FF6B1A", navy900: "#0A0F1A" },
    },
    sections: [
      section("hero", 1, { badge: "🔥 Vagas limitadas", headline: "Construa software de verdade", subhead: "Do prompt à arquitetura.", ctaLabel: "Quero participar" }),
      section("urgency", 2, { label: "Inscrições encerram em", scarcity: "Últimas vagas" }),
      section("problem", 3, { heading: "IA virou ruído", body: "Você testou copiloto...", bullets: ["a", "b"] }),
      section("comparison", 4, { heading: "Tutorial não leva a produção", ours: "CCA", theirs: "Genéricos", rows: [{ label: "Método", ours: true, theirs: false }] }),
      section("solution", 5, { heading: "Um método", body: "Trata IA como sistema." }),
      section("features", 6, { heading: "O que você domina", items: [{ icon: "🧱", title: "Arquitetura", desc: "spec antes de codar" }] }),
      section("curriculum", 7, { heading: "A jornada", modules: [{ title: "Fundamentos", desc: "como pensa" }] }),
      section("stats", 8, { items: [{ value: "+2.000", label: "devs" }] }),
      section("proof", 9, { heading: "Quem constrói", testimonials: [{ quote: "Mudou meu fluxo.", author: "Dev" }] }),
      section("logos", 10, { heading: "Times como", items: ["Nubank", "iFood"] }),
      section("persona", 11, { heading: "Pra quem é", items: [{ icon: "👩‍💻", title: "Dev", desc: "escalar" }] }),
      section("authority", 12, { eyebrow: "Instrutor", name: "Bruno Bracaioli", bio: "Engenheiro.", credentials: ["10+ anos"] }),
      section("offer", 13, { heading: "Entre para o CCA", priceLabel: "R$ 1.497", anchor: "De R$ 1.997", bonuses: ["Comunidade"], ctaLabel: "Garantir vaga" }),
      section("guarantee", 14, { heading: "Garantia 7 dias", body: "Devolvemos.", seal: "🛡️" }),
      section("faq", 15, { items: [{ q: "Preciso saber IA?", a: "Não." }, { q: "Tem garantia?", a: "Sim, 7 dias." }] }),
      section("finalCta", 16, { headline: "Pronto?", ctaLabel: "Quero entrar agora" }),
      section("footer", 17, { legal: "© B2 Tech.", links: [{ label: "Termos", href: "#" }] }),
    ],
  };
}

describe("contentDocToFiles", () => {
  it("orders content-spec.sections by position, enabled only", () => {
    const { contentSpec } = contentDocToFiles(ccaDoc());
    expect(contentSpec.sections).toEqual(SECTION_ORDER);
  });

  it("excludes disabled sections from the render order", () => {
    const doc = ccaDoc();
    doc.sections.find((s) => s.type === "logos")!.enabled = false;
    const { contentSpec } = contentDocToFiles(doc);
    expect(contentSpec.sections).not.toContain("logos");
    expect(contentSpec.sections).toHaveLength(SECTION_ORDER.length - 1);
  });

  it("respects position for ordering, not array index", () => {
    const doc = ccaDoc();
    // Move footer to the top by position; it should lead the render order.
    doc.sections.find((s) => s.type === "footer")!.position = 0;
    const { contentSpec } = contentDocToFiles(doc);
    expect(contentSpec.sections[0]).toBe("footer");
  });

  it("hoists hero/offer/finalCta/footer to top level and nests middle sections", () => {
    const { messages } = contentDocToFiles(ccaDoc());
    expect(messages.hero.headline).toBe("Construa software de verdade");
    expect(messages.offer.priceLabel).toBe("R$ 1.497");
    expect(messages.finalCta.ctaLabel).toBe("Quero entrar agora");
    expect(messages.footer.legal).toBe("© B2 Tech.");
    // middle sections live under messages.sections.*
    expect(messages.sections.problem?.heading).toBe("IA virou ruído");
    expect(messages.sections.authority?.name).toBe("Bruno Bracaioli");
    // hero/offer are NOT duplicated under sections
    expect((messages.sections as Record<string, unknown>).hero).toBeUndefined();
    expect((messages.sections as Record<string, unknown>).offer).toBeUndefined();
  });

  it("reconstructs faq as a flat array from the faq block's items", () => {
    const { messages } = contentDocToFiles(ccaDoc());
    expect(Array.isArray(messages.faq)).toBe(true);
    expect(messages.faq).toEqual([
      { q: "Preciso saber IA?", a: "Não." },
      { q: "Tem garantia?", a: "Sim, 7 dias." },
    ]);
  });

  it("carries seo to messages (with ogAlt) and content-spec (title+description only)", () => {
    const { messages, contentSpec } = contentDocToFiles(ccaDoc());
    expect(messages.seo.ogAlt).toBe("Claude Code Architect");
    expect(contentSpec.seo).toEqual({
      title: "Claude Code Architect — engenharia com IA na prática",
      description:
        "O curso para devs que querem construir software de verdade com Claude Code: arquitetura, agentes e automação.",
    });
    expect((contentSpec.seo as Record<string, unknown>).ogAlt).toBeUndefined();
  });

  it("emits theme.css with mapped color/font vars and a scale rule", () => {
    const { themeCss } = contentDocToFiles(ccaDoc());
    expect(themeCss).toContain("--orange: #FF6B1A;");
    expect(themeCss).toContain("--navy-900: #0A0F1A;");
    expect(themeCss).toContain('--font-title: "Sora", ui-sans-serif');
    expect(themeCss).toContain("font-size: 105.00%;");
  });

  it("emits empty theme.css when there are no overrides", () => {
    const doc = ccaDoc();
    doc.theme = {};
    const { themeCss } = contentDocToFiles(doc);
    expect(themeCss).toBe("");
  });

  it("omits optional settings (waitlist_url/deadline) when absent", () => {
    const doc = ccaDoc();
    delete doc.settings.waitlist_url;
    delete doc.settings.deadline;
    const { contentSpec } = contentDocToFiles(doc);
    expect("waitlist_url" in contentSpec).toBe(false);
    expect("deadline" in contentSpec).toBe(false);
  });
});
