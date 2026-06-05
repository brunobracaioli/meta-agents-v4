import { describe, it, expect } from "vitest";
import { contentDocToFiles } from "@b2tech/lp-render/serialize";
import type { ContentDoc } from "@b2tech/lp-render/content-doc";

// Regression: the lp-copywriter (an LLM) generated imersao-agencia with drifted section keys
// (`headline` instead of `heading`, card `body` instead of `desc`, and `problem.bullets` as
// {title,body} objects). The object bullets crashed React (#31), 500ing the preview and failing
// the static publish build. The serializer now normalizes these drifts at the single boundary.

function baseSettings(): Record<string, unknown> {
  return {
    subdomain: "t",
    name: "T",
    product: "T",
    site_url: "https://t.b2tech.io",
    seo: { title: "t", description: "d" },
    tracking: {},
    checkout_url: "https://pay.example/x",
    price_cents: 100,
    cart_state: "open",
    noindex: true,
    cartClosed: { headline: "", subhead: "", ctaLabel: "", ctaUrl: "" },
  };
}

describe("serializer normalizes copy-key drift (never crashes on LLM variance)", () => {
  it("maps headline→heading, body→desc, and coerces object bullets to strings", () => {
    const doc = {
      settings: baseSettings(),
      theme: {},
      sections: [
        {
          type: "problem",
          position: 0,
          enabled: true,
          fields: {
            headline: "O problema",
            subhead: "O lead",
            bullets: [{ title: "Babá", body: "preso no painel" }, "bullet simples"],
          },
        },
        { type: "features", position: 1, enabled: true, fields: { headline: "Recursos", items: [{ title: "i", body: "corpo" }] } },
        { type: "curriculum", position: 2, enabled: true, fields: { headline: "Grade", modules: [{ title: "m", body: "modcorpo" }] } },
      ],
    } as unknown as ContentDoc;

    const { messages } = contentDocToFiles(doc);
    const p = messages.sections.problem!;
    expect(p.heading).toBe("O problema");
    expect(p.body).toBe("O lead");
    expect(p.bullets).toEqual(["Babá — preso no painel", "bullet simples"]);
    expect(messages.sections.features!.items[0]!.desc).toBe("corpo");
    expect(messages.sections.curriculum!.modules[0]!.desc).toBe("modcorpo");
  });

  it("leaves canonical fields untouched (backward compatible with correct pages)", () => {
    const doc = {
      settings: baseSettings(),
      theme: {},
      sections: [
        {
          type: "problem",
          position: 0,
          enabled: true,
          fields: { heading: "H", body: "B", bullets: ["um", "dois"] },
        },
        { type: "features", position: 1, enabled: true, fields: { heading: "F", items: [{ title: "i", desc: "d" }] } },
      ],
    } as unknown as ContentDoc;

    const { messages } = contentDocToFiles(doc);
    expect(messages.sections.problem!.heading).toBe("H");
    expect(messages.sections.problem!.body).toBe("B");
    expect(messages.sections.problem!.bullets).toEqual(["um", "dois"]);
    expect(messages.sections.features!.items[0]!.desc).toBe("d");
  });
});
