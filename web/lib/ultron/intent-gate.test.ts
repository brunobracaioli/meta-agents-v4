import { describe, it, expect } from "vitest";
import { classifyUtterance, assertsCompletedAction, stripCompletedClaims } from "@/lib/ultron/intent-gate";

describe("classifyUtterance — command vs chat", () => {
  it.each([
    "abre a segunda tela",
    "abra numa segunda janela",
    "joga pra segunda tela",
    "manda pro outro monitor",
    "mostra o funil do bruno",
    "me mostra o funil do brunobracaioli",
    "como estão as campanhas do bruno",
    "quanto o bruno gastou ontem",
    "qual o ctr da campanha",
    "mostra o resumo do dia",
    "abre as pastas",
    "abre o card do bruno",
    "foca no funil",
    "fecha o funil",
    "tira isso",
    "limpa tudo",
    "cria uma campanha de tráfego pro bruno",
    "criar uma campanha de vendas com os top criativos",
    "ativa a campanha",
    "pode ativar",
    "confirma",
    "sim, pode criar",
    "publica a landing",
    "edita o headline da hero",
    "muda a cor pra laranja",
    "roda uma análise agora",
    "mostra a última análise do bruno",
    "inicia o modo autônomo e monitora",
  ])("classifies %j as command", (text) => {
    expect(classifyUtterance(text)).toBe("command");
  });

  it.each([
    "oi",
    "oi, tudo bem?",
    "e aí",
    "obrigado",
    "valeu",
    "o que você faz?",
    "quem é você?",
    "bom dia",
    "beleza, entendi",
  ])("classifies %j as chat", (text) => {
    expect(classifyUtterance(text)).toBe("chat");
  });

  it("treats empty input as chat", () => {
    expect(classifyUtterance("")).toBe("chat");
  });
});

describe("assertsCompletedAction — detects phantom done-claims", () => {
  it.each([
    "Pronto, abri a segunda tela.",
    "Já mostrei o funil pra você.",
    "Criei a campanha e enfileirei o pedido.",
    "Fechei o painel.",
    "A landing já está publicada.",
    "A segunda tela está aberta.",
  ])("flags %j", (text) => {
    expect(assertsCompletedAction(text)).toBe(true);
  });

  it.each([
    "Vou abrir a segunda tela pra você.",
    "Quer que eu abra o funil?",
    "Posso criar a campanha, confirma?",
    "Já abro pra você.",
    "Deixa eu buscar isso.",
  ])("does not flag future/intention %j", (text) => {
    expect(assertsCompletedAction(text)).toBe(false);
  });
});

describe("stripCompletedClaims — scrub phantom claims, keep the rest", () => {
  it("drops the sentence that claims a completed action", () => {
    const out = stripCompletedClaims("Pronto, abri a segunda tela. Quer que eu mostre o funil?");
    expect(out).toBe("Quer que eu mostre o funil?");
  });

  it("returns null when everything is a claim", () => {
    expect(stripCompletedClaims("Abri a segunda tela. Fechei o funil.")).toBeNull();
  });

  it("keeps text with no claims untouched", () => {
    expect(stripCompletedClaims("Deixa eu buscar isso pra você.")).toBe("Deixa eu buscar isso pra você.");
  });
});
