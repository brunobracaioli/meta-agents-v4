import { describe, expect, it } from "vitest";
import { SentenceAccumulator } from "./sentence-stream";

describe("SentenceAccumulator", () => {
  it("emits a sentence once its terminator + trailing space arrive", () => {
    const acc = new SentenceAccumulator();
    expect(acc.push("Olá")).toEqual([]);
    expect(acc.push(", tudo bem")).toEqual([]);
    expect(acc.push("?")).toEqual([]); // terminator seen, but no trailing space yet
    expect(acc.push(" E aí")).toEqual(["Olá, tudo bem?"]);
    expect(acc.flush()).toBe("E aí");
  });

  it("does not split decimals or currency (no space after the dot)", () => {
    const acc = new SentenceAccumulator();
    expect(acc.push("O preço é R$ 1.500")).toEqual([]);
    expect(acc.push(",00 hoje. ")).toEqual(["O preço é R$ 1.500,00 hoje."]);
  });

  it("treats newlines as boundaries (list items)", () => {
    const acc = new SentenceAccumulator();
    expect(acc.push("um\ndois\ntrês")).toEqual(["um", "dois"]);
    expect(acc.flush()).toBe("três");
  });

  it("splits multiple sentences in a single delta", () => {
    const acc = new SentenceAccumulator();
    expect(acc.push("Pronto! Criei a campanha. Tudo certo? ")).toEqual([
      "Pronto!",
      "Criei a campanha.",
      "Tudo certo?",
    ]);
  });

  it("flushes at the soft cap when there is no punctuation", () => {
    const acc = new SentenceAccumulator();
    const long = "palavra ".repeat(40); // ~320 chars, no terminator
    const out = acc.push(long);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.length).toBeLessThanOrEqual(180);
  });

  it("flush returns null when empty", () => {
    const acc = new SentenceAccumulator();
    acc.push("Oi. ");
    expect(acc.flush()).toBeNull();
  });
});
