# 0033 — Forçar `tool_choice` em turnos de comando do Ultron (fim da "alegação-fantasma")

- **Status:** accepted
- **Data:** 2026-06-30
- **Decisores:** Bruno Bracaioli (operador), Claude Code
- **Relacionados:** SPEC-016 (voice chat), ADR 0031 (ARC holographic render bus),
  memória `ultron-phantom-claim-tool-choice-gate`, `ultron-voice-latency-optimization`,
  `spec019-arc-holographic-ui`

## Context

O Ultron (assistente de voz, `web/`) às vezes **narrava uma ação como concluída** —
"Pronto, abri a segunda tela", "criei a campanha" — **sem chamar a tool** que executa.
Trace real: o texto afirmava sucesso, mas `usedTools:[]` e `uiIntents:[]` — a tela nunca
mudou / nada foi enfileirado. O operador ouvia uma confirmação falsa.

Causa raiz (confirmada por exploração do código):

1. **O loop de chat rodava Claude sem `tool_choice`** (`web/lib/ultron/chat.ts`, `runLoop`).
   O modelo ficava livre para responder em prosa (`stop_reason: "end_turn"`, zero `tool_use`);
   esse texto virava o `reply` e era falado. (`tool_choice` só era usado em
   `web/lib/skills/draft.ts`, fora do chat.)
2. **A invariante estava só na prosa.** O `prompt.ts` tem a "REGRA DE OURO" ("NUNCA diga que
   abriu sem chamar a ferramenta"), mas instrução textual é probabilística — não garante.
3. **Restrição de arquitetura decisiva:** o cliente
   (`web/components/ultron/use-ultron-voice.ts`) **fala cada frase no instante em que ela
   termina no streaming** (SentenceAccumulator → AudioQueue → um POST `/api/ultron/tts` por
   frase). O evento terminal `done` (que carrega `uiIntents`/`usedTools`) chega **depois**,
   com o áudio já tocando. `usedTools` nem é lido no cliente.

**Consequência:** um "gate de reconciliação" pós-resposta **não funciona no caminho de
streaming** — quando o servidor descobre que nenhuma tool rodou, a frase-fantasma já foi
falada e não há como "desfalar". O fix precisa ser **preventivo**: impedir que a frase seja
gerada, forçando a tool antes de qualquer fala.

## Decision

**Forçar `tool_choice` na primeira iteração do loop quando a fala do operador for um
comando**, decidido por um classificador determinístico local (zero latência).

1. **Classificador de intenção** — novo módulo puro `web/lib/ultron/intent-gate.ts`:
   `classifyUtterance(text): "command" | "chat"`, matcher por stems pt-BR sobre o vocabulário
   de comando que o próprio `prompt.ts` já ensina (display: abre/mostra/fecha/foca/tira/
   "segunda tela"…; ação: cria/ativa/publica/edita/analisa/monitora…; + nomes de domínio e
   métricas para perguntas de dado). Sem I/O, sem LLM.
2. **Forcing** — em `runLoop`, quando `forceToolFirst && i === startIteration && tools.length > 0`,
   incluir `tool_choice: { type: "any" }` (espelhando o padrão de `skills/draft.ts`). Com a
   tool forçada, o modelo emite **só** o bloco `tool_use` (sem texto) → **nada é falado antes
   da tool rodar**, a race some. A tool roda, gera `ui_intent`/`agentTrigger`, e a **iteração
   seguinte volta a `auto`**, onde o modelo fala o resumo **fundamentado no resultado real**.
   Só a 1ª iteração é forçada; `resumeChat` (captura de tela) **nunca** força.
3. **Defesa em profundidade:**
   - Gate de reconciliação no caminho **não-streaming** (capture/resume): se o `reply` afirma
     ação concluída e nenhuma tool rodou, `stripCompletedClaims` remove a alegação antes de
     retornar (seguro — nada foi falado ainda).
   - Telemetria `console.warn(event:"phantom_claim")` (structured, sem PII) mede o vazamento
     residual — fraseado que o classificador não pegou — para expandir os padrões.
4. **Reforço no prompt** (`prompt.ts`): enquanto a tool não retornou, falar sempre no FUTURO
   ("já abro", "vou enfileirar"); passado só depois que a tool rodou. Complemento, não a garantia.

Trade-off escolhido pelo operador: **forçar só em comandos detectados** (zero latência extra
em conversa/perguntas), e não em todo turno.

## Alternatives considered

- **Forçar `tool_choice:any` em TODO turno + tool `conversar` (no-op de fala) para bate-papo.**
  Garantia máxima (nenhuma narração-fantasma é possível em nenhum fraseado), mas adiciona **+1
  ida ao modelo em todo turno de conversa** e perde o streaming-TTS na 1ª iteração — regressão
  de latência na voz, que é prioridade do projeto. Rejeitada; o classificador cobre 100% dos
  comandos conhecidos sem custo em conversa.
- **Gate de reconciliação puro (sem forcing).** Inviável no streaming: o cliente já falou a
  frase antes de o servidor saber que faltou a tool. Mantido apenas como defesa no caminho
  não-streaming.
- **Só reforçar o prompt.** Já existia (REGRA DE OURO) e falhava — invariante dura não se
  sustenta por texto. Insuficiente sozinho.
- **Bufferizar todo o texto no servidor até `finalMessage()` e só então falar.** Elimina a
  race, mas mata o streaming-TTS por frase (o ganho de latência do ADR/memória de voz).
  Rejeitada.

## Consequences

**Prós:**
- Para qualquer comando reconhecido, o modelo é **obrigado** a chamar a tool; a confirmação
  falada só existe após a execução. Fecha o buraco reportado ("segunda tela").
- Perguntas de dado também passam a forçar uma tool → reforça o "NUNCA invente métricas".
- Zero latência extra em conversa/saudação (caminho rápido `auto` preservado).

**Contras / riscos e mitigações:**
- **Falso-negativo** (fraseado de comando que o classificador não pega) → ainda pode narrar
  sem executar. Mitigação: telemetria `phantom_claim` mede e alimenta a expansão dos padrões;
  gate não-streaming; REGRA DE OURO no prompt.
- **Falso-positivo** (conversa classificada como comando) → força uma tool desnecessária. É
  **low-harm**: força um read-only/preview; todos os writes seguem no fluxo de dois passos
  (`confirm=false` → "sim" → `confirm=true`), então nada é criado/ativado por engano.
- **Guard `tools.length > 0`** evita `tool_choice:any` com lista vazia (erro de API).
- **Validação E2E por voz** ainda pendente (precisa dev server + microfone; não headless).

**Implementação:** commit `f52b2ff` na `main` (2026-06-30). Unit: 282 testes passam
(`intent-gate.test.ts` + extensão de `chat.test.ts`), `tsc --noEmit` limpo. Modelo do Ultron
migrado para `claude-sonnet-5` no mesmo esforço (commit `507dbec`).
