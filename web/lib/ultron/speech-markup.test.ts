import { describe, expect, it } from "vitest";
import { stripSpeechMarkup } from "./speech-markup";

describe("stripSpeechMarkup", () => {
  it("removes bold markers but keeps the words", () => {
    expect(stripSpeechMarkup("Posso fazer **bastante coisa** aqui")).toBe(
      "Posso fazer bastante coisa aqui",
    );
  });

  it("handles the multi-bold spoken-answer case from the field", () => {
    const input =
      "eu consigo **ver e explicar** dados e **criar campanhas** de tráfego";
    expect(stripSpeechMarkup(input)).toBe(
      "eu consigo ver e explicar dados e criar campanhas de tráfego",
    );
  });

  it("strips italics and inline code", () => {
    expect(stripSpeechMarkup("o _CPLPV_ e o `CTR` do cliente")).toBe(
      "o CPLPV e o CTR do cliente",
    );
  });

  it("strips strikethrough", () => {
    expect(stripSpeechMarkup("antes ~~cem reais~~ agora cinquenta")).toBe(
      "antes cem reais agora cinquenta",
    );
  });

  it("removes list bullets and numbers at line start", () => {
    expect(stripSpeechMarkup("- um\n- dois\n1. três")).toBe("um\ndois\ntrês");
  });

  it("removes heading hashes and blockquotes", () => {
    expect(stripSpeechMarkup("# Resumo\n> nota")).toBe("Resumo\nnota");
  });

  it("unwraps markdown links to their label", () => {
    expect(stripSpeechMarkup("veja a [landing page](https://x.io) no ar")).toBe(
      "veja a landing page no ar",
    );
  });

  it("removes stray unpaired emphasis chars", () => {
    expect(stripSpeechMarkup("ficou **redonda no geral")).toBe(
      "ficou redonda no geral",
    );
  });

  it("leaves clean spoken text untouched", () => {
    const clean = "Cinquenta reais por dia, CTR de um vírgula dois por cento.";
    expect(stripSpeechMarkup(clean)).toBe(clean);
  });

  it("does not split decimals or currency", () => {
    expect(stripSpeechMarkup("O preço é R$ 1.500,00 hoje.")).toBe(
      "O preço é R$ 1.500,00 hoje.",
    );
  });
});
