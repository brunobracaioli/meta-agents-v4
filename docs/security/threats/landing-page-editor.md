# Threat Model (STRIDE) — Editor de Landing Pages

> Spec: [docs/specs/SPEC-012-landing-page-editor.md](../../specs/SPEC-012-landing-page-editor.md).
> ADRs: [0015](../../adr/0015-editable-landing-pages-supabase-draft.md),
> [0016](../../adr/0016-products-table-read-model.md),
> [0017](../../adr/0017-shared-lp-render-package.md).
> Complementa o threat model do [web-dashboard](web-dashboard.md) (mesma sessão/gate/CSP).
> Atualizar quando a superfície mudar.

## Superfície de ataque (acréscimo da SPEC-012)

O rascunho de cada landing page passa a ser **editável ao vivo** e vira a fonte de verdade no
Supabase (`landing_page_sections.fields` + `landing_pages.theme`/`.settings`). Superfícies novas:

- **APIs de edição** (Hono, `web/lib/api/landing-pages.ts`, atrás do gate de sessão):
  `GET /api/landing-pages/:id`, `PATCH …/sections/:type`, `PATCH …/theme`, `PATCH …/settings`,
  `POST …/publish`, `POST …/assets`.
- **Tools de voz do Ultron** (`web/lib/ultron/tools.ts`): `list_landing_pages`,
  `get_landing_page`, `request_landing_page_edit`, `request_landing_page_theme`,
  `request_landing_page_publish` — escrevem **direto no Supabase** (edição barata) ou
  **enfileiram** `landing_publish` (build+deploy caro no runner Fly).
- **Conteúdo não confiável renderizado**: `fields` editados são injetados no preview (iframe
  same-origin) e, no publish, **serializados → `next build` → Cloudflare Pages** (site público).
  Cada valor é input não confiável atravessando duas superfícies de render.
- **Upload de assets** para o bucket público `landing-assets` (Storage).
- **`theme`** vira um stylesheet `:root{--token: value}` (vetor de injeção de CSS).
- **Elevação via enqueue**: publish dispara build/deploy (custo + muda site público/`noindex`).

## STRIDE

### S — Spoofing
- **Ameaça:** editar/publicar sem ser o operador. **Mitigação:** mesmo gate da sessão
  (`middleware.ts`): senha única + cookie JWT assinado (httpOnly/Secure/SameSite=Lax); todas as
  rotas `/api/landing-pages/*` e `/dashboard/*` exigem sessão. O preview `/lp-preview/*` também
  é gateado por sessão (só ganha `frame-ancestors 'self'` p/ o iframe do editor).

### T — Tampering
- **Ameaça:** `fields` com chave hostil/desconhecida ou tipo errado (ex.: `comparison.rows`
  com célula objeto, campo que o render não lê mas é persistido). **Mitigação:** **whitelist
  por tipo** (`web/lib/landing/section-schemas.ts`): Zod `.strict()` por SectionType (chaves
  conhecidas + tipos corretos + `CompareCell` união), rodando **após** o guard estrutural
  (`validateSectionFields`: profundidade ≤ 6, string ≤ 8000, array ≤ 200, nós ≤ 3000). O mesmo
  `validateSection(type, fields)` protege a API **e** as tools do Ultron.
- **Ameaça:** `href` hostil (`javascript:`/`data:`/`vbscript:`) em link de footer → XSS no site
  publicado. **Mitigação:** `isSafeHref` aceita só `http(s)`/`/`/`#`/`mailto:`/`tel:`; aplicada
  tanto no schema do footer quanto no guard estrutural (qualquer chave `href`).
- **Ameaça:** injeção de CSS/HTML via `theme` (ex.: `#fff;}</style><script>` numa cor). **Mitigação:**
  `themeSchema` exige cor **hex** (`/^#[0-9a-fA-F]{3,8}$/`), fonte de **allowlist** curada, e
  escala numérica 0.8–1.3 — impossível conter `</style>`. `settings` editáveis são subconjunto
  (subdomain/site_url/tracking **não** editáveis); URLs só `http(s)`.
- **Ameaça:** XSS por texto de copy. **Mitigação:** React escapa texto no render; **sem**
  `dangerouslySetInnerHTML` em nenhuma seção (`@b2tech/lp-render`).
- **Ameaça:** SQL injection nas APIs/tools. **Mitigação:** queries parametrizadas (supabase-js);
  sem concatenação de string.
- **Ameaça:** SVG hostil no bucket público (pode embutir `<script>`, executável se aberto direto
  na origin do Storage). **Mitigação:** `landing-assets` aceita só raster (`image/jpeg|png|webp|avif`);
  SVG removido do allowlist; tamanho ≤ 5MB; nome de arquivo gerado server-side.

### R — Repudiation
- **Ameaça:** edição/publish sem rastro. **Mitigação:** `operation_logs(entity_type='landing_page',
  action='update', actor)` para as ações **consequentes/autônomas**: toda edição de texto/tema
  do **Ultron** (actor=`ultron`) e todo **publish** (API actor=`operator`, Ultron actor=`ultron`).
  Publish também cria uma linha em `agent_jobs` (quem/quando/status/erro). Edições interativas do
  operador na UI (PATCH debounced enquanto digita) **não** geram log por-tecla, de propósito:
  são síncronas, autenticadas, presentes, reversíveis e refletidas ao vivo — a ação consequente
  (publish) é que fica logada. Logs estruturados (JSON) sem PII.

### I — Information disclosure
- **Ameaça:** ler/editar LP de outro cliente/produto por id. **Mitigação:** a página do editor
  usa `getLandingPageFullForRoute(slug, product, id)` — valida que a LP pertence ao cliente+produto
  da rota antes de servir (id de outro escopo → not-found). Defesa em profundidade sobre o gate.
- **Ameaça:** segredo no bundle client. **Mitigação:** `SUPABASE_SECRET_KEY`/`CLOUDFLARE_*` só
  server-side; o browser só fala com a API Hono. Preview e editor são server components +
  client islands sem segredo.
- **Ameaça:** erro vaza stack/SQL. **Mitigação:** respostas genéricas (`invalid_fields`,
  `not_found`, `version_conflict`…); detalhe só no log estruturado.

### D — Denial of service / custo
- **Ameaça:** flood de edições. **Mitigação:** rate limit `landingEdit` (Upstash, 120/min por
  LP) na API e nas tools; guard estrutural de tamanho corta payload patológico (413/400).
- **Ameaça:** flood de publish drena build/deploy. **Mitigação:** rate limit `landingPublish`
  (6/h por cliente) + índice único parcial `agent_jobs_one_active_per_lp_kind` (no máx. 1
  publish/edit ativo por LP) + confirmação em 2 turnos no Ultron + poller single-flight.
- **Ameaça:** upload gigante. **Mitigação:** `MAX_ASSET_BYTES` 5MB (413), MIME allowlist (415).

### E — Elevation of privilege
- **Ameaça:** Ultron dispara deploy/gasto indevido ou skill arbitrário. **Mitigação:** publish
  **só enfileira** (não builda/deploya direto); o nome do skill vem de allowlist server-side
  (`PUBLISH_SKILL_BY_SLUG`, nunca texto livre); **confirmação obrigatória em 2 turnos**; o poller
  revalida skill (charset + existência) e restringe `args` a charset seguro. Go-live
  (`noindex=false`) é explícito e logado.
- **Ameaça:** prompt injection vinda do conteúdo da LP (ex.: copy maliciosa lida por
  `get_landing_page`) faz o modelo "agir". **Mitigação:** dados tratados como dados, nunca
  comandos; tools não executam conteúdo; o `landing_page_id` precisa casar com registro real e
  os gates (allowlist, confirmação, validação, rate limit) seguram a ação.
- **Ameaça:** acesso direto ao banco por anon/authenticated (PostgREST). **Mitigação:** RLS
  **deny-by-default** (sem policies) em `products`/`landing_page_sections`/`landing_pages` +
  **revoke** de grants de anon/authenticated (migration `20260603000005`, defesa em profundidade,
  least privilege); só `service_role` (server) acessa. Nenhuma policy permissiva por design.

## Riscos residuais aceitos
- Edições interativas do operador na UI não são auditadas por-campo (só o publish e as ações do
  Ultron). Aceito: operador autenticado, presente, ação reversível até publicar.
- Job de publish preso em `claimed` bloqueia novo publish daquela LP (mesma dívida do threat
  model base: falta reaper de jobs órfãos; mitigado pelo trap EXIT do poller → `failed`).

## Checklist antes do deploy
- [ ] Toda rota `/api/landing-pages/*` atrás da sessão; preview `/lp-preview/*` gateado
- [ ] `validateSection(type, fields)` (estrutural + whitelist por tipo) em PATCH de seção **e** edit do Ultron
- [ ] `themeSchema` (hex/allowlist/escala) e `settingsPatchSchema` (URL http(s), subconjunto) aplicados
- [ ] `href` só `http(s)`/relativo/anchor/mailto/tel; sem `dangerouslySetInnerHTML`
- [ ] Bucket `landing-assets`: raster-only, ≤ 5MB, nome server-side
- [ ] Rate limits `landingEdit`/`landingPublish` ativos; dedup per-LP no `agent_jobs`
- [ ] `operation_logs` em publish (ambos) e edições do Ultron; logs sem PII
- [ ] RLS on deny-by-default + revoke anon/authenticated (migration 0005 aplicada)
- [ ] Ownership por rota (`getLandingPageFullForRoute`) no editor
- [ ] Nenhum segredo server-side no bundle (`grep -r sb_secret\|CLOUDFLARE web/.next`)
