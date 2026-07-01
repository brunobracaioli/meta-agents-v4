/**
 * Deterministic, zero-latency text heuristics for the Ultron voice loop.
 *
 * THE PROBLEM: the chat loop (chat.ts) runs Claude without `tool_choice`, so the model is
 * free to answer in prose and NARRATE an action as done ("pronto, abri a segunda tela")
 * without ever calling the tool that performs it. Because the client speaks each sentence
 * the instant it streams (use-ultron-voice.ts) and the terminal `done` signals arrive
 * only afterwards, that false claim is irreversibly voiced — there is no way to "un-speak"
 * it. So the fix must be PREVENTIVE: force a tool call when the turn is a command. With a
 * forced tool the model emits only the tool_use block (no text), so nothing is spoken
 * before the tool actually runs.
 *
 * `classifyUtterance` decides "is this turn a command?" over the KNOWN command vocabulary
 * the system prompt already teaches (prompt.ts §INTERFACE HOLOGRÁFICA and §AÇÕES). It is a
 * pure, stem-based matcher — no I/O, no LLM. Tuned to prefer recall: a false positive is
 * low-harm (it only forces a read-only/preview tool call, all writes still gate on the
 * two-step confirm=false→confirm=true flow), while a false negative is caught by the
 * `phantom_claim` telemetry in chat.ts and folded back into these patterns.
 *
 * `assertsCompletedAction` / `stripCompletedClaims` are the mirror heuristic over Ultron's
 * OWN output, used by the non-streaming reconciliation gate (capture/resume path) where
 * nothing has been voiced yet and a phantom claim can still be scrubbed before returning.
 */

export type Intent = "command" | "chat";

// Strip accents + lowercase so "análise"/"analise" and STT variants both match.
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Verbs that ask Ultron to DO something (display, write, autonomous). Stems + trailing
// \w* match every conjugation (abre/abrir/abra, cria/criar/criei/criando...).
const COMMAND_VERB = new RegExp(
  "\\b(" +
    [
      "abr", "mostr", "exib", "materializ", "foc", "destac", "fech", "tir", "remov",
      "limp", "escond", "jog", "cri", "ativ", "public", "edit", "mud", "alter", "troc",
      "analis", "rod", "monitor", "confirm", "cancel", "inici", "lig", "deslig", "apresent",
    ].join("|") +
    ")\\w*",
);

// Domain nouns / metrics that signal a data-lookup or display request even without a verb
// ("como está o funil?", "quanto gastou ontem?").
const COMMAND_NOUN = new RegExp(
  "\\b(" +
    [
      "funil", "funnel", "campanh", "criativ", "landing", "pagin", "analise", "diagnostic",
      "resumo", "client", "card", "past", "metric", "desempenh", "performance", "cplpv",
      "cpl", "cpa", "ctr", "cpc", "cpm", "roas", "gast", "verba", "orcament",
    ].join("|") +
    ")\\w*",
);

// Multi-word triggers the stems above don't capture cleanly.
const COMMAND_PHRASE = /(segunda tela|segunda janela|outro monitor|modo autonomo|top criativ)/;

export function classifyUtterance(text: string): Intent {
  if (!text) return "chat";
  const t = normalize(text);
  if (COMMAND_PHRASE.test(t) || COMMAND_VERB.test(t) || COMMAND_NOUN.test(t)) return "command";
  return "chat";
}

// First-person preterite claims ("abri", "criei") + done-state participles ("aberta",
// "publicado"). Word-boundary exact forms so future/subjunctive ("abrir", "abra") and
// questions ("quer que eu abra?") are NOT flagged.
const COMPLETED_CLAIM = new RegExp(
  "\\b(" +
    [
      "abri", "mostrei", "exibi", "materializei", "fechei", "tirei", "removi", "limpei",
      "foquei", "destaquei", "joguei", "criei", "ativei", "publiquei", "editei", "troquei",
      "mudei", "alterei", "enfileirei", "disparei", "coloquei", "apresentei", "cancelei",
      "iniciei", "liguei", "desliguei",
      "aberta", "aberto", "fechada", "fechado", "criada", "criado", "ativada", "ativado",
      "publicada", "publicado", "removida", "removido",
    ].join("|") +
    ")\\b",
);

/** True when Ultron's reply asserts it already performed an action/screen change. */
export function assertsCompletedAction(text: string): boolean {
  return COMPLETED_CLAIM.test(normalize(text));
}

/**
 * Drop sentences that assert a completed action, keeping the rest. Used only on the
 * non-streaming path (nothing voiced yet). Returns null when nothing usable remains, so
 * the caller can fall back to a safe line.
 */
export function stripCompletedClaims(text: string): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const kept = sentences.filter((s) => !assertsCompletedAction(s));
  const out = kept.join(" ").trim();
  return out.length > 0 ? out : null;
}
