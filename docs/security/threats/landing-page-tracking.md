# Threat Model (STRIDE) — Tracking server-side de Landing Pages (Fase 2)

> Spec: [SPEC-015](../../specs/SPEC-015-landing-page-tracking.md).
> ADR: [0021](../../adr/0021-server-side-tracking-cloudflare.md).
> Complementa o threat model do [editor de landing pages](landing-page-editor.md)
> (mesma sessão/gate/CSP para a parte de dashboard) e do [flyio-runner](flyio-runner.md).
> Atualizar sempre que a superfície mudar.

## Contexto

A Fase 1 (multi-tag client-side) **não** acrescentou superfície de servidor — só IDs públicos
editáveis (coberto na nota STRIDE da SPEC-015 §7). A **Fase 2** acrescenta um **tagging server**
no Cloudflare e dois novos depósitos de dados no Supabase. Este documento modela essa superfície.

## Superfície de ataque (acréscimo da Fase 2)

1. **Endpoint público de coleta** — `POST https://track.b2tech.io/e` (Cloudflare Worker
   multi-tenant). É a **única** superfície verdadeiramente pública e não autenticada do sistema:
   qualquer um na internet pode mandar um POST. Recebe `lp_id` (UUID público) + um evento.
2. **Cookies first-party** `_fbp`/`_fbc` setados pelo Worker com `Domain=.b2tech.io`.
3. **`lp_tracking_secrets`** (Supabase) — guarda **segredos** de conversão (Meta CAPI token,
   GA4 API secret, bundle do Google Ads). Lido **só** pelo Worker (service key) e escrito **só**
   pela API write-only do editor. RLS deny-by-default + grants revogados de anon/authenticated.
4. **`lp_events`** (Supabase) — espelho/resumo dos eventos (sem PII crua) para o dashboard.
5. **API write-only de segredos** — `PUT /api/landing-pages/:id/tracking-secrets` (atrás do gate
   de sessão), que **nunca** devolve o valor do segredo, só "configurado: sim/não".
6. **API de saúde** — `GET /api/landing-pages/:id/tracking-health` (atrás do gate), lê `lp_events`.

## STRIDE

### S — Spoofing
- **Ameaça:** terceiro forja eventos batendo direto em `/e` com um `lp_id` qualquer (o `lp_id`
  é público, vai no HTML). Inflaria conversões, poluiria o EMQ, gastaria budget de CAPI.
  **Mitigações:** CORS restrito a `*.b2tech.io` (origin allowlist) + checagem de `Origin`/`Referer`;
  rate-limit por IP no Worker; nenhum segredo é exposto (o atacante não consegue assinar nada);
  os destinos (Meta/GA4) têm seus próprios filtros anti-fraude. **Resíduo aceito:** como qualquer
  endpoint de tracking web, um atacante determinado consegue mandar ruído — mitigado, não eliminado;
  a conversão *de receita* real é confirmada pela plataforma de checkout, não por este sinal.
- **Ameaça:** forjar a escrita de segredos. **Mitigação:** `PUT …/tracking-secrets` está atrás do
  mesmo gate de sessão (senha única + cookie JWT) das demais rotas do editor.

### T — Tampering
- **Ameaça:** payload do POST com tipos errados / campos hostis / `lp_id` malformado.
  **Mitigação:** o Worker valida o corpo (shape estrito, `lp_id` tem que casar `^[0-9a-f-]{36}$`,
  `event_name` numa allowlist, tamanhos limitados); descarta o resto. Nada do payload é
  interpolado em SQL (binds parametrizados no D1 e no PostgREST).
- **Ameaça:** segredo adulterado em trânsito. **Mitigação:** TLS fim-a-fim (Cloudflare Full);
  segredos viajam só do editor (HTTPS) para o Supabase e do Worker (service key) para o Supabase.

### R — Repudiation
- **Ameaça:** não saber quem cadastrou/alterou um segredo. **Mitigação:** `PUT …/tracking-secrets`
  grava em `operation_logs` (mesma trilha append-only do editor) — **sem** o valor do segredo,
  só "secret X de tipo Y configurado para lp Z". Eventos ficam em `lp_events` com `created_at`.

### I — Information disclosure (o risco central desta feature)
- **Ameaça:** vazar segredo de conversão. **Mitigações (defesa em profundidade):**
  - Segredos **nunca** entram em `settings.tracking`/`content-spec.json` (que é público): o
    write-boundary do editor (`validate.ts`, `.strict()`) **rejeita** qualquer chave de segredo;
    o serializer **nunca** seleciona `lp_tracking_secrets`.
  - `lp_tracking_secrets`: RLS deny-by-default, grants revogados de anon/authenticated (só
    service_role lê) — mesma postura das tabelas do editor.
  - A API de segredos é **write-only**: o GET de status devolve só `configured: boolean`
    (e, no máximo, os 4 últimos dígitos mascarados), **nunca** o token.
  - O Worker lê o segredo, usa, e **não** o persiste no D1 nem no espelho `lp_events`.
- **Ameaça:** vazar PII (e-mail/telefone) dos visitantes. **Mitigação:** PII é hasheada
  (SHA-256, normalizada) **antes** de sair do Worker para a Meta; **nunca** é persistida crua —
  nem no D1, nem em `lp_events` (só flags `has_email`/`has_phone`). Sem PII em logs.
- **Ameaça:** IP/UA reais expostos. **Mitigação:** ficam no D1 (sem PII pessoal direta) para
  EMQ/diagnóstico; o espelho `lp_events` guarda só `country` + flags, não o IP cru.

### D — Denial of service
- **Ameaça:** flood no `/e` esgota CPU do Worker, quota de D1/Supabase, ou budget de CAPI.
  **Mitigações:** rate-limit por IP no Worker; `ctx.waitUntil` não segura a resposta;
  corpo com tamanho máximo; o cache curto de segredos por `lp_id` evita um SELECT por request;
  Cloudflare absorve volume na borda. **Resíduo:** um flood massivo ainda custaria invocações —
  aceitável no tier atual; escalar para Turnstile/WAF se virar problema.
- **Ameaça:** `lp_id` inexistente dispara SELECT a cada hit. **Mitigação:** resultado "sem
  segredos" também é cacheado (negative cache) por um TTL curto.

### E — Elevation of privilege
- **Ameaça:** usar o endpoint público para ler segredos de outro tenant. **Mitigação:** o Worker
  **só escreve** (fan-out) e **nunca devolve** segredo nem dado de outro `lp_id` na resposta
  (a resposta é só `{ ok, event_id }`). A service key do Worker é um **secret do Worker**
  (`wrangler secret put`), nunca no repo/bundle.
- **Ameaça:** SSRF/console — não aplicável (destinos são URLs fixas de Meta/Google).

## Itens de implementação derivados deste modelo

- [ ] CORS allowlist `*.b2tech.io` + checagem de `Origin` no Worker.
- [ ] Rate-limit por IP no Worker (+ negative cache de `lp_id` sem segredos).
- [ ] Validação estrita do corpo do `/e` (UUID, allowlist de `event_name`, limites de tamanho).
- [ ] `lp_tracking_secrets`: RLS deny-by-default + `revoke all … from anon, authenticated`.
- [ ] API de segredos write-only (GET status nunca devolve valor) + `operation_logs`.
- [ ] PII só hasheada; D1/`lp_events` sem PII crua; sem PII em logs.
- [ ] Service key do Worker via `wrangler secret put` — nunca no repo, manifesto ou stdout.
