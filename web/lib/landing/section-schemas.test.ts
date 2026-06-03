import { describe, it, expect } from "vitest";
import { validateSection, SECTION_SCHEMAS } from "./section-schemas";

// Real section `fields` captured from the live cca-e2e draft (LP 1f4e2b68…) — the per-type
// whitelist must accept actual generated copy, not just hand-rolled samples.
const REAL: Record<string, unknown> = {
  hero: {
    badge: "Método · Agentes · Produção",
    subhead: "Do prompt à arquitetura: o método para devs.",
    ctaLabel: "Quero aprender agora",
    headline: "Construa software de verdade com Claude Code.",
  },
  comparison: {
    ours: "Claude Code Architect",
    theirs: "Cursos genéricos",
    heading: "O que diferencia método de truque de prompt.",
    subhead: "Compare o que você aprende aqui.",
    rows: [
      { ours: true, label: "Método repetível", theirs: false },
      { ours: true, label: "Exemplos que rodam", theirs: "Só demos" }, // mixed CompareCell
    ],
  },
  offer: {
    anchor: "De R$ 1.997",
    secure: "🔒 Pagamento 100% seguro",
    bonuses: ["Acesso à comunidade", "Templates prontos"],
    heading: "Acesso completo.",
    ctaLabel: "Quero aprender agora",
    payments: ["Pix", "Cartão", "Boleto"],
    guarantee: "7 dias de garantia",
    priceLabel: "R$ 1.497",
    installments: "ou 12x de R$ 142,08",
  },
  faq: {
    items: [
      { a: "Não. O treinamento começa pelo método.", q: "Preciso ter experiência prévia?" },
      { a: "Sim, agnóstico de stack.", q: "É agnóstico de linguagem?" },
    ],
  },
  footer: {
    legal: "© 2024 Bruno Bracaioli · Todos os direitos reservados.",
    links: [
      { href: "#", label: "Termos de Uso" },
      { href: "#", label: "Suporte" },
    ],
  },
  authority: {
    bio: "Engenheiro de software com mais de uma década.",
    name: "Bruno Bracaioli",
    eyebrow: "Seu instrutor",
    credentials: ["10+ anos em produção", "+2.000 devs treinados"],
  },
};

describe("validateSection — real generated data round-trips", () => {
  for (const [type, fields] of Object.entries(REAL)) {
    it(`accepts the live cca-e2e '${type}' fields`, () => {
      expect(validateSection(type, fields)).toEqual({ ok: true });
    });
  }

  it("has a schema for every one of the 17 section types", () => {
    expect(Object.keys(SECTION_SCHEMAS)).toHaveLength(17);
  });
});

describe("validateSection — whitelist", () => {
  it("rejects an unknown key (strict whitelist)", () => {
    const r = validateSection("hero", { headline: "ok", evil: "<script>" });
    expect(r.ok).toBe(false);
  });

  it("rejects a wrong-typed known field", () => {
    expect(validateSection("hero", { headline: { nested: "x" } }).ok).toBe(false);
    expect(validateSection("finalCta", { ctaLabel: 123 }).ok).toBe(false);
  });

  it("rejects an unknown section type", () => {
    expect(validateSection("nope", { headline: "x" }).ok).toBe(false);
  });

  it("accepts an empty/partial object (fields are optional, not required)", () => {
    expect(validateSection("hero", {}).ok).toBe(true);
    expect(validateSection("offer", { ctaLabel: "Comprar" }).ok).toBe(true);
  });
});

describe("validateSection — href sanitization", () => {
  it("rejects a javascript: footer link but accepts http(s)/#/relative", () => {
    expect(validateSection("footer", { links: [{ label: "x", href: "javascript:alert(1)" }] }).ok).toBe(false);
    expect(validateSection("footer", { links: [{ label: "x", href: "https://b2tech.io" }] }).ok).toBe(true);
    expect(validateSection("footer", { links: [{ label: "x", href: "#" }] }).ok).toBe(true);
    expect(validateSection("footer", { links: [{ label: "x", href: "/termos" }] }).ok).toBe(true);
  });
});

describe("validateSection — CompareCell union", () => {
  it("accepts boolean and string cells, rejects an object cell", () => {
    expect(validateSection("comparison", { rows: [{ label: "a", ours: true, theirs: "x" }] }).ok).toBe(true);
    expect(validateSection("comparison", { rows: [{ label: "a", ours: { bad: 1 } }] }).ok).toBe(false);
  });
});
