# SPEC-014 — Ultron Live Review (revisão visual ao vivo, operador presente)

| Campo | Valor |
|---|---|
| Status | Surface A **implementada** (2026-06-04); Surface B pendente |
| Data | 2026-06-04 |
| Autor | brunobracaioli (via Claude Code) |
| ADR | [0020](../adr/0020-ultron-live-review-client-side.md) |
| Relacionado | [SPEC-013](SPEC-013-ultron-autonomous-mode.md) (revisão headless, operador AUSENTE), [ADR 0010](../adr/0010-ultron-screen-vision.md) (Ultron vê a tela), [ADR 0017](../adr/0017-shared-lp-render-package.md) (lp-render) |
| Afeta | `packages/lp-render/` (ReviewBridge), `web/` (orquestrador + tool + endpoint de visão), template (Surface B opcional) |

## 1. Objetivo

Quando uma landing page fica pronta **com o operador presente** (ex.: gravação), o Ultron faz uma
revisão **visível no navegador do operador**: traz a página em tela cheia e roda um loop
`scroll → captura frame → visão → narra por voz`, **seção a seção**, até o rodapé — de modo que o
operador (e a câmera) **vê** a IA "lendo" a página e **ouve** as opiniões, com o painel 3D
renderizando de verdade (GPU real).

Complementa, **não substitui**, a SPEC-013 (revisão headless server-side, para quando o operador
está AUSENTE). Aqui o operador está junto e quer ver acontecendo.

## 2. Duas superfícies, um protocolo

A revisão dirige um **alvo** que renderiza a página (lp-render). Dois modos, **mesmo protocolo
`postMessage`**:

- **Surface A — preview embutido em fullscreen (DEFAULT, robusto).** O dashboard monta o preview
  same-origin (`/lp-preview/[id]?review=1`, o lp-render real, **inclui o painel 3D**) numa view
  fullscreen que ele controla. Scroll é direto (same-origin). **Zero mudança no template.** Tudo
  numa aba em foco (sem throttling de aba em 2º plano).
- **Surface B — nova aba da página publicada (URL autêntica `b2tech.io`).** `window.open(url?review=1)`;
  scroll dirigido pelo `ReviewBridge` via `postMessage`; **print pela captura de TELA INTEIRA**
  (`getDisplayMedia`, contorna o cross-origin pois é captura de pixels). Fullscreen "de verdade" é
  manual (F11) — o dashboard não pode forçar fullscreen em aba cross-origin.

O orquestrador é **surface-pluggable**: o mesmo loop fala com um `<iframe>` (A) ou um
`window.open` (B). O `ReviewBridge` no lp-render responde igual nos dois casos.

> Decisão de qual usar é runtime (default A). Ver ADR 0020.

## 3. Componentes

### 3.1 `ReviewBridge` (em `packages/lp-render`, client component, montado no PageBody)
Ativa **apenas** quando `?review=1` na URL **e** as mensagens vêm de uma **origem allowlistada**
(origens do dashboard: prod `meta-agents-v4.vercel.app` + previews + localhost dev — via const
configurável). Caso contrário, inerte (não escuta nada). Protocolo (JSON tipado, `postMessage`):

| ← recebe | → responde |
|---|---|
| `{type:"review:hello"}` | `{type:"review:layout", scrollHeight, viewportH, steps:[{y,label}]}` |
| `{type:"review:scrollTo", y}` | (smooth-scroll; ao assentar) `{type:"review:scrolled", y, atBottom}` |
| `{type:"review:ping"}` | `{type:"review:pong"}` |

- `steps` = posições de scroll por seção (deriva de `contentSpec.sections` + offsets dos elementos;
  o painel 3D conta como passos extras dado seu `220vh`). `label` = tipo da seção (pra narração).
- **Segurança**: checa `event.origin` contra a allowlist; ignora o resto. Só lê o próprio layout e
  rola a si mesmo — **não navega, não executa, não exfiltra**. Sem `eval`.

### 3.2 Orquestrador de revisão (em `web`, client)
- Entrada: `startLiveReview({ landingPageId, url?, surface })`, disparada por (a) resultado de uma
  tool do Ultron, ou (b) um botão "revisar ao vivo" no dashboard.
- **Reusa o stream de tela** já concedido (getDisplayMedia persistente do ADR 0010 / `capture_screen`).
  Sem stream → pede permissão (gesto do usuário).
- Surface A: monta `<iframe src="/lp-preview/[id]?review=1">` em container fullscreen (Fullscreen API
  no elemento same-origin, com gesto). Surface B: `window.open(publishedUrl + "?review=1")` + guarda `winRef`.
- **Loop** (cancelável; cap duro de passos):
  1. `hello` → recebe `layout` → lista de `steps`.
  2. para cada step: `scrollTo(y)` → aguarda `scrolled` + **settle extra** (espera o painel 3D
     pintar: até o canvas ter pixel não-preto OU timeout ~2.5s) →
  3. **captura um frame** do stream de tela →
  4. POST `/api/ultron/review-frame` (visão: "descreva e opine sobre esta seção em 1–2 frases,
     pt-BR, voz da marca; se for a abertura 3D, comente o impacto cinematográfico") → texto →
  5. **TTS fala** (aguarda terminar) → próximo step.
  3'. Surface A pode dispensar a captura de tela e ler o frame same-origin, MAS o canvas WebGL do
     painel 3D não é capturável por DOM-readback confiável → **usar sempre o stream de tela** para o
     print (uniformiza A e B).
- Fim: narração de encerramento; **opcional** disparar o email (reusa o `notify` da SPEC-013) ou só falar.
- O dashboard pode **espelhar o frame atual + a seção** numa faixa (efeito "a IA está olhando"),
  útil mesmo se a captura de tela não estiver ativa.

### 3.3 Trigger do Ultron
- Tool `request_live_review(landing_page_id)` → retorna `LiveReviewSignal { landingPageId, url }`,
  fan-out pro browser pelo **mesmo transporte** de `landingEdits`/`agentTriggers` (CustomEvent +
  BroadcastChannel) → o dashboard chama `startLiveReview`. (Reusa o padrão de
  `web/lib/ultron/agent-trigger.ts`.)
- Gatilho natural: o operador diz *"Ultron, revisa a página comigo"* logo após a criação, OU o fim
  da criação (operador presente) oferece a revisão ao vivo.

### 3.4 Endpoint de visão (`web/app/api/.../review-frame`)
- Recebe `{ frame (image), label, landing_page_id }` (atrás do gate de sessão).
- Chama Claude (visão) → 1–2 frases de opinião pt-BR (voz da marca). Não usa browser headless — só
  visão sobre o frame fornecido.
- Rate-limit + validação de input (tamanho do frame, label).

## 4. Pacing / timing
- ~10–15 s por passo (scroll + settle + chamada de visão + TTS). Loop pausável/cancelável.
- Cap duro: máx N passos (ex.: 12) + timeout global (ex.: 4 min) → encerra com fala de fechamento.

## 5. Edge cases
- **Sem captura de tela**: pede permissão; ou degrada pra "espelho de frame" no dashboard (DOM
  capture) — o painel 3D pode não sair (WebGL) → narra a abertura pelo **conteúdo conhecido**
  (`settings.stage3d` existe) em vez do frame preto.
- **Painel 3D demora a pintar**: settle até pixel não-preto ou timeout; se preto, narra a abertura
  pelo conteúdo conhecido (não pelo frame).
- **Aba em 2º plano (Surface B)**: throttling → passo ≥1 s; ou mantém dashboard visível lado a lado.
- **Popup bloqueado / reduced-motion**: start exige gesto do usuário; scroll instantâneo se reduce-motion.
- **Cross-origin (Surface B)**: bridge + allowlist; nunca aceita origem fora da lista.

## 6. Segurança / threat model (STRIDE)
- **Spoofing**: allowlist de `event.origin` no ReviewBridge — só dashboards confiáveis dirigem o scroll.
- **Tampering**: protocolo de tipos fixos; sem `eval`; bridge só rola a própria página.
- **Info disclosure**: o frame é a tela do próprio operador (já compartilhada ao Ultron por ADR 0010);
  endpoint de visão atrás do gate de sessão; nada além da página pública.
- **DoS**: loop com cap de passos + timeout + cancel.
- **Elevation**: o bridge não navega/age além de rolar; sem acesso a storage/cookies de outras origens.

## 7. Critérios de aceite
1. Operador presente: dispara a revisão → a página sobe em tela cheia → a IA **rola seção a seção,
   narrando cada uma por voz**, até o rodapé → fala de encerramento (+ email opcional).
2. **Surface A** funciona com **zero** mudança no template; **Surface B** funciona com o ReviewBridge
   + captura de tela inteira.
3. O **painel 3D renderiza** (GPU real) e o scroll dispara o scrub cinematográfico durante a revisão.
4. O ReviewBridge **ignora** origens não-allowlistadas (teste de spoof).
5. Cancelável a qualquer momento; respeita cap de passos/timeout.

## 8. Reuso (não reinventar)
- Captura de frame: `getDisplayMedia` persistente + `capture_screen` (ADR 0010 / memória
  `ultron-screen-vision`).
- Visão + voz: pipeline de chat/TTS do Ultron (`web/lib/ultron/*`, `use-ultron-voice`).
- Preview real: `web/app/(preview)/lp-preview/[id]` (renderiza lp-render, inclui Stage3D).
- Transporte de sinal: `web/lib/ultron/agent-trigger.ts` (CustomEvent + BroadcastChannel) — espelhar.
- Email de encerramento (opcional): `scripts/send-email.cjs` / fase `notifying` da SPEC-013.

## 9. Fora de escopo
- Substituir a revisão headless server-side (SPEC-013 continua para operador-ausente).
- Gravação de vídeo (o OBS do operador faz isso).
- Forçar fullscreen em aba cross-origin (impossível pelo browser; F11 manual em Surface B).

## 10. Plano de implementação (ordem sugerida)
1. ✅ **ReviewBridge** no lp-render (`packages/lp-render/src/sections/ReviewBridge.tsx`): protocolo
   `review:hello/layout/scrollTo/scrolled/ping/pong`, allowlist de origem (same-origin + `*.vercel.app`),
   inerte sem `?review=1`. Montado no `PageBody`, exportado no barrel. Settle do 3D por timeout.
2. ✅ **Endpoint** `POST /api/ultron/review-frame` (`web/lib/ultron/review-frame.ts` + handler em
   `route.ts`): visão one-shot sonnet, 1–2 frases pt-BR, rate-limit `ultronReview`, validação base64.
3. ✅ **Orquestrador** client: `web/lib/ultron/live-review.ts` (`runLiveReview`, loop cancelável +
   cap 14 passos + timeout 4 min) e `web/components/ultron/live-review-stage.tsx` (overlay
   fullscreen + iframe `/lp-preview/[id]?review=1`, botão de gesto p/ fullscreen+captura).
4. ✅ **Tool** `request_live_review` (`tools.ts`) + `LiveReviewSignal` (`agent-trigger.ts`) +
   extração/propagação no `chat.ts`/`route.ts`/`pending.ts` + fan-out `publishLiveReviews`
   (`use-ultron-voice.ts`) + montagem do overlay no `ultron-widget.tsx`.
5. ⬜ **Surface B** (window.open + bridge cross-origin + captura de tela inteira) como variante —
   o ReviewBridge já está pronto no lp-render para habilitá-la (mesmo protocolo).
6. ⬜ Teste e2e na gravação (operador presente). Threat model §6 já implementado (allowlist + cap).

### Notas de implementação (Surface A)
- **Bridge no lp-render** (decisão do operador): inerte na página publicada normal; só ativa com
  `?review=1` + origem allowlistada. O template publicado fica inalterado (validado: type-check +
  build clean-install com o gotcha do symlink `resolve.symlinks=false`).
- **Settle do painel 3D**: por timeout (`settleMs` ~2200ms, dois beats), porque o "print" é o
  composite de GPU via stream de tela — não há readback confiável do canvas WebGL.
- **Gesto único**: o disparo vem por voz (sem gesto), então o overlay mostra "Iniciar revisão ao
  vivo"; um clique satisfaz Fullscreen API + getDisplayMedia e arranca o loop. Sem gesto/fullscreen,
  degrada para overlay `fixed inset-0`.
- **Reuso de stream/voz**: o overlay reusa `captureFrame`/`speak`/`startShare` expostos pelo
  `use-ultron-voice` — sem segundo prompt de captura nem caminho de TTS duplicado.
- **Testes**: `tools.test.ts` (request_live_review: happy/404/generating/sem-id) e
  `agent-trigger.test.ts` (contrato `isLiveReviewSignal`/`liveReviewKey`). O loop DOM (`runLiveReview`)
  não tem teste unitário porque o ambiente vitest é `node` (sem jsdom) — coberto no teste e2e manual.
