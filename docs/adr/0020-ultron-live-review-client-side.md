# ADR 0020 — Revisão visual ao vivo no navegador do operador (client-side), via captura de tela + ponte postMessage

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-04 |
| Decidido por | brunobracaioli |
| Spec | [SPEC-014](../specs/SPEC-014-ultron-live-review.md) |
| Relacionado | [SPEC-013](../specs/SPEC-013-ultron-autonomous-mode.md)/[ADR 0019](0019-ultron-autonomous-mode.md) (revisão headless), [ADR 0010](0010-ultron-screen-vision.md) (Ultron vê a tela), [ADR 0017](0017-shared-lp-render-package.md) |
| Afeta | `packages/lp-render/` (ReviewBridge), `web/` (orquestrador + tool + endpoint visão), template (Surface B opcional) |

## Context

O modo autônomo (SPEC-013) revisa a página **headless no runner Fly** (Playwright, prints
server-side → bucket → visão → narração) porque o caso de uso é o **operador AUSENTE**. Mas há um
caso distinto: o operador **presente** (ex.: gravando um demo) quer **ver** a IA abrir a página,
rolar, opinar por voz — no **próprio navegador**, com o **painel 3D renderizando de verdade** (GPU).
A revisão headless não serve aqui: WebGL headless é instável (frame preto) e nada acontece
visivelmente na tela do operador.

Restrições de browser que moldam a solução:
- Uma aba **não lê/rola/printa** outra aba **cross-origin** (same-origin policy). A landing publicada
  (`b2tech.io`) é cross-origin ao dashboard (`vercel.app`).
- A **Fullscreen API** exige gesto do usuário no próprio documento → não dá pra forçar fullscreen
  numa aba cross-origin a partir do dashboard.
- **`getDisplayMedia`** (captura de tela, já usado no ADR 0010) captura **pixels da tela**, contornando
  o cross-origin para o "print" (não é acesso ao DOM).

## Decision

**Construir uma revisão client-side, operador-presente, dirigida por um protocolo `postMessage`
("review protocol") entre um orquestrador no dashboard e um `ReviewBridge` no lp-render, com o
"print" feito pela captura de TELA do operador (getDisplayMedia).** Duas superfícies sobre o mesmo
protocolo:

- **Surface A (default):** preview **same-origin** (`/lp-preview/[id]?review=1`) embutido em
  fullscreen no dashboard. Scroll direto, sem mudar o template, sem throttling — **mais robusto**.
- **Surface B:** **nova aba** da página publicada (URL autêntica), scroll via `ReviewBridge`
  (postMessage), print pela captura de **tela inteira**; fullscreen manual (F11).

O loop é: `scrollTo → settle (espera o 3D pintar) → captura frame → visão (1–2 frases) → TTS →
próximo`, até o rodapé. Reusa captura (ADR 0010), visão+voz (pipeline Ultron), preview (ADR 0017) e
o transporte de sinal (CustomEvent + BroadcastChannel).

## Consequences

**Positivas**
- Mostra a IA "lendo" a página **na tela do operador**, com o painel 3D **real** (GPU) — resolve o
  problema do print headless preto.
- Um só protocolo serve preview embutido (A) e aba publicada (B); o ReviewBridge é compartilhado.
- Complementa (não substitui) a SPEC-013; operador-ausente continua na revisão headless.

**Negativas / trade-offs aceitos**
- **Surface B** exige um `ReviewBridge` no template e captura de tela inteira; fullscreen é manual.
  Por isso **A é o default**.
- Depende do operador conceder captura de tela (já é o fluxo do ADR 0010).
- Aba em 2º plano (B) sofre throttling → loop pausado em ~1 passo/s (aceitável, é pausado por voz).
- Nova superfície `postMessage` = nova porta → mitigada por **allowlist de origem** (threat model §6 da spec).

## Alternatives considered
- **Estender a revisão headless (SPEC-013) p/ rodar com GPU** (swiftshader/flags): ainda invisível
  pro operador e WebGL headless segue não-confiável. Não atende "ver na tela".
- **Forçar fullscreen + scroll na aba publicada sem bridge**: impossível (cross-origin + Fullscreen
  API exige gesto no alvo). Daí o ReviewBridge (B) ou o preview same-origin (A).
- **Capturar o canvas WebGL via `toDataURL`/DOM**: não confiável p/ a cena (precisa preserveDrawingBuffer
  e não pega o composite final) → usar o stream de tela uniformiza A e B.
