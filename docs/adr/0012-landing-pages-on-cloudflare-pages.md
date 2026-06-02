# ADR 0012 — Landing pages estáticas (Next.js export) no Cloudflare Pages sob `b2tech.io`

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-02 |
| Decidido por | brunobracaioli |
| Migrations | `add_landing_pages` (`20260530000008`), `agent_jobs_add_landing_kind` (`20260530000009`, Fase 2) |
| Spec | [docs/specs/SPEC-011-landing-page-generation.md](../specs/SPEC-011-landing-page-generation.md) |
| Relacionado | [ADR 0002](0002-supabase-meta-ads-persistence-schema.md) (convenções de persistência), [ADR 0003](0003-public-ad-ingest-bucket.md) (assets), [ADR 0009](0009-on-demand-agent-jobs-queue.md) (fila Ultron→Fly), [ADR 0005](0005-web-dashboard-on-vercel-monorepo.md) (Vercel) |

## Context

A agência hoje cria/ativa campanhas Meta Ads de forma headless (`claude -p "/skill"`),
disparadas pelo Ultron via fila `agent_jobs` → runner Fly. Falta o capability simétrico:
**produzir landing pages profissionais de alta conversão e publicá-las** sob subdomínios
de `b2tech.io`, fracionando o processo (estrutura → copy → visual → tracking consent-gated →
deploy), também disparável de forma autônoma e pelo Ultron.

Restrições que moldam a decisão:

- **`b2tech.io` é uma zona na mesma conta Cloudflare** onde os projetos Pages serão criados.
  O token (`CLOUDFLARE_API_TOKEN`) tem escopo **Pages + Zone DNS Edit** (validado 2026-06-02);
  **Workers não está no escopo**.
- ⚠️ Validado na prática: o *domain bind* de um Pages project **NÃO auto-cria o CNAME** (o
  domínio fica `pending`); é preciso criar o registro CNAME proxied explicitamente via
  `dns_records` — o que funciona porque o token tem Zone DNS Edit.
- A LP é **conteúdo estático** (hero, copy, oferta, FAQ, checkout externo Hubla). Não precisa
  de runtime de servidor.
- O app de dashboard já vive na Vercel (ADR 0005); não queremos acoplar LPs efêmeras de
  cliente ao mesmo projeto/infra.
- Tracking (FB Pixel + GA4) precisa respeitar LGPD — disparar **somente após consentimento**.

## Decision

**Gerar cada landing page como um projeto Next.js 15 com `output: 'export'` (estático puro,
`out/` flat) e fazer deploy no Cloudflare Pages, um projeto por LP (`b2tech-<nome>`), com o
custom domain `<nome>.b2tech.io`.** O template canônico vive em `landing-pages/_template/` e
é clonado para `landing-pages/<nome>/` por uma skill headless
(`create-landing-page-brunobracaioli`), espelhando o contrato de `create-traffic-…`.

Componentes:

- **Template canônico** (`landing-pages/_template/`) — Next.js 15 export, i18n pt-BR via
  `messages/pt.json`, seções compostas de um enum fixo, JSON-LD, sitemap/robots estáticos,
  OG gerado, e tracking **consent-gated** (`Tracking.tsx` só injeta Pixel `653995666521954`
  + GA4 `G-Z60CJ7W2Z8` após `localStorage["b2tech_consent_v1"]`).
- **`output: 'export'`** — sem API routes / server actions / middleware / ISR;
  `images.unoptimized: true` obrigatório (o otimizador do `next/image` exige servidor). O
  build emite `out/` flat (`index.html`, `sitemap.xml`, `robots.txt`, `_next/`, `og.png`) —
  exatamente o que `wrangler pages deploy out` espera.
- **Deploy** — `wrangler pages project create b2tech-<nome>` + `wrangler pages deploy out` +
  bind do domínio (`POST .../pages/projects/b2tech-<nome>/domains`) + **criação explícita do
  CNAME proxied** (`POST /zones/{zone}/dns_records`, pois o bind não cria sozinho). SSL
  provisiona async (~5-15 min).
- **`NEXT_PUBLIC_NOINDEX`** (build-time) — default `1` (preview: `robots.txt` `Disallow: /`
  + `<meta noindex>`). Go-live = rebuild+redeploy com `noindex=0`. É o **único switch** de
  publicação.
- **Persistência** (`public.landing_pages`) — uma linha por LP (subdomínio como chave
  natural, content-spec/tracking em `jsonb`, status, ssl_status, noindex), + `operation_logs`
  com novo `entity_type='landing_page'`. Segue ADR 0002 (text/`*_cents`/`jsonb`/RLS).
- **Disparo via Ultron** (Fase 2) — novo `kind='landing'` em `agent_jobs`, tool
  `request_landing_page_creation` (skill resolvido server-side, confirm em 2 turnos), runner
  Fly com `wrangler` + segredos CF.

### Alternativas consideradas

- **Vercel project-por-LP** — rejeitado: acopla LPs efêmeras de cliente à infra do dashboard,
  gera sprawl de projetos Vercel, e o domínio `b2tech.io` está na Cloudflare (precisaria de
  delegação/registros extras). Cloudflare Pages dá hosting estático grátis + DNS na mesma
  conta + bind auto-CNAME.
- **Cloudflare Workers (SSR)** — rejeitado: o token **não tem escopo Workers**, e a LP não
  precisa de runtime de servidor. `output: 'export'` é suficiente e mais simples/barato.
- **Confiar no auto-CNAME do bind** — descartado após teste: o bind deixa o domínio `pending`
  e não cria o registro. A criação explícita via `dns_records` é o passo padrão (o token tem
  Zone DNS Edit). Se o escopo for perdido (10000/9109), degrada para `dns_pending`, não bloqueia.
- **HTML estático cru (sem build)** — viável para páginas experimentais/3D, mas escala pior
  para LPs ricas em conteúdo/SEO/i18n. Next export dá componentização, sitemap/OG e tipagem.

## Consequences

**Positivas**
- Deploy 100% automatizável e headless (token env + `wrangler`), simétrico ao fluxo de campanhas.
- DNS automatizável via API (token com Zone DNS Edit) — `dns_records` cria o CNAME proxied.
- Estático = barato, rápido, sem superfície de servidor; CDN/SSL da Cloudflare de graça.
- Auditável: source commitado + linha em `landing_pages` + `operation_logs` + manifest.

**Negativas / riscos**
- `output: 'export'` proíbe features de servidor — a arquitetura de seções é restrita a um
  enum estático (sem forms server-side; checkout é redirect externo Hubla; waitlist via WhatsApp).
- O runner Fly ganha peso (Node já existe, mas `wrangler` + toolchain de build da LP precisam
  entrar na imagem — mitigado por pre-bake das deps do `_template`).
- `NEXT_PUBLIC_NOINDEX` é build-time: flip exige rebuild+redeploy (não é toggle de runtime).
- O CNAME precisa ser criado explicitamente (bind não cria) — depende do escopo Zone DNS Edit
  do token; se perdido, degrada para `dns_pending`, não falha.
- Segredos CF (`CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`) passam a viver em `.env.local` (local) e
  `fly secrets` (runner); nunca commitados, nunca ecoados em manifest/logs/telemetria.
