# lp-tracking — tagging server multi-tenant (Cloudflare Worker)

Server-side tracking para TODAS as landing pages `*.b2tech.io`, sem Stape e sem um Worker por
LP. Um único Worker em **`track.b2tech.io`** (same-site) resolve os segredos de cada página por
`lp_id` e faz fan-out para **Meta CAPI ‖ GA4 MP ‖ Google Ads**, deduplicando contra o Pixel do
browser pelo `event_id` compartilhado. Adaptado da referência single-tenant em `track_feature/`.

> ADR: [docs/adr/0021](../../docs/adr/0021-server-side-tracking-cloudflare.md) ·
> Spec: [SPEC-015 §7](../../docs/specs/SPEC-015-landing-page-tracking.md) ·
> Threat model: [landing-page-tracking](../../docs/security/threats/landing-page-tracking.md)

## Arquitetura

```
LP (*.b2tech.io)  --POST /e {lp_id, event_id, ...}-->  track.b2tech.io (este Worker)
   • valida corpo (UUID lp_id, allowlist de event_name, limites) + rate-limit por IP
   • resolve segredos do tenant em lp_tracking_secrets (Supabase, service key) [cache 60s]
   • seta _fbp/_fbc first-party (Domain=.b2tech.io) — sobrevive ao ITP
   • hash SHA-256 da PII (se houver) + IP/UA/geo reais da borda
   • fan-out: Meta CAPI por pixel (mesmo event_id) ‖ GA4 MP ‖ Google Ads
   • grava no D1 (sem PII crua) + espelha resumo em lp_events (Supabase)
```

**Dedup:** o `event_id` nasce no browser, vai no Pixel (`eventID`) **e** no CAPI. A Meta
deduplica por `event_id + event_name`. Sem isso, conversão conta dobrado.

## Deploy

```bash
npm i -g wrangler && wrangler login

# 1. D1
wrangler d1 create lp-tracking          # cole o database_id no wrangler.toml
wrangler d1 execute lp-tracking --file=./schema.sql --remote

# 2. Segredos (NUNCA no repo)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY     # service_role key
wrangler secret put META_TEST_EVENT_CODE     # opcional (homologação global)
wrangler secret put DASHBOARD_TOKEN          # opcional (/dash/data de borda)

# 3. Ajuste a rota (track.b2tech.io) no wrangler.toml e:
wrangler deploy
```

No painel Cloudflare: `track.b2tech.io` **proxied** (nuvem laranja) e **SSL/TLS = Full**.

## Multi-tenancy: como os segredos são cadastrados

Por landing page, no editor (aba **Tracking → Conversões server-side**), o operador grava os
segredos via `PUT /api/landing-pages/:id/tracking-secrets` (write-only) → linhas em
`lp_tracking_secrets` (RLS service-role). O serializer **nunca** lê essa tabela — só este Worker.
IDs **públicos** (pixel/GA4/Ads) continuam em `settings.tracking` (content-spec público).

## Validação

- `GET https://track.b2tech.io/healthy` → `ok`
- Meta Events Manager → **Test Events**: setar `test_event_code` no segredo do pixel e disparar.
  Confirmar Pixel + Server **deduplicados** (não em dobro) e EMQ no Events Manager.
- `GET /dash/data?token=…&lp_id=…` → KPIs de borda (fallback do painel nativo).

## Segurança / LGPD

- **Sem PII crua** no D1/`lp_events` — só hash (que vai pro Meta) e flags `has_email/has_phone`.
- CORS restrito por **sufixo** de origin (`.b2tech.io`); rate-limit por IP.
- `SUPABASE_SERVICE_KEY` é **secret do Worker** — nunca no repo, bundle, manifesto ou log.
