# NODES — handoff pós-/compact

> **Leia este arquivo PRIMEIRO** se a conversa foi compactada. Captura o que foi
> descoberto/decidido/feito nas rodadas recentes. Duas frentes vivas:
> 1. **Ultron Live Review** (PRÓXIMO a implementar — SPEC-014 / ADR 0020). Só docs por enquanto.
> 2. **Painel 3D na landing (Stage3D)** — IMPLEMENTADO + deployado; falta a take de teste.
>
> Fontes de verdade: `docs/specs/SPEC-014-ultron-live-review.md`, `docs/adr/0020-*.md`,
> `docs/specs/SPEC-012-*` (landing/editor), `docs/adr/0018-*` (imagens), `docs/specs/SPEC-013-*`
> + `docs/adr/0019-*` (modo autônomo headless). Memória de projeto carrega sozinha.

---

## 0. TL;DR de estado

- **Ultron Live Review = DESENHADO, NÃO implementado.** SPEC-014 + ADR 0020 escritos nesta rodada.
  Próximo passo: implementar na ordem de **SPEC-014 §10**. Nada de código ainda.
- **Painel 3D (Stage3D) = IMPLEMENTADO e na `main`** (merge `9d4cd5f` + fixes). Web (Vercel) **verde**
  (`57b8741` READY) e runner Fly **redeployado** (imagem `01KTAGZG…`, v25). A geração autônoma já
  provisiona `.glb` + logo + seta `settings.stage3d`.
- **Build gotcha resolvido**: `three/examples/jsm/*` não resolvia do lp-render symlinkado no clean
  install (Vercel/Fly) → **`resolve.symlinks=false`** nos dois `next.config` (web + template).
  Removido `RoomEnvironment` (era código morto). NÃO reverter.
- **LP `imersao-agencia` no Supabase = DELETADA** (slate limpo p/ a gravação). **Cloudflare intacto**
  (republish sobrescreve). Foto do instrutor: `.jpg → .png` corrigido em todos os briefs + skill.
- **Pendente (gravação)**: rodar a **take de teste** da geração da imersão pelo Ultron e verificar
  `settings.stage3d` + página publicada; depois (SPEC-014) decidir Surface A vs B e implementar.
- **Carry-over do modo autônomo (SPEC-013)**: falta `fly secrets set RESEND_API_KEY=re_... -a
  meta-agents-v4` + verificar domínio no Resend (sem isso o email degrada gracioso). Fase 4 não feita.

## 1. O que o usuário quer (Live Review — pedido desta rodada)

Para **gravar um demo**: quando a landing fica pronta e o **operador está PRESENTE**, o Ultron deve
fazer a revisão **visível no navegador do operador** (não headless): trazer a página em tela cheia,
e **loop `print → voz → scroll`** seção a seção até o fim, com o **painel 3D renderizando de verdade
(GPU)**. É a versão "operador presente" do que a SPEC-013 já faz headless p/ "operador ausente".

Pergunta-chave respondida: **com captura de TELA INTEIRA concedida**, o "print" funciona pra qualquer
superfície (inclusive aba cross-origin) — é captura de pixels, não DOM. O que **não** dá de graça:
rolar/printar/fullscreen de uma aba **cross-origin** a partir do dashboard (same-origin policy +
Fullscreen API exige gesto no alvo).

## 2. Decisão (ADR 0020 / SPEC-014)

Revisão **client-side** dirigida por um protocolo **`postMessage`** ("review protocol") entre um
**orquestrador (dashboard)** e um **`ReviewBridge` (lp-render)**, com **print via captura de tela**
(getDisplayMedia, ADR 0010). Duas superfícies, mesmo protocolo:
- **Surface A (DEFAULT, robusto):** preview **same-origin** `/lp-preview/[id]?review=1` embutido em
  fullscreen no dashboard. Scroll direto, **zero mudança no template**, sem throttling. Visual
  idêntico ao publicado (mesmo lp-render + Stage3D); só a URL na barra difere.
- **Surface B:** **nova aba** da página publicada (URL `b2tech.io` autêntica). Scroll via ReviewBridge
  (postMessage), print via captura de **tela inteira**, fullscreen **manual (F11)**.

Loop: `scrollTo → settle (espera o 3D pintar) → captura frame → visão (1–2 frases pt-BR) → TTS →
próximo`, até o rodapé. Cancelável, com cap de passos/timeout.

## 3. Plano de implementação (SPEC-014 §10)

1. `ReviewBridge` no **lp-render** (protocolo + allowlist de origem) + teste de origem.
2. Endpoint `web/app/api/.../review-frame` (visão sobre 1 frame → 1–2 frases) + rate-limit/validação.
3. **Orquestrador** client (Surface A primeiro: iframe fullscreen same-origin) + loop scroll→print→voz.
4. **Tool do Ultron** `request_live_review(landing_page_id)` + fan-out (espelhar
   `web/lib/ultron/agent-trigger.ts`: CustomEvent + BroadcastChannel) → `startLiveReview` no dashboard.
5. **Surface B** (window.open + bridge cross-origin + captura de tela inteira) como variante.
6. Hardening (threat model STRIDE da SPEC-014 §6), docs, teste e2e na gravação.

## 4. Reuso (não reinventar) — caminhos

- Captura de frame: getDisplayMedia persistente + `capture_screen` (ADR 0010 / memória
  `ultron-screen-vision`).
- Visão + voz: `web/lib/ultron/*` (chat/tools/agent-trigger) + `use-ultron-voice` (TTS).
- Preview real: `web/app/(preview)/lp-preview/[id]/preview-client.tsx` → lp-render `PageBody` (inclui
  `packages/lp-render/src/sections/Stage3D.tsx`).
- Transporte de sinal: `web/lib/ultron/agent-trigger.ts` (`LandingEditSignal`/`AgentTrigger` →
  espelhar `LiveReviewSignal`).
- Email de encerramento (opcional): `scripts/send-email.cjs` + fase `notifying` (SPEC-013).

## 5. Estado do sistema (o que está no ar)

- **Git**: `main` == `origin` (HEAD `57b8741`). Os docs desta rodada (este NODES + SPEC-014 + ADR 0020)
  ainda precisam ser commitados (ver §7).
- **Vercel (web/editor/preview)**: deploy `57b8741` READY (produção). `resolve.symlinks=false` é o
  que faz o lp-render+three buildar no clean install — **não remover**.
- **Fly runner `meta-agents-v4`** (machine `286501db9e7e78`, gru): imagem `01KTAGZG…` v25, com skill
  stage3d + lp-render + `iron_man_rig.glb` (3MB) + three no template. Redeploy via `fly deploy`.
- **Supabase**: LP `imersao-agencia` deletada. `settings.stage3d {model,poster?,rain?,color?,logo?}`
  é o contrato do painel; provisionado pela skill `create-landing-page-brunobracaioli` Passo 6.

## 6. Gotchas obrigatórios

- **NUNCA** `git add .` cego aqui: já varreu um **OBS-Installer de 157MB** que o GitHub recusou.
  `.gitignore` agora cobre `imagens-geradas/`, previews soltos. Stagear **paths explícitos**.
- **lp-render é file: symlinkado** → builds resolvem suas deps pelo **realpath** (sem node_modules no
  clean install). TS usa `preserveSymlinks`; webpack usa `resolve.symlinks=false`. Qualquer dep nova
  do lp-render (ex.: futuras libs do ReviewBridge) tem que estar no **consumidor** (web + template).
- **WebGL headless é preto/instável** → a revisão Live (SPEC-014) roda no navegador real do operador
  de propósito. A revisão headless (SPEC-013) é p/ operador ausente.
- **Cross-origin**: dashboard (`vercel.app`) ≠ landing (`b2tech.io`). Surface B precisa do ReviewBridge
  + allowlist de origem. Surface A (same-origin) evita tudo isso.
- **Supabase headless = REST/curl** (MCP é OAuth-gated no runner). Padrão das skills.

## 7. Próximas ações concretas

1. **Commitar os docs** desta rodada: `NODES.md` + `docs/specs/SPEC-014-*` + `docs/adr/0020-*`
   (paths explícitos; conventional commit `docs(live-review): SPEC-014 + ADR 0020 + handoff`).
2. (Gravação) Take de teste: disparar a criação da imersão pelo Ultron → conferir `settings.stage3d`
   + página com painel/reveal. (Custo: gpt-image-2 do hero/og ~US$0,40; ~14 min.)
3. Implementar SPEC-014 §10 (passos 1→6). Surface A primeiro.
4. (Email autônomo) `fly secrets set RESEND_API_KEY=...` + domínio Resend.
