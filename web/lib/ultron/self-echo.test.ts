import { describe, expect, it } from "vitest";
import { isSelfEcho, mentionsWakeName, normalizeSpeech, pushSpoken, type SpokenEntry } from "./self-echo";

const at = (ms: number) => ms;

function spoken(sentences: Array<[string, number]>): SpokenEntry[] {
  return sentences.map(([text, ms]) => ({ text, at: ms }));
}

describe("normalizeSpeech", () => {
  it("lowercases, strips pt-BR diacritics and punctuation", () => {
    expect(normalizeSpeech("Não, a CAMPANHA está no ar!")).toEqual([
      "nao",
      "a",
      "campanha",
      "esta",
      "no",
      "ar",
    ]);
  });

  it("keeps digits and collapses whitespace", () => {
    expect(normalizeSpeech("  R$ 1.500,00   por dia ")).toEqual(["r", "1", "500", "00", "por", "dia"]);
  });

  it("returns empty for punctuation-only input", () => {
    expect(normalizeSpeech("... !?")).toEqual([]);
  });
});

describe("pushSpoken", () => {
  it("appends and prunes entries older than the window", () => {
    let entries: SpokenEntry[] = [];
    entries = pushSpoken(entries, "primeira frase", at(0));
    entries = pushSpoken(entries, "segunda frase", at(11_000));
    // First entry (0ms) is outside the 12s window relative to 13s.
    entries = pushSpoken(entries, "terceira frase", at(13_000));
    expect(entries.map((e) => e.text)).toEqual(["segunda frase", "terceira frase"]);
  });

  it("caps the buffer at maxEntries (keeps the newest)", () => {
    let entries: SpokenEntry[] = [];
    for (let i = 0; i < 5; i++) entries = pushSpoken(entries, `frase ${i}`, at(i), { maxEntries: 3 });
    expect(entries.map((e) => e.text)).toEqual(["frase 2", "frase 3", "frase 4"]);
  });

  it("ignores blank sentences", () => {
    expect(pushSpoken([], "   ", at(0))).toEqual([]);
  });
});

describe("isSelfEcho", () => {
  const ultronSaid = spoken([
    ["A campanha de tráfego do Bruno está ativa com cinquenta reais por dia.", 1_000],
    ["Quer que eu abra o painel de análises?", 2_000],
  ]);

  it("drops an STT fragment of what Ultron just said", () => {
    expect(isSelfEcho("campanha de tráfego do Bruno está ativa", ultronSaid, at(3_000))).toBe(true);
  });

  it("drops a garbled echo missing a word or two", () => {
    // 6 of 7 tokens (~0.86) come from the spoken text.
    expect(isSelfEcho("campanha tráfego do Bruno ativa com reais", ultronSaid, at(3_000))).toBe(true);
  });

  it("keeps genuinely new speech that shares common words", () => {
    expect(isSelfEcho("cria outra campanha com cem reais para o cliente novo", ultronSaid, at(3_000))).toBe(
      false,
    );
  });

  it("keeps an operator reply that references the question", () => {
    expect(isSelfEcho("não, cancela tudo e pausa os anúncios", ultronSaid, at(3_000))).toBe(false);
  });

  it("never eats a short confirmation unless it is an exact fragment", () => {
    expect(isSelfEcho("sim", ultronSaid, at(3_000))).toBe(false);
    expect(isSelfEcho("tá bom", ultronSaid, at(3_000))).toBe(false);
    // Exact short fragment of the spoken sentence IS an echo.
    expect(isSelfEcho("por dia", ultronSaid, at(3_000))).toBe(true);
  });

  it("ignores entries outside the window", () => {
    expect(isSelfEcho("campanha de tráfego do Bruno está ativa", ultronSaid, at(60_000))).toBe(false);
  });

  it("is false with an empty buffer or empty transcript", () => {
    expect(isSelfEcho("qualquer coisa", [], at(0))).toBe(false);
    expect(isSelfEcho("!!!", ultronSaid, at(3_000))).toBe(false);
  });

  it("counts repeated tokens against the multiset, not the set", () => {
    const said = spoken([["ativa ativa", 0]]);
    // Transcript repeats "ativa" 4x but Ultron only said it twice → 2/4 found.
    expect(isSelfEcho("ativa ativa ativa ativa", said, at(500))).toBe(false);
  });
});

describe("mentionsWakeName", () => {
  it("matches the name regardless of case, accents and punctuation", () => {
    expect(mentionsWakeName("Ultron, que horas são?", "ultron")).toBe(true);
    expect(mentionsWakeName("fala ULTRON!", "ultron")).toBe(true);
  });

  it("requires an exact token — no fuzzy prefix matches", () => {
    expect(mentionsWakeName("o ultrom chegou", "ultron")).toBe(false);
    expect(mentionsWakeName("ultrapassou a meta", "ultron")).toBe(false);
  });

  it("matches multi-token names as a consecutive sequence", () => {
    expect(mentionsWakeName("T-800, cria a campanha", "t 800")).toBe(true);
    expect(mentionsWakeName("gastei 800 reais", "t 800")).toBe(false);
  });

  it("accepts a list of names", () => {
    expect(mentionsWakeName("e aí oitocentos, tudo bem?", ["ultron", "oitocentos"])).toBe(true);
    expect(mentionsWakeName("bom dia pessoal", ["ultron", "oitocentos"])).toBe(false);
  });
});
