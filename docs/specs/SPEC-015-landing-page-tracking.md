# SPEC-015 — Tracking automático de landing page (multi-tag + server-side)

| Campo | Valor |
|---|---|
| Status | Fase 1 **implementada**; Fase 2 **em construção** (2026-06-05) |
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

## 7. Fase 2 — tagging server no Cloudflare (contrato)

Worker multi-tenant `track.b2tech.io` (same-site, cookies first-party `.b2tech.io`) →
Meta CAPI + GA4 MP + Google Ads com dedup por `event_id`; eventos no D1 + espelho `lp_events`
no Supabase para o dashboard; segredos em `lp_tracking_secrets` (RLS service-role) preenchidos
por API write-only no editor. **STRIDE** da superfície pública:
[`docs/security/threats/landing-page-tracking.md`](../security/threats/landing-page-tracking.md).

### 7.1 Contrato público (content-spec)

`tracking.server?: { endpoint: string; lp_id: string }` — ambos PÚBLICOS. `endpoint` é a base
do Worker (`https://track.b2tech.io`); `lp_id` é o UUID da LP. Ausente ⇒ Fase 1 pura (sem POST
server-side). Semeado no publish a partir da row da LP.

### 7.2 Payload `POST {endpoint}/e` (browser → Worker, `keepalive`, `credentials:include`)

```jsonc
{
  "lp_id": "<uuid>",            // resolve o tenant; valida ^[0-9a-f-]{36}$
  "event_name": "InitiateCheckout",  // allowlist (ver §4)
  "event_id": "<uuid>",        // MESMO id do Pixel → dedup Pixel↔CAPI
  "event_source_url": "https://...",
  "value": 197, "currency": "BRL",
  "fbp": "...", "fbc": "...", "fbclid": "...", "gclid": "...",
  "ga_client_id": "...", "utms": { "utm_source": "..." }
}
```

Resposta: `{ ok: true, event_id }` (e `Set-Cookie _fbp/_fbc`). **Nunca** devolve segredo nem
dado de outro tenant. A Fase 1 **não** envia PII (e-mail/telefone) — só os sinais acima; PII
hasheada server-side é um caminho futuro de formulários on-LP.

### 7.3 Resolução de tenant no Worker

Por `lp_id`, o Worker faz SELECT em `lp_tracking_secrets` (cache curto + negative cache) e
faz fan-out `Promise.all`: Meta CAPI por pixel (mesmo `event_id`), GA4 MP por measurement id,
Google Ads quando houver `gclid` + bundle. Grava saúde no D1 e espelha resumo (sem PII) em
`lp_events`. Service key do Supabase é **secret do Worker** (`wrangler secret put`).

### 7.4 Depósitos de dados (Supabase)

- `lp_tracking_secrets` (RLS deny-by-default; grants revogados): `landing_page_id`, `provider`
  (`meta|ga4|google_ads`), `public_id`, `secret jsonb`, `test_event_code`. Serializer **nunca** lê.
- `lp_events` (RLS deny-by-default): espelho sem PII crua — `event_id` único, `landing_page_id`,
  `event_name`, `event_time`, UTMs, `country`, `value/currency`, status por destino, flags
  `has_email/has_phone`. Lido pelo dashboard via service_role.

### 7.5 APIs do editor (atrás do gate de sessão)

- `PUT /api/landing-pages/:id/tracking-secrets` — **write-only**: grava/atualiza segredos;
  responde só `{ ok }`. `GET …/tracking-secrets/status` → `{ configured }` por provider/id
  (no máximo 4 dígitos mascarados). Nunca devolve o token.
- `GET /api/landing-pages/:id/tracking-health` — lê `lp_events`: volume, EMQ-proxy
  (`has_email/has_phone`), status CAPI/GA4/Ads, cobertura UTM.

### 7.6 Critérios de aceite (Fase 2)

1. `lp_tracking_secrets`/`lp_events` criadas com RLS deny-by-default + grants revogados; o
   serializer não as toca; o schema valida `provider` por CHECK.
2. Worker: `POST /e` com 2 pixels resolve os 2 tokens e dispara 2 CAPIs com o **mesmo**
   `event_id` do browser (Meta deduplica em Test Events). Body inválido → 400 sem efeito.
3. `PUT …/tracking-secrets` grava em `lp_tracking_secrets`; o GET de status **nunca** devolve o
   valor; `operation_logs` registra a operação sem o segredo.
4. Template: com `tracking.server` presente e consent dado, cada evento faz **um** POST
   `keepalive` ao Worker carregando o `event_id` que também foi para o Pixel.
5. Dashboard: painel de saúde lê `lp_events` e mostra volume + status por destino.
6. **Nenhum segredo** aparece em content-spec, repo, manifesto, log ou resposta de API.

> **STRIDE — Fase 1 (superfície atual).** A única entrada nova é o conjunto de IDs editáveis.
> *Tampering/Information disclosure*: mitigados pelo schema `.strict()` + regex (sem `<`/`"`),
> pela separação público×segredo (serializer ignora segredos) e por nenhum segredo trafegar.
> *DoS*: cap de 10 IDs/tipo + rate-limit existente do endpoint de settings. *Repudiation*: o
> `operation_logs` do editor cobre. Sem elevação de privilégio nova.
