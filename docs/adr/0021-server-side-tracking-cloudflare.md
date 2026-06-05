# ADR 0021 — Tracking de landing page: multi-tag client-side agora, tagging-server no Cloudflare depois

| Campo | Valor |
|---|---|
| Status | Accepted (Fase 1 + Fase 2); Fase 2 em construção (2026-06-05) |
| Data | 2026-06-05 |
| Decidido por | brunobracaioli |
| Spec | [SPEC-015](../specs/SPEC-015-landing-page-tracking.md) |
| Relacionado | [ADR 0012](0012-landing-pages-on-cloudflare-pages.md) (Pages + consent), [ADR 0015](0015-editable-landing-pages-supabase-draft.md) (rascunho no Supabase), [ADR 0017](0017-shared-lp-render-package.md), [ADR 0018](0018-landing-page-section-images.md) |
| Afeta | `packages/lp-render/`, `landing-pages/_template/`, `web/`, skills `create-landing-page-*` / `lista-de-clientes`, (Fase 2) Cloudflare Worker + `lp_tracking_secrets`/`lp_events` |

## Context

Toda landing page gerada já nascia com **um** Pixel da Meta e **um** GA4, injetados
consent-gated (`landing-pages/_template/components/Tracking.tsx`) a partir de
`landing_pages.settings.tracking = { fb_pixel_id, ga4_id, consent_key }`. Limitações:

1. **Um de cada.** Não dá para rodar mais de um Pixel/GA4, nem Google Ads, por página.
2. **Sem eventos de funil.** Só `PageView`. Nada de `ViewContent`, scroll-depth, ou o clique
   no botão que leva ao checkout externo (Hubla/Hotmart) — que é a ação de conversão da LP.
3. **Sem server-side.** Só Pixel no browser → EMQ (Event Match Quality) baixo, perda por
   ITP/adblock, sem deduplicação Pixel↔servidor.

Existe em `track_feature/` uma **referência completa** de tagging-server no Cloudflare
(Worker estilo Stape: Meta CAPI + GA4 Measurement Protocol + Google Ads ClickConversion,
dedup por `event_id`, cookies first-party `_fbp/_fbc`, D1 como banco de eventos), porém é
**single-tenant** (um pixel/token por Worker) e não está plugada ao pipeline de LP.

Objetivo: toda LP sair com tracking "configurado" — eventos disparando — e o operador
gerenciar **N pixels Meta, N GA4, N Google Ads por LP** numa aba "Tracking" do editor.

## Decision

Entregar em **duas fases**, governadas por um princípio de segurança inegociável.

### Princípio: público × segredo

`content-spec.json` é **buildado para dentro do site estático público** → tudo nele é
browser-visível. Logo:

- **PÚBLICO** (pode ir em `settings.tracking` → content-spec): pixel IDs, GA4 measurement
  IDs (`G-…`), Google Ads IDs (`AW-…`). Já aparecem no browser de qualquer forma.
- **SEGREDO** (NUNCA em settings/content-spec/repo): Meta CAPI access token, GA4 API secret,
  tokens do Google Ads. Vivem (Fase 2) em `lp_tracking_secrets` (RLS service-role only), que
  **o serializer nunca seleciona**, lidos só pelo Worker server-side.

### Fase 1 — multi-tag client-side + eventos (implementada)

- `Settings.tracking`/`ContentSpec.tracking` ganham `meta_pixels?/ga4_ids?/google_ads_ids?`
  (arrays opcionais). Os campos legados `fb_pixel_id`/`ga4_id` permanecem e são o fallback de
  retrocompatibilidade; quando os arrays existem, têm precedência. `consent_key` inalterado.
- `Tracking.tsx` itera os arrays: um `fbq('init')` por pixel + um `PageView`; um
  `gtag('config')` por GA4 e por Google Ads (um só `gtag.js`).
- Novo `landing-pages/_template/lib/track.ts` instrumenta, **consent-gated**:
  `ViewContent`/`view_item` no load; `ScrollDepth`/`scroll` em 25/50/75/90%;
  `AddToCart`+`InitiateCheckout`+`begin_checkout`(+conversão Google Ads) no clique do CTA que
  aponta pro `checkout_url`; `Lead`/`generate_lead` no CTA da waitlist. Cada evento leva um
  `event_id` próprio (futuro-proof p/ a dedup CAPI da Fase 2).
- **Editor**: nova aba "Tracking" (`web/components/landing/landing-page-editor.tsx`) com três
  listas add/remover, escrita via `PATCH /api/landing-pages/:id/settings` com `{ tracking }`.
  O handler faz **shallow-merge** do objeto `tracking` (preserva `consent_key`/legados) e
  **substitui** cada array (remover um pixel encolhe a lista). Validação `.strict()` por regex
  e limite de 10 IDs (`web/lib/landing/validate.ts`) — nenhuma chave de segredo é aceita aqui.
- **Geração**: a skill semeia os arrays dos defaults do cliente em `lista-de-clientes`
  (`META_PIXELS/GA4_IDS/GOOGLE_ADS_IDS`); o operador refina por LP no editor.

### Fase 2 — tagging-server no Cloudflare (em construção desde 2026-06-05)

> Threat model STRIDE da superfície nova:
> [docs/security/threats/landing-page-tracking.md](../security/threats/landing-page-tracking.md).
> Contrato concreto: o Worker vive em `worker/track/`; o browser envia ao endpoint o
> `tracking.server = { endpoint, lp_id }` (campos PÚBLICOS no content-spec) junto do evento.


- **Topologia:** um Worker multi-tenant em `track.b2tech.io` (adaptado de `track_feature/`).
  Como toda LP é `*.b2tech.io`, `track.b2tech.io` é **same-site** (mesmo eTLD+1) → cookies
  `Domain=.b2tech.io` são first-party e sobrevivem ao ITP; CORS restrito a `*.b2tech.io`.
- **Config por request:** o browser envia IDs públicos + `lp_id`; o Worker resolve os
  **segredos** em `lp_tracking_secrets` (cache curto) e faz fan-out `Promise.all` → Meta CAPI
  (por pixel, mesmo `event_id` do browser = dedup) ‖ GA4 MP ‖ Google Ads.
- **Eventos:** Worker grava no **D1** (schema de `track_feature/schema.sql`, sem PII crua) e
  replica um **resumo** para `lp_events` no Supabase, para o dashboard nativo (web) ler via RLS.
- **Segredos no dashboard:** subseção "CAPI" da aba Tracking escreve em `lp_tracking_secrets`
  via API **write-only/mascarada** (`PUT /api/landing-pages/:id/tracking-secrets`) — nunca
  devolve o valor, só "configurado: sim/não".

## Consequences

**Positivas**
- Fase 1 entrega valor imediato (multi-pixel + eventos de funil) reusando o pipeline atual:
  zero migration, zero nova superfície pública, zero segredo no banco.
- O `event_id` por evento já na Fase 1 evita refatorar o client quando a dedup CAPI entrar.
- A separação público×segredo no código (schema `.strict()` + serializer que ignora segredos)
  impede vazamento de token mesmo se um operador tentar colá-lo no editor.
- Same-site sob `b2tech.io` dá o benefício de cookie first-party do Stape **sem** Stape e sem
  Worker por LP.

**Negativas / trade-offs aceitos**
- Fase 1 mantém EMQ "de Pixel puro" (sem IP/UA/PII hasheada server-side) até a Fase 2.
- Eventos podem se perder em navegação muito rápida ao checkout (Pixel client-side); aceitável
  — a conversão real é confirmada pela plataforma de checkout. Mitigado de vez pelo CAPI (F2).
- Google Ads na Fase 1 fica no caminho simples (conversão via gtag/GA4-link); o upload direto
  de ClickConversion (com gclid) é Fase 2.
- LP em domínio próprio de cliente (não `*.b2tech.io`) perderia o same-site; fora de escopo
  hoje (todas as LPs são `*.b2tech.io`). Solução futura: Pages Function same-origin por LP.

## Alternatives considered

- **D1-only para eventos** (como a referência): mais barato/rápido na borda, mas o dashboard
  web não lê D1 direto. Escolhido **D1 + espelho Supabase** para ter borda barata **e**
  dashboard nativo.
- **Segredos como Cloudflare Worker secrets** (provisionados por onboarding): segurança máxima
  (zero segredo no DB), mas sem self-serve no dashboard. Escolhido **tabela Supabase isolada**
  pelo self-serve, com RLS service-role + API write-only como contenção.
- **Worker (Pages Function) embutido por LP** (same-origin perfeito): funciona em domínio
  próprio, mas exige bind de D1 + secrets por projeto (pesado). Rejeitado enquanto tudo é
  `*.b2tech.io` — um Worker compartilhado same-site resolve com muito menos operação.
