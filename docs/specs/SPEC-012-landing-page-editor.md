# SPEC-012 — Landing pages editáveis em tempo real (Ultron + operador)

| Campo | Valor |
|---|---|
| Status | Draft → Implementing |
| Data | 2026-06-03 |
| Autor | brunobracaioli (via Claude Code) |
| ADR | [0015](../adr/0015-editable-landing-pages-supabase-draft.md), [0016](../adr/0016-products-table-read-model.md), [0017](../adr/0017-shared-lp-render-package.md) |
| Relacionado | [SPEC-011](SPEC-011-landing-page-generation.md) (geração), [ADR 0012](../adr/0012-landing-pages-on-cloudflare-pages.md) (hosting), [ADR 0013](../adr/0013-landing-page-design-system.md) (design), [ADR 0009](../adr/0009-on-demand-agent-jobs-queue.md) (fila) |
| Pacote | `packages/lp-render/` |
| Migrations | `supabase/migrations/20260603000001..04_*.sql` |

## 1. Objetivo

Transformar a geração one-shot de landing pages (SPEC-011, conteúdo imutável após o
deploy) num **CMS de landing pages editável ao vivo**, onde:

- O conteúdo de cada LP vive no **Supabase como blocos editáveis** (`landing_page_sections`,
  uma linha por bloco) e é a **fonte de verdade do rascunho**.
- O **operador** edita manualmente cada bloco/campo num **editor WYSIWYG** no dashboard
  (texto, fonte, tamanho, cor, imagem), com preview real em iframe (mobile/desktop).
- O **Ultron** edita por **voz**, perguntando qual seção/campo/modificação quando faltar
  parâmetro e **confirmando antes de aplicar**.
- A criação inicia pelo Ultron (pergunta cliente + produto) e direciona o operador para
  `/dashboard/clients/<slug>/<produto>/landing-page/<id>`; os agents do Fly escrevem as
  seções no Supabase **ao vivo** e o dashboard mostra os blocos nascendo (polling).
- O **deploy final continua no Cloudflare Pages**, disparado **explicitamente** (botão
  "Publicar" + comando de voz); publicar serializa o snapshot atual → arquivos →
  `next build` → `wrangler deploy`, exatamente como hoje.

Hierarquia: **cliente → produto → landing page** (N produtos/cliente, N LPs/produto).

## 2. Modelo de duas superfícies

| Superfície | Onde | Fonte | Atualização |
|---|---|---|---|
| **Rascunho** | dashboard (`/lp-preview/[id]` em iframe) | Supabase (`landing_page_sections` + `theme` + `settings`) | instantânea (operador/Ultron) |
| **Publicado** | `<subdomain>.b2tech.io` | snapshot estático no Cloudflare Pages | só no **Publicar** |

Edições **baratas** (texto/tokens) o Vercel aplica direto no Supabase (síncrono). Só
**build+deploy** (caro) vira job no runner Fly. Ver ADR 0015.

## 3. ContentDoc (representação canônica)

Montado do Supabase, mapeia 1:1 para os artefatos do build. Tipos em
`packages/lp-render/src/content-doc.ts`:

```ts
ContentDoc = {
  settings: { subdomain, name, product, site_url, seo{title,description,ogAlt},
              tracking{fb_pixel_id,ga4_id,consent_key}, checkout_url, waitlist_url?,
              price_cents, cart_state, noindex, deadline?, cartClosed{...} },
  theme:    { fonts?{title?,body?}, scale?, colors?{orange?,navy900?,...} },
  sections: SectionDoc[]   // { type, position, enabled, fields }  — fields = shape de Messages
}
```

- **Serializer** (`contentDocToFiles`, puro, `packages/lp-render/src/serialize.ts`):
  `ContentDoc → { messages: Messages, contentSpec: ContentSpec, themeCss: string }`.
  - `hero/offer/faq/finalCta/footer` → topo de `messages`; demais → `messages.sections.*`.
  - `faq` reconstrói o array a partir do bloco `faq.fields.items`.
  - `contentSpec.sections` = tipos **enabled** ordenados por `position`.
  - `themeCss` = overrides `:root{--orange:…; --font-title:…}` + regra de `font-size` (scale).
- **Rendering** compartilhado: as seções do template viram um pacote
  (`@b2tech/lp-render`) consumido pelo template (export estático) **e** pelo web (preview
  em iframe) via `ContentProvider`. Ver ADR 0017.

## 4. Dados (migrations 20260603000001..04)

- `products(id, client_id→clients, slug, name, brief_path, brief jsonb, default_subdomain,
  status, …, unique(client_id,slug))` — read-model da hierarquia (ADR 0016).
- `landing_page_sections(id, landing_page_id→landing_pages, type, position, enabled,
  fields jsonb, version, updated_by, …, unique(landing_page_id,type))` — blocos editáveis.
- `landing_pages` ganha `product_id`, `theme jsonb`, `settings jsonb`, `draft_status`
  (`empty|generating|ready|editing|publishing`), `published_at`, `published_snapshot jsonb`.
  `status`/`noindex`/`ssl_status` (de SPEC-011) seguem descrevendo o **deploy** no Cloudflare.
- `agent_jobs` ganha kinds `landing_publish`/`landing_edit` + `landing_page_id`; dedup
  per-LP (`agent_jobs_one_active_per_lp_kind`) para permitir N LPs/cliente em paralelo.

## 5. Contratos — API (web, Hono em `app/api/[[...route]]/route.ts`)

Todas atrás do gate de sessão (`middleware.ts`); validam que a LP pertence ao `slug` da rota.

| Método | Rota | Efeito |
|---|---|---|
| `GET` | `/api/landing-pages/:id` | ContentDoc atual (preview + polling) |
| `PATCH` | `/api/landing-pages/:id/sections/:type` | atualiza `fields` (Zod por tipo + `version` otimista) |
| `PATCH` | `/api/landing-pages/:id/theme` | atualiza tokens de design |
| `PATCH` | `/api/landing-pages/:id/settings` | atualiza settings de página |
| `POST` | `/api/landing-pages/:id/assets` | upload p/ Storage `landing-assets` |
| `POST` | `/api/landing-pages/:id/publish` | enfileira job `landing_publish` |

## 6. Contratos — tools do Ultron (`web/lib/ultron/tools.ts`)

Mesmo padrão das tools existentes: allowlist server-side, 2-turnos (`confirm`),
`needs_input` quando faltar parâmetro.

- `list_landing_pages(client_slug, product_slug?)`
- `get_landing_page(landing_page_id)` → seções (type/position) + chaves de campo + valores
  truncados + theme + settings (os "endereços" que o Ultron mira).
- `request_landing_page_edit(landing_page_id, section_type, field_path, new_value, confirm)`
  → edição barata: **aplica direto no Supabase** após confirmação (whitelist de campo por
  tipo + caps + sanitização). Sem job no Fly.
- `request_landing_page_theme(landing_page_id, token, value, confirm)`
- `request_landing_page_publish(landing_page_id, confirm, noindex?)` → enfileira `landing_publish`.

## 6.1 Publicação — job `landing_publish` (Wave 2)

Skill headless `publish-landing-page-brunobracaioli` (`.claude/skills/`), disparada pela
fila `agent_jobs` (kind `landing_publish`, dedup per-LP) no runner Fly:

1. Lê o rascunho do Supabase **via REST/curl + `SUPABASE_SECRET_KEY`** (o MCP do Supabase é
   OAuth-gated → não autentica headless): `landing_pages.settings` + `.theme` +
   `landing_page_sections` (ordenadas por `position`).
2. Monta o **ContentDoc** (jq) e roda o serializer puro `packages/lp-render/serialize-cli.ts`
   via **`tsx`** (`node --import tsx`; `node` puro não resolve os imports `.ts` extensionless
   do pacote) → escreve `messages/pt.json` + `content-spec.json` + `app/theme.css` no clone.
3. Scaffold do `_template` se ausente; importa `theme.css` **só no layout do clone** (o
   `_template` segue sem importar, preservando a identidade byte-a-byte do build).
4. `next build` (static export, `NEXT_PUBLIC_NOINDEX` do `settings.noindex`/arg) → reusa o
   **Passo 9** de `create-landing-page` (wrangler deploy, bind de domínio, CNAME, SSL).
5. Persiste (REST PATCH): `status='deployed'`, `draft_status='ready'`, `published_at`,
   `published_snapshot=<ContentDoc>`, `last_deploy_id`, `ssl_status` + 1 `operation_logs`.

Diferença de guarda vs. geração: a LP é carregada por id/subdomínio → **é dona** do
subdomínio → republish é autorizado (sem guarda anti-clobber). Enfileiramento (API
`POST /api/landing-pages/:id/publish` e tool `request_landing_page_publish`) entra nas
Waves 4/5; a skill + serializer (esta wave) já publicam dado um ContentDoc no Supabase.

## 7. Edge cases

- **Concorrência operador × Ultron**: `version` otimista por seção; conflito → refetch +
  re-aplica (last-write-wins consciente). Broadcast (`BroadcastChannel`) + polling refletem
  a edição do outro lado.
- **Edição durante `generating`**: editor mostra blocos aparecendo; campos ficam read-only
  até `draft_status='ready'`.
- **Publish concorrente**: índice único per-LP rejeita 2º `landing_publish` → UI/Ultron
  respondem "já tem publish em andamento".
- **Go-live**: `noindex` é build-time (SPEC-011); alternar exige **republicar**.
- **href hostil** (footer/links): aceitar só `http(s)`; nunca `javascript:`.
- **Campo desconhecido**: PATCH/edit rejeitam chaves fora da whitelist do tipo.

## 8. Critérios de aceite

1. `contentDocToFiles` reproduz `messages`/`content-spec` corretos (teste round-trip — ✅ Wave 0).
2. Rebuild do `cca` pelo template refatorado gera `out/` equivalente ao baseline (Wave 1).
3. Criar LP popula `products`+`landing_pages`+`landing_page_sections` e enfileira o publish
   (Wave 3 — ✅; round-trip rows→serializer validado).
4. Editor: editar um campo salva e reflete no iframe; toggle mobile/desktop (Wave 4 — ✅).
5. Ultron: "modifique o headline da hero da LP X" pergunta o que faltar, confirma, aplica;
   "publica a LP X" enfileira `landing_publish` (Wave 5).
6. Publicar atualiza `<subdomain>.b2tech.io` e grava `published_snapshot` (Wave 2/5).
7. Segurança: rotas com sessão, Zod em toda fronteira, RLS, rate limits, threat model (Wave 6).

## 9. Waves

0. Fundações (spec, ADRs, migrations, serializer) — ✅ **este documento**.
1. Pacote `@b2tech/lp-render` + refactor do template (sem regressão) — ✅.
2. Pipeline de publicação (snapshot → build → Cloudflare) — ✅.
3. Geração escreve no Supabase ao vivo — ✅.
4. Editor WYSIWYG no dashboard — ✅.
5. Edição por voz (Ultron).
6. Hardening (segurança, RLS, testes, docs).

### 9.1 Geração — `create-landing-page-*` reescrita (Wave 3)

A skill de geração deixou de escrever arquivos/buildar/deployar. Agora popula o **rascunho no
Supabase** e enfileira o publish (REST/curl + `SUPABASE_SECRET_KEY`; o MCP é OAuth-gated headless):

1. **Upsert `products`** (`on_conflict=client_id,slug`) + **`landing_pages`**
   (`on_conflict=subdomain`, `draft_status='generating'`, `theme` do `brief.brand`, `settings`
   parcial, `product_id`).
2. **architect → INSERT `landing_page_sections`** (uma por seção, `position=order-1`,
   `enabled=true`; payload **sem** `fields` → INSERT usa default `'{}'`, conflito preserva a copy).
3. **copywriter → PATCH `fields` por `type`** (mapeamento inverso do serializer:
   `hero/offer/finalCta/footer` direto, `faq`→`{items}`, middle→`sections.<type>`) + **PATCH
   `settings` completo** (incl. `seo`, `cartClosed`).
4. Gera imagens em `LP_DIR/public` + scaffold do `_template` (o job publish, na mesma máquina,
   reusa e pula `npm ci`).
5. `draft_status='ready'` → **enfileira `landing_publish`** (`agent_jobs`, dedup per-LP) + 1
   `operation_logs` (`action='create'`). O build/deploy é do job `landing_publish` (§6.1).

### 9.2 Editor WYSIWYG no dashboard (Wave 4)

O `web/` passou a consumir `@b2tech/lp-render` (`file:` dep + `transpilePackages` — ADR 0017)
e ganhou fontes self-hosted (`@fontsource/inter`,`/dm-sans`) para a fidelidade do preview.

- **Isolamento de superfície (two root layouts).** O `app/` foi reorganizado em route groups:
  `app/(app)/*` (dashboard/login, layout escuro + Tailwind) e `app/(preview)/*` (layout próprio
  que importa **só** o design system da LP). Sem isso, a `globals.css` do dashboard (preflight
  Tailwind + fundo escuro) vazaria no preview. O LP é **CSS puro** (sem Tailwind), então o
  preview é autocontido com 1 import de `@b2tech/lp-render/globals.css`.
- **Preview (`/lp-preview/[id]`).** Server component lê o ContentDoc (`getLandingPageFull`) e
  passa pra um client island (`preview-client.tsx`) que monta
  `<ContentProvider value={contentDocToFiles(doc)}><PageBody/></ContentProvider>` + injeta o
  `themeCss` num `<style>` e escuta `postMessage` same-origin (`lp-preview:doc`/`scrollTo`) →
  edição reflete **instantânea** sem reload. Renderiza **hidratado** (necessário: `.fade-in`
  é `opacity:0` até o JS revelar). `middleware.ts`: `/lp-preview/*` é gateado por sessão **e**
  recebe `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` (todo o resto segue `'none'`/
  `DENY`) pro editor embutir em `<iframe src>`.
- **Editor (`.../[product]/landing-page/[id]`).** Client component segura o ContentDoc em
  estado; o painel esquerdo edita seção/tema/config, o `<iframe>` à direita (toggle 390px/100%)
  mostra ao vivo. Edição = update local + `postMessage` ao iframe (instantâneo) + PATCH
  debounced (600ms). Editor de campos **genérico/recursivo** (`field-editor.tsx`) introspecta o
  `fields` JSON (string/number/bool/array de string/array de objeto/objeto aninhado) — cobre os
  17 shapes sem hardcode. Concorrência otimista por `version`: 409 → reconcilia com o servidor.
  Durante `generating`/`publishing` o editor fica read-only e faz polling 2,5s pra mostrar os
  blocos nascendo. Botão **Publicar** (+ checkbox go-live/noindex) → `POST .../publish`.
- **APIs (Hono, `lib/api/landing-pages.ts`, montado no route handler):** `GET /:id`,
  `PATCH /:id/sections/:type` (version otimista + guarda draft-busy 423), `PATCH /:id/theme`,
  `PATCH /:id/settings` (merge), `POST /:id/publish` (enfileira `landing_publish`, dedup per-LP),
  `POST /:id/assets` (Storage `landing-assets`). Validação (`lib/landing/validate.ts`): tema com
  cor hex + fonte de allowlist + escala 0.8–1.3 (impede injeção de `</style>` no themeCss);
  settings parcial com URL http(s); fields com limites estruturais + `href` só http(s)/relativo
  (bloqueia `javascript:`). Rate limits `landingEdit`/`landingPublish`. Tipos do DB regenerados
  (`lib/db/types.ts`).
