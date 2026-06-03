---
name: create-landing-page-brunobracaioli
description: Cria de forma 100% autônoma e headless uma landing page profissional de alta conversão para um PRODUTO do cliente brunobracaioli (catálogo em lista-de-produtos) e faz deploy no Cloudflare Pages sob <nome>.b2tech.io — brief do produto (catálogo) → arquitetura de conversão → copy long-form pt-BR → hero/OG → build Next.js static export → deploy → persistência no Supabase e manifest. Use quando pedirem "criar landing page para brunobracaioli" (ex.: produto cca ou imersao-agencia), ou quando disparada via Ultron/headless (`claude -p --dangerously-skip-permissions ".claude/skills/create-landing-page-brunobracaioli product=cca nome=cca"`). NÃO cria campanha Meta — só landing page.
argument-hint: "product=<slug> nome=<subdominio> [ref-url=...] [cart-state=open] [noindex=1] [deploy=true] [overwrite=false]"
allowed-tools: Read, Bash, Glob, Write, Agent, Skill, mcp__supabase__execute_sql, mcp__supabase__list_tables
---

# Skill: /create-landing-page-brunobracaioli

Cria, **de ponta a ponta e sem intervenção humana**, uma landing page profissional de
alta conversão para o cliente **brunobracaioli** (produto: Claude Code Architect — CCA) e
**publica no Cloudflare Pages** sob `<nome>.b2tech.io`:
scrape da referência → arquitetura de conversão → copy long-form pt-BR → visual hero/OG →
**Next.js static export** (`out/` flat) → deploy CF Pages → persistência no Supabase → manifest.

> Esta skill é o contrato que o Ultron/runner Fly.io dispara (ADR 0009 / 0012). **Toda a
> inteligência está aqui**; o runner é uma casca fina (`timeout claude -p --dangerously-skip-permissions ...`).
> Spec: `docs/specs/SPEC-011-landing-page-generation.md`. Decisão: `docs/adr/0012-landing-pages-on-cloudflare-pages.md`.

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano, a sessão entra em deadlock. Em qualquer
   dúvida ou erro: **decida sozinho** com os defaults da §3, registre no manifest (Passo 11)
   e **siga em frente**.
2. **Resolva erros por conta própria.** Modos de falha conhecidos + correções na §7
   (Gotchas) e nos passos. Só aborte se for impossível prosseguir — e mesmo aí, **grave o
   manifest com `verified:false`** explicando o bloqueio.
3. **Cliente é fixo: `brunobracaioli`.** Não generalize.
4. **Persista tudo no Supabase via MCP.** Deploy só via `wrangler` + API CF (Bash).
5. **Limites duros / segurança:**
   - **`noindex=1` por padrão.** A página nasce em preview (não indexável). Go-live
     (`noindex=0`) só se um argumento pedir explicitamente.
   - **Segredos CF (`CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`) nunca** vão para o manifest, logs,
     `operation_logs`, stdout, ou qualquer arquivo commitado. Nunca os ecoe.
   - **Sem features de servidor** na LP (`output:'export'` — §7). Pixel/GA4 só pós-consent.
   - Prefira **reusar** scrape/copy/imagens já gerados hoje a regerar (cap de LLM).

---

## 2. Constantes do cliente + produto (catálogo)

**Cliente** — fonte de verdade: `.claude/skills/lista-de-clientes/SKILL.md`. No início, faça
lookup de `clients WHERE slug='brunobracaioli'` no Supabase para o `client_id` (uuid) —
**não hardcode**.

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Domínio | `<nome>.b2tech.io` (zona `b2tech.io` na conta CF) |
| Materiais | `.claude/materiais-das-empresas/brunobracaioli/` (logo, mascote, exemplo-de-ads, **produtos/**) |
| Marca | navy `#0A0F1A`→`#0E1422`, laranja `#FF6B1A` |
| Tracking | FB Pixel `653995666521954` + GA4 `G-Z60CJ7W2Z8` (consent-gated) |

**Produto — NÃO é mais hardcoded.** Vem do **catálogo** (skill `lista-de-produtos`, ADR 0014):
o brief estruturado fica em `${MAT}/produtos/${product}.json` e é lido via `Read` (headless-safe;
o `.claude/` é COPY-ado para a imagem Fly). O arg `product=<slug>` seleciona qual (default `cca`).

O brief traz tudo que os subagents precisam: `name`, `shortCode`, `tagline`, `positioning`,
`tone`, `offer` (priceCents, anchorPriceCents, checkoutUrl, waitlistUrl, cartState, deadline,
payments, guarantee, scarcity), e o conteúdo de copy (`dores`, `mecanismo`, `stack`, `prereqs`,
`agenda`, `entregaveis`, `persona`, `comparison`, `autoridade`, `numeros`, `faqHints`), `seo`,
`assets` (logo/foto do instrutor) e `brand`. **Nunca invente** dados de produto — use o brief.
Produtos atuais: `cca` (Claude Code Architect) e `imersao-agencia` (Imersão AgêncIA Tráfego Pago).

---

## 3. Defaults autônomos (decisões já tomadas — não reabrir)

| Decisão | Valor | Por quê |
|---|---|---|
| `product` (slug do catálogo) | `cca` (default) | Seleciona o brief `${MAT}/produtos/${product}.json`. Ex.: `cca`, `imersao-agencia`. Se o arquivo não existir → aborta (`verified:false`). |
| `nome` (subdomínio) | **obrigatório (sem default)** | Vira `<nome>.b2tech.io` + projeto CF `b2tech-<nome>`. Sem `nome` → aborta. **Nunca** assuma `cca` (é uma página de produção). Dica: o brief tem `defaultSubdomain`, mas `nome` ainda precisa ser passado explicitamente. |
| `overwrite` | `false` | Se `true`, permite redeploy por cima de um projeto CF já existente com deploy. Default `false` = recusa sobrescrever página viva. **O Ultron nunca envia `overwrite`** (voz não sobrescreve produção). |
| Stack | Next.js 15 **static export** (`out/` flat) | ADR 0012 |
| Template | `landing-pages/_template/` → `landing-pages/<nome>/` | Clonável |
| Seções | enum: hero·urgency·problem·comparison·solution·features·curriculum·stats·proof·logos·persona·authority·offer·guarantee·faq·finalCta·footer | Template (ADR 0013) |
| Design system | claro + blocos escuros, Inter/DM Sans (@fontsource), accent laranja + funcionais, motion leve | ADR 0013 |
| `cart-state` | `open` | `closed` → CTA waitlist WhatsApp |
| `noindex` | `1` (preview) | Go-live exige rebuild com `0` |
| `deploy` | `true` | `false` = só build local |
| Tom da copy | tech-hacker, pt-BR, sênior (sem clichês) | Marca |

**Validação de `nome`:** `^[a-z0-9-]{2,40}$` (vira subdomínio + nome de projeto CF). Se
inválido → manifest `verified:false` e sair.

**Args** via `$ARGUMENTS` (`key=value`): `nome` (**obrigatório**), `product` (default `cca`),
`ref-url` (opcional), `cart-state`, `noindex`, `deploy`, `overwrite`. Sem `nome` → aborta
(manifest `verified:false`). Nunca use `cca` como fallback de `nome`. `checkout-url`/`cart-state`/
`deadline` vêm do brief do produto (catálogo); um arg explícito, se passado, sobrescreve o brief.

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- Carregar env: `set -a && eval "$(tr -d '\r' < .env.local)" && set +a` (raiz; precisa de
  `OPENAI_API_KEY` para o `image-generate`; para deploy `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID`). **Persistência é via MCP do Supabase** — não precisa de chave
  Supabase no env (o MCP usa `service_role` e bypassa RLS).
- Parse dos args; aplicar defaults da §3 (`product=cca`, `overwrite=false`). **`nome` é
  obrigatório**: se ausente → manifest `verified:false` (`errors:["nome obrigatório"]`) e
  sair. Validar `nome =~ ^[a-z0-9-]{2,40}$` e `product =~ ^[a-z0-9-]{2,40}$`. **Nunca** assumir `cca` como `nome`.
- Paths: `LP_DIR=landing-pages/${nome}`, `TRY_DIR=tentativas-geracao-de-campanhas`,
  `MAT=.claude/materiais-das-empresas/brunobracaioli`. `mkdir -p ${TRY_DIR}`.
- **Carregar o brief do produto (catálogo, ADR 0014):** `Read` `${MAT}/produtos/${product}.json`
  → objeto `PRODUCT`. Se o arquivo não existir → manifest `verified:false`
  (`errors:["produto '${product}' não está no catálogo (${MAT}/produtos/)"]`) e sair. Derivar:
  `PROD_NAME=PRODUCT.name`, `SHORT=PRODUCT.shortCode`, `PRICE_CENTS=PRODUCT.offer.priceCents`,
  `CHECKOUT_URL=PRODUCT.offer.checkoutUrl`, `WAITLIST_URL=PRODUCT.offer.waitlistUrl`,
  `CART=PRODUCT.offer.cartState` (arg `cart-state` sobrescreve se passado),
  `DEADLINE=PRODUCT.offer.deadline`. O `PRODUCT` inteiro alimenta os subagents (Passos 3/4).
- **Higiene de segredo:** strip de espaços/CR no token: `CF_TOKEN=$(printf %s "$CLOUDFLARE_API_TOKEN" | tr -d '[:space:]')`.

### Passo 1 — Client lookup
- `mcp__supabase__execute_sql`: `select id, materials_path from public.clients where slug='brunobracaioli'`
  → `client_id`. Não hardcode o uuid.
- `mcp__supabase__list_tables` (uma vez) para confirmar que `landing_pages` existe (migration
  `20260530000008`). Se não existir → manifest `verified:false` com instrução de aplicar a migration, sair.

### Passo 2 — Scrape da referência (OPCIONAL, idempotente)
**Idempotência:** se `${LP_DIR}/content-spec.json` existe e é de hoje → reuse e pule para o
Passo 7 (build/deploy). Senão: o **brief do catálogo (`PRODUCT`) é a fonte primária** — não
precisa de scrape. Só rode scrape se `ref-url` for passado (para suplementar tom/visual de uma
referência externa):
- `Agent(subagent_type="scrape-extractor")` com `ref-url` → `scrape.json`. Salve em
  `${LP_DIR}/.gen/scrape.json` (criar `.gen/` com `mkdir -p`). Sem `ref-url` → `scrape=null`.

### Passo 3 — Arquitetura de conversão
- `Agent(subagent_type="landing-page-architect")` passando o **brief do produto** (catálogo).
  Mapeie `PRODUCT` para o contrato `product` (estendido) + `scrape` opcional:
  ```jsonc
  { "scrape": <scrape.json ou null>,
    "product": {
      "name": "<PROD_NAME>", "shortCode": "<SHORT>",
      "priceCents": <PRICE_CENTS>, "anchorPriceCents": <PRODUCT.offer.anchorPriceCents>,
      "checkoutUrl": "<CHECKOUT_URL>", "cartState": "<CART>", "deadline": "<DEADLINE>",
      "tagline": "<PRODUCT.tagline>", "positioning": "<PRODUCT.positioning>",
      "offerDetails": "<PRODUCT.whatItIs>",
      // campos ricos: o subagent escolhe seções conforme o que existir
      "dores": <PRODUCT.dores>, "mecanismo": <PRODUCT.mecanismo>, "stack": <PRODUCT.stack>,
      "prereqs": <PRODUCT.prereqs>, "agenda": <PRODUCT.agenda>, "entregaveis": <PRODUCT.entregaveis>,
      "persona": <PRODUCT.persona>, "comparison": <PRODUCT.comparison>,
      "autoridade": <PRODUCT.autoridade>, "numeros": <PRODUCT.numeros>,
      "scarcity": "<PRODUCT.offer.scarcity>", "guarantee": "<PRODUCT.offer.guarantee>"
    },
    "constraints": {"language": "<PRODUCT.language>", "style": "<PRODUCT.tone>", "maxSections": 17} }
  ```
  → `architecture.json` (seções, ordem, ângulos, CTA, SEO). Salve em `${LP_DIR}/.gen/`.

### Passo 4 — Copy long-form
- `Agent(subagent_type="lp-copywriter")` com `{architecture, product:<mesmo objeto do Passo 3>,
  scrape:<ou null>, tone:"<PRODUCT.tone>", language:"<PRODUCT.language>"}` → copy JSON no shape
  de `messages/pt.json` (inclui `cartClosed` e as seções novas que a `architecture` referenciou).
  Salve em `${LP_DIR}/.gen/copy.json`. **A copy deve sair do brief — não inventar dados.**

### Passo 5 — Visual hero + OG (idempotente)
**Reuse** se já existirem `${LP_DIR}/public/hero.png` e `og.png` do dia. Senão:
- `Agent(subagent_type="image-prompt-generator")` (variant A) com:
  `{scrape, brief:<PRODUCT (tagline/positioning/numeros)>, aspectRatio:"1920x1080",
  referenceImagePaths:[ ${MAT}/logo/logo.png, ${MAT}/mascote/claude-lendo.png,
  ${MAT}/exemplo-de-ads/*.png ], configHints:{brandName:"<PROD_NAME>"}}` → prompt do hero.
  (O agente já tem o preset de marca brunobracaioli e **valida os refs via Bash antes de ler** — siga o contrato dele.)
- **Foto do instrutor (seção authority):** se o brief tem `autoridade.image` (ex.: `/instrutor.jpg`),
  copie `${MAT}/logo/foto-do-infoprodutor/bruno-bracaioli.jpg` para `${LP_DIR}/public/instrutor.jpg`
  (a seção `authority` referencia `/instrutor.jpg`). Se não houver foto, o template degrada para painel só-texto.
- `Skill(skill="image-generate", args="prompt-file=<prompt> aspect=1.91:1 out-dir=${LP_DIR}/public out-name=hero")`
  → `hero.png`. Copie/derive `og.png` (1200×630) do hero (ou gere um segundo com aspect 1.91:1
  e renomeie para `og.png`). Registre o custo estimado (manifest do `image-generate`).

### Passo 6 — Scaffold do template
- Se `${LP_DIR}/package.json` não existe: `cp -r landing-pages/_template/. ${LP_DIR}/`
  (use a forma `/.` — copiar para um dir pré-existente sem o `/.` aninha o template).
  Gere as imagens (Passo 5) **após** o scaffold, ou copie o template primeiro e depois as
  imagens, para não sobrescrever `public/hero.png`/`og.png`.
- **No runner Fly**, o `_template` já tem `node_modules` pré-instalado (Dockerfile); o `cp`
  acima o leva junto → pula o install no Passo 8. Localmente o `_template` pode não ter
  `node_modules` (gitignored) — aí instala no Passo 8. Remova `out/`/`.next/` se vierem no cp.

### Passo 7 — Preencher conteúdo
- Escrever `${LP_DIR}/messages/pt.json` a partir de `copy.json` (Passo 4). O shape é o
  **expandido** (ADR 0013): além de hero/problem/solution/features/curriculum/proof/offer/
  faq/finalCta/footer, pode conter `sections.urgency/comparison/stats/logos/persona/
  authority/guarantee` e `offer.installments/payments/secure`. Inclua só as seções que a
  `architecture` (Passo 3) referenciou; o template ignora seções sem copy. Ver o
  `_template/messages/pt.json` como referência de shape.
- Escrever `${LP_DIR}/content-spec.json` — **todos os campos de produto vêm do brief `PRODUCT`**:
  ```jsonc
  { "subdomain":"<nome>", "name":"<SHORT>", "product":"<PROD_NAME>",
    "price_cents":<PRICE_CENTS>, "checkout_url":"<CHECKOUT_URL>",
    "waitlist_url":"<WAITLIST_URL>", "cart_state":"<CART>",
    "noindex":<true|false>, "site_url":"https://<nome>.b2tech.io",
    "deadline":"<DEADLINE — omita se vazio/null>",
    "sections":[<ordem da architecture>],
    "tracking":{"fb_pixel_id":"653995666521954","ga4_id":"G-Z60CJ7W2Z8","consent_key":"b2tech_consent_v1"},
    "seo": <PRODUCT.seo (ou o seo da copy, ≤60/≤155)> }
  ```

### Passo 8 — Build local
Em `${LP_DIR}`:
- Se `node_modules/` **não** existe (veio do `_template` no runner): `npm ci --include=dev`
  (ou `npm install` sem lockfile). **`--include=dev` é obrigatório** — `tsc` e `next build`
  são devDependencies e `NODE_ENV=production` no runner os pularia sem essa flag.
- `npx tsc --noEmit` → **deve passar sem erro** (sem `any`). Se falhar, corrija o conteúdo gerado.
- `NEXT_PUBLIC_NOINDEX=${noindex} npx next build` → gera `out/`.
- Verificar: `out/index.html`, `out/sitemap.xml`, `out/robots.txt` existem. Com `noindex=1`,
  `out/robots.txt` deve conter `Disallow: /`.

### Passo 9 — Deploy no Cloudflare Pages (se `deploy=true`)
Usar `CF_TOKEN` (limpo) + `CLOUDFLARE_ACCOUNT_ID`. Em `${LP_DIR}`:

0. **Guard anti-sobrescrita (defesa de produção).** Antes de criar/deployar, cheque se o
   projeto `b2tech-${nome}` já existe e **já tem deploy** (= página viva):
   ```bash
   LAST=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/b2tech-${nome}" \
     -H "Authorization: Bearer ${CF_TOKEN}" | jq -r '(try .result.latest_deployment.id) // empty')
   ```
   - `LAST` vazio (projeto não existe, ou existe sem nenhum deploy) → **siga** (passo 1).
   - `LAST` não-vazio **e** `overwrite != true` → **ABORTE**: não crie/deploye nada; grave
     manifest `verified:false`, `errors:["b2tech-${nome} já está no ar (deploy ${LAST}); recusando sobrescrever sem overwrite=true"]`, e encerre com mensagem clara. (Protege `cca`, `cca-test` e qualquer LP viva.)
   - `LAST` não-vazio **e** `overwrite=true` → redeploy intencional; siga.

1. **Criar projeto** (idempotente — se já existe, wrangler erra; trate como "existe", siga):
   ```bash
   CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
     npx wrangler pages project create b2tech-${nome} --production-branch=main || true
   ```
2. **Deploy**:
   ```bash
   CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
     npx wrangler pages deploy out --project-name=b2tech-${nome} --branch=main
   ```
   Capturar o `deployment id` e a URL `*.pages.dev` do stdout.
3. **Bind do custom domain**:
   ```bash
   curl -sS -X POST \
     "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/b2tech-${nome}/domains" \
     -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
     --data "{\"name\":\"${nome}.b2tech.io\"}"
   ```
4. **Criar o CNAME explicitamente** (o bind **NÃO** auto-cria o CNAME nesta conta — validado
   2026-06-02; o token TEM escopo Zone DNS Edit). Descobrir o `zone_id` e criar o registro
   proxied (idempotente — se já existe, o POST erra com 81057/81058, trate como "existe"):
   ```bash
   ZID=$(curl -sS "https://api.cloudflare.com/client/v4/zones?name=b2tech.io" \
     -H "Authorization: Bearer ${CF_TOKEN}" | jq -r '.result[0].id')
   curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${ZID}/dns_records" \
     -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
     --data "{\"type\":\"CNAME\",\"name\":\"${nome}\",\"content\":\"b2tech-${nome}.pages.dev\",\"proxied\":true,\"ttl\":1}"
   ```
   `name` é só o subdomínio (`${nome}`), não o FQDN. Se o token perder o escopo Zone DNS
   (10000/9109) → marcar `dns:"pending"` no manifest e seguir (não falhar — §7).
5. **Verificar SSL** (bounded, ~8 tentativas, 20s entre elas). O DNS proxied resolve para
   IPs anycast da Cloudflare; o cert do custom domain provisiona async (~5-15 min):
   ```bash
   for i in $(seq 1 8); do
     CODE=$(curl -sS -o /dev/null -w "%{http_code}" "https://${nome}.b2tech.io/" || echo 000)
     [ "$CODE" = "200" ] && break || sleep 20
   done
   ```
   `200` → `ssl:"active"`; senão `ssl:"pending"` (não é falha). **Sempre** faça o smoke do
   `*.pages.dev` (já fica 200 no deploy). Nota: um resolver local lento (ex.: WSL) pode dar
   `Could not resolve host` mesmo com o DNS já propagado — confirme via `*.pages.dev` (200)
   ou `curl --resolve` antes de concluir `ssl:"error"`.

### Passo 10 — Persistir no Supabase (idempotente)
Via `mcp__supabase__execute_sql`, upsert `ON CONFLICT (subdomain) DO UPDATE`:
- `landing_pages`: `client_id, name, subdomain='<nome>', fqdn='<nome>.b2tech.io',
  url='https://<nome>.b2tech.io', cloudflare_project_id='b2tech-<nome>',
  repo_path='landing-pages/<nome>', content_spec (jsonb do content-spec.json),
  tracking (jsonb), checkout_url=<CHECKOUT_URL>, price_cents=<PRICE_CENTS>, cart_state, noindex,
  ssl_status ('active'|'pending'|'error'), status ('deployed'|'building'|'failed'),
  deployed_at=now() (se deployado), last_deploy_id, raw_spec`.
- `operation_logs`: **uma linha** — `client_id, entity_type='landing_page',
  entity_id=<lp.id>, action='create'|'update', actor='claude-code',
  summary` (humano, ex.: "LP cca.b2tech.io deployada (noindex), SSL active").

### Passo 11 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-landing-page.json` (**sempre**, mesmo em falha):
```json
{
  "skill": "create-landing-page-brunobracaioli",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "nome": "${nome}",
  "subdomain": "${nome}",
  "url": "https://${nome}.b2tech.io",
  "pages_dev_url": "https://b2tech-${nome}.pages.dev",
  "cloudflare_project": "b2tech-${nome}",
  "repo_path": "landing-pages/${nome}",
  "deploy": {"deployed": true, "ssl": "active", "dns": "auto", "deployment_id": "..."},
  "noindex": true,
  "cart_state": "open",
  "content_source": "generated|reused",
  "image_cost_usd_estimate": 0.0,
  "decisions": ["noindex=1 (preview)", "cart_state=open", "stack=next-export"],
  "errors": []
}
```
**Nunca** inclua segredos CF. Se algo falhou, `verified:false` + `errors[]` descritivo.

### Passo 12 — Resumo final (stdout)
URL (`https://${nome}.b2tech.io`), projeto CF, status SSL, estado `noindex`, e a frase:
**"Página em PREVIEW (noindex). Para go-live, rode de novo com `noindex=0` (rebuild+redeploy)."**

---

## 5. Critério de sucesso
- `landing-pages/<nome>/out/{index.html,sitemap.xml,robots.txt}` gerados; `tsc --noEmit` limpo.
- Com `noindex=1`: `robots.txt` tem `Disallow: /` e `<meta name="robots" content="noindex">`.
- HTML inicial **sem** script de Pixel/GA4 (só pós-consent no cliente).
- Com `deploy=true`: `https://<nome>.b2tech.io/` → `200` (ou `ssl_pending` documentado).
- Linha em `landing_pages` (`status='deployed'`, `subdomain=<nome>`) + 1 `operation_logs`.
- Manifest JSON gravado em `${TRY_DIR}/`.

## 6. Anti-padrões (NÃO faça)
- ❌ `AskUserQuestion` / parar para perguntar.
- ❌ Ecoar/commitar `CLOUDFLARE_API_TOKEN` (manifest, logs, stdout, operation_logs).
- ❌ Pixel/GA4 fora do gate de consentimento (nunca hardcode no `layout.tsx`).
- ❌ Features de servidor (API routes, server actions, ISR) — quebram `output:'export'`.
- ❌ Flip de `noindex` sem rebuild+redeploy.
- ❌ Assumir `nome=cca` (ou qualquer default) — `nome` é obrigatório; sem ele, aborte.
- ❌ Deployar por cima de um projeto CF que já tem deploy sem `overwrite=true` (Passo 9.0).
- ❌ Confiar que o bind auto-cria o CNAME (não cria — sempre crie explicitamente, Passo 9.4).
- ❌ Concluir `ssl:"error"` por `Could not resolve host` de resolver local sem checar `*.pages.dev`.
- ❌ Criar a LP na CF sem persistir no Supabase + `operation_logs`.
- ❌ Generalizar para outros clientes.

## 7. Gotchas obrigatórios

**`output:'export'`** — sem API routes / server actions / middleware / ISR. `images.unoptimized:true`
é obrigatório (otimizador do `next/image` exige servidor). O `landing-page-architect` só pode
usar o enum de seções estáticas. Build gera `out/` flat = o que `wrangler pages deploy out` espera.

**`wrangler` headless** — autentica por env `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
(não `wrangler login`). Token com CRLF/espaço → 401 silencioso: sempre faça
`tr -d '[:space:]'` (Passo 0). No runner Fly, `wrangler` é global (Dockerfile, Fase 2).

**CNAME NÃO é auto-criado pelo bind** — validado 2026-06-02: o bind do custom domain deixa o
status `pending` e **não** cria o registro DNS sozinho (apesar de a zona estar na mesma conta).
**Sempre crie o CNAME explicitamente** (Passo 9.4) — o token TEM escopo Zone DNS Edit. Só caia
para `dns:"pending"` se o token perder esse escopo (erro 10000/9109). SSL provisiona async
(~5-15 min; `ssl:"pending"` não é falha). Resolver local lento (WSL) pode mascarar DNS já
propagado — confirme via `*.pages.dev` ou `curl --resolve`, não conclua `error` por causa disso.

**Peso do build no runner Fly** — `npm ci` por run é lento/flaky. O Dockerfile pré-instala
`landing-pages/_template/node_modules`; o scaffold copia `node_modules` do `_template` para
`${LP_DIR}` para evitar install na run (Fase 2). Localmente, `npm install` normal.

**Fontes via `@fontsource` (ADR 0013)** — Inter + DM Sans vêm de `@fontsource/inter` e
`@fontsource/dm-sans` (npm self-hosted), importados em `app/layout.tsx`. NÃO use
`next/font/google`: ele baixaria as fontes na rede durante `next build`, o que falha no
runner headless offline. As fontes já estão no `_template/node_modules` pré-bakeado; o
`out/` carrega `~54` arquivos `woff2` (subset latin) — peso leve, esperado.

**`NEXT_PUBLIC_NOINDEX` é build-time** — está embutido no HTML/robots. Flip exige
rebuild+redeploy. Default `1` (seguro). Go-live = `noindex=0`.

**CVE do Next** — fixar `next@15.5.19+` no `package.json` do template (CVE-2025-66478). Resíduo
moderado de `postcss` transitivo do Next é build-time-only (CSS próprio, sem input não-confiável).

**Headless** — `.claude/HEADLESS.md`. Sem `AskUserQuestion`. `--dangerously-skip-permissions`
destrava writes. Confiamos no contrato deste markdown (por isso noindex default + sem segredos vazados).

## 8. Pré-requisitos
- `.env.local` na raiz: `OPENAI_API_KEY` e (para deploy) `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`. Persistência via MCP do Supabase (sem chave no env).
- Migration `landing_pages` aplicada (`supabase/migrations/20260530000008_add_landing_pages.sql`).
- **Brief do produto no catálogo**: `${MAT}/produtos/${product}.json` (skill `lista-de-produtos`,
  ADR 0014). Sem ele, a skill aborta. Produtos atuais: `cca`, `imersao-agencia`.
- `landing-pages/_template/` presente (com `node_modules` no runner Fly — Fase 2).
- MCP do Supabase autenticado. Skill `image-generate` e subagents disponíveis.
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
