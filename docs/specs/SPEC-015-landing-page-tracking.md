# SPEC-015 — Tracking automático de landing page (multi-tag + server-side)

| Campo | Valor |
|---|---|
| Status | Fase 1 **implementada** (2026-06-05); Fase 2 desenhada (pendente) |
| Data | 2026-06-05 |
| Autor | brunobracaioli (via Claude Code) |
| ADR | [0021](../adr/0021-server-side-tracking-cloudflare.md) |
| Relacionado | [ADR 0012](../adr/0012-landing-pages-on-cloudflare-pages.md) (Pages + consent LGPD), [ADR 0015](../adr/0015-editable-landing-pages-supabase-draft.md), [ADR 0017](../adr/0017-shared-lp-render-package.md), [SPEC-012](SPEC-012-landing-page-editor.md) |
| Afeta | `packages/lp-render/`, `landing-pages/_template/`, `web/`, skills `create-landing-page-*` / `lista-de-clientes` |

## 1. Objetivo

Toda landing page gerada já nasce **com tracking configurado e disparando**: múltiplos Pixels
da Meta, GA4 e Google Ads por página, e os eventos de funil (`ViewContent`, scroll-depth,
clique no botão de checkout, `AddToCart`). O foco é a LP com **botão para checkout externo**
(Hubla/Hotmart) — o checkout em si é traqueado pela plataforma; nós cuidamos só da LP. O
operador gerencia os IDs numa aba **"Tracking"** no editor. Tudo **consent-gated** (LGPD).

## 2. Princípio de segurança — público × segredo

`content-spec.json` é buildado para dentro do **site estático público** ⇒ browser-visível.

- **PÚBLICO** (vai em `settings.tracking` → content-spec): pixel IDs, GA4 (`G-…`), Ads (`AW-…`).
- **SEGREDO** (NUNCA em settings/content-spec/repo): Meta CAPI token, GA4 API secret, tokens do
  Google Ads. Fase 2 → tabela `lp_tracking_secrets` (RLS service-role), lida só pelo Worker.

O write boundary do editor (`web/lib/landing/validate.ts`) é `.strict()`: aceita só os arrays
de IDs públicos; qualquer chave de segredo é rejeitada.

## 3. Contrato de dados

`Settings.tracking` / `ContentSpec.tracking` (em `packages/lp-render/src/`):

```ts
tracking: {
  fb_pixel_id: string;        // legado (= 1º meta_pixel) — back-compat
  ga4_id: string;             // legado (= 1º ga4_id) — back-compat
  consent_key: string;        // não editável no editor
  meta_pixels?: string[];     // multi (precede o legado quando presente)
  ga4_ids?: string[];
  google_ads_ids?: string[];
}
```

Formatos (regex, espelhados client+server): Meta `^\d{15,16}$`; GA4 `^G-[A-Z0-9]{6,12}$`;
Google Ads `^AW-[0-9]{9,12}(\/[A-Za-z0-9_-]{1,40})?$`. Máx **10** IDs por tipo.

Write path: `PATCH /api/landing-pages/:id/settings` com `{ tracking: {...arrays} }`. O handler
**shallow-merge** do objeto `tracking` (preserva `consent_key`/legados) e **substitui** cada
array (remover ID encolhe a lista).

## 4. Taxonomia de eventos (Fase 1 — `landing-pages/_template/lib/track.ts`)

| Gatilho | Meta (fbq + eventID) | GA4 (gtag) | Google Ads |
|---|---|---|---|
| mount | `ViewContent` | `view_item` | — |
| scroll 25/50/75/90% | `ScrollDepth` (custom, `{depth}`) | `scroll` (`percent_scrolled`) | — |
| clique em CTA → `checkout_url` | `AddToCart` + `InitiateCheckout` | `begin_checkout` | `conversion` por `AW-id` |
| clique em CTA → `waitlist_url` | `Lead` | `generate_lead` | — |

- Detecção do CTA: delegação de clique no `document` (fase de captura), comparando o `href` do
  `<a>` (origin+pathname, ignorando query/hash — robusto a UTMs anexadas) com
  `checkout_url`/`waitlist_url` do `contentSpec`.
- `value` = `price_cents/100`, `currency = "BRL"`.
- Cada evento leva `event_id` próprio (UUID) → na Fase 2 o mesmo id vai num POST first-party ao
  Worker para a Meta deduplicar Pixel↔CAPI.
- **Consent-gated**: a instrumentação só monta após consentimento e desmonta se revogado. Nada
  de tracking no HTML estático inicial.

## 5. Edge cases

- **LP sem nenhum pixel/GA4/Ads**: `resolveTrackingIds` retorna listas vazias → nenhuma tag
  injetada, nenhum evento (no-op silencioso). Página funciona normal.
- **Consent negado/ausente**: `<Tracking/>` retorna `null`, instrumentação não monta.
- **ID inválido digitado no editor**: hint visual (borda âmbar) no client; o server rejeita o
  PATCH inteiro (`.strict()` + regex) — o array não persiste malformado.
- **LP legada (só `fb_pixel_id`/`ga4_id`)**: arrays ausentes → usa o single como 1 item; o
  editor mostra o pixel legado na lista e o operador cresce a partir dele.
- **Navegação rápida ao checkout**: Pixel client-side pode perder o evento; a conversão real é
  confirmada pela plataforma de checkout (e, na Fase 2, pelo CAPI server-side).

## 6. Critérios de aceite (Fase 1)

1. `contentDocToFiles` carrega `meta_pixels/ga4_ids/google_ads_ids` para o content-spec; legados
   intactos. (`packages/lp-render` round-trip test.)
2. `settingsPatchSchema` aceita arrays bem-formados (≤10) e rejeita formato inválido, arrays
   grandes e qualquer chave de segredo (`consent_key`/`capi_token`). (`web` validate test.)
3. Editor: aba "Tracking" adiciona/remove Pixel/GA4/Ads; persiste em
   `landing_pages.settings.tracking`; remover encolhe o array; reconcile não derruba edição.
4. Build do template (static export) com 2 pixels + 2 GA4 conclui sem erro, e a **HTML
   estática inicial não contém nenhuma tag de tracking** (propriedade LGPD: tudo é
   consent-gated e injetado client-side). Type-check de `lp-render`/`web`/template limpo.
5. Em runtime (após consent): a injeção emite **um `fbq('init')` por pixel** e **um
   `gtag('config')` por id**, e os eventos disparam — `ViewContent` no load, `ScrollDepth`
   ao rolar, `AddToCart`/`InitiateCheckout` no clique do botão de checkout — verificado no
   Meta Pixel Helper / GA4 DebugView, em **todos** os pixels.

## 7. Fase 2 (resumo — detalhe no ADR 0021)

Worker multi-tenant `track.b2tech.io` (same-site, cookies first-party `.b2tech.io`) →
Meta CAPI + GA4 MP + Google Ads ClickConversion com dedup por `event_id`; eventos no D1 +
espelho `lp_events` no Supabase para o dashboard; segredos em `lp_tracking_secrets` (RLS
service-role) preenchidos por API write-only no editor. **STRIDE** da superfície pública
(endpoint de coleta, segredos, PII hasheada) entra no threat model próprio
(`docs/security/threats/landing-page-tracking.md`) junto com a implementação da Fase 2.

> **STRIDE — Fase 1 (superfície atual).** A única entrada nova é o conjunto de IDs editáveis.
> *Tampering/Information disclosure*: mitigados pelo schema `.strict()` + regex (sem `<`/`"`),
> pela separação público×segredo (serializer ignora segredos) e por nenhum segredo trafegar.
> *DoS*: cap de 10 IDs/tipo + rate-limit existente do endpoint de settings. *Repudiation*: o
> `operation_logs` do editor cobre. Sem elevação de privilégio nova.
