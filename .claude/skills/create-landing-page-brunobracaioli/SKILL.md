---
name: create-landing-page-brunobracaioli
description: Gera de forma 100% autônoma e headless o RASCUNHO de uma landing page profissional de alta conversão para um PRODUTO do cliente brunobracaioli (catálogo em lista-de-produtos) e o escreve AO VIVO no Supabase como blocos editáveis (landing_pages.settings + .theme + landing_page_sections), depois ENFILEIRA a publicação (job landing_publish) que faz build + deploy no Cloudflare Pages. Fluxo: brief do produto (catálogo) → arquitetura de conversão → copy long-form pt-BR → hero/OG → escrita ao vivo no Supabase → enfileira publish. Use quando pedirem "criar landing page para brunobracaioli" (ex.: produto cca ou imersao-agencia), ou quando disparada via Ultron/headless (`claude -p --dangerously-skip-permissions ".claude/skills/create-landing-page-brunobracaioli product=cca nome=cca"`). NÃO faz build nem deploy aqui (isso é do job landing_publish / skill publish-landing-page-*). NÃO cria campanha Meta.
argument-hint: "product=<slug> nome=<subdominio> [ref-url=...] [cart-state=open] [noindex=1]"
allowed-tools: Read, Bash, Glob, Write, Agent, Skill
---

# Skill: /create-landing-page-brunobracaioli

Gera, **de ponta a ponta e sem intervenção humana**, o **rascunho editável** de uma landing
page profissional de alta conversão para o cliente **brunobracaioli** e **enfileira a
publicação** no Cloudflare Pages sob `<nome>.b2tech.io`:
brief do catálogo → arquitetura de conversão → copy long-form pt-BR → visual hero/OG →
**escrita ao vivo no Supabase** (blocos editáveis) → **enfileira `landing_publish`**.

> Esta é a superfície de **geração** da SPEC-012 (CMS editável). A **fonte de verdade do
> rascunho** passa a ser o Supabase: `landing_pages.settings` + `landing_pages.theme` + as
> linhas `landing_page_sections` (uma por bloco). O operador (UI) e o Ultron (voz) editam
> esses blocos depois; **publicar** (job `landing_publish` → skill `publish-landing-page-*`)
> serializa o rascunho → `next build` → `wrangler deploy`. **Esta skill NÃO builda nem
> deploya** — só popula o rascunho e enfileira o publish.
>
> Disparada pela fila `agent_jobs` (ADR 0009 / 0012) no runner Fly. **Toda a inteligência
> está aqui**; o runner é casca fina (`timeout claude -p --dangerously-skip-permissions ...`).
> Spec: `docs/specs/SPEC-012-landing-page-editor.md` (+ SPEC-011 geração). ADRs: 0012
> (hosting), 0013 (design), 0014 (catálogo), 0015 (rascunho no Supabase), 0017 (pacote render).

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano, a sessão entra em deadlock. Em qualquer
   dúvida ou erro: **decida sozinho** com os defaults da §3, registre no manifest (Passo 8)
   e **siga em frente**.
2. **Resolva erros por conta própria.** Só aborte se for impossível prosseguir — e mesmo aí,
   **grave o manifest com `verified:false`** explicando o bloqueio. Se já marcou
   `draft_status='generating'`, reponha para `ready` antes de sair (Passo 7-abort).
3. **Cliente é fixo: `brunobracaioli`.** Não generalize.
4. **Supabase é via REST/curl com `SUPABASE_SECRET_KEY` (service_role).** **NÃO** use o MCP
   do Supabase: ele é OAuth-gated e **não autentica no runner headless**. Toda leitura/escrita
   no banco usa `curl` no endpoint REST (mesmo padrão de `scripts/poll-agent-jobs.sh` e da
   skill `publish-landing-page-*`).
5. **Esta skill NÃO faz build nem deploy.** Não roda `next build`, `tsc`, nem `wrangler`. Ela
   escreve o rascunho no Supabase, gera as imagens no `LP_DIR/public`, e **enfileira o job
   `landing_publish`** (que faz serialize → build → deploy). Segredos de deploy (`CLOUDFLARE_*`)
   **não são necessários aqui**.
6. **Limites duros / segurança:**
   - **`noindex=1` por padrão.** A página nasce em preview (não indexável). Go-live
     (`noindex=0`) só se um argumento pedir explicitamente; o valor é repassado ao publish.
   - **`SUPABASE_SECRET_KEY` nunca** vai para o manifest, logs, `operation_logs`, stdout, ou
     qualquer arquivo commitado. Nunca a ecoe.
   - Prefira **reusar** scrape/copy/imagens já gerados hoje a regerar (cap de LLM).

---

## 2. Constantes do cliente + produto (catálogo)

**Cliente** — fonte de verdade: `.claude/skills/lista-de-clientes/SKILL.md`. No início, faça
lookup de `clients WHERE slug='brunobracaioli'` no Supabase (REST) para o `client_id` (uuid) —
**não hardcode**.

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Domínio | `<nome>.b2tech.io` (zona `b2tech.io` na conta CF) |
| Materiais | `.claude/materiais-das-empresas/brunobracaioli/` (logo, mascote, exemplo-de-ads, **produtos/**) |
| Marca | navy `#0A0F1A`→`#0E1422`, laranja `#FF6B1A` |
| Tracking | FB Pixel `653995666521954` + GA4 `G-Z60CJ7W2Z8` (consent-gated) |

**Produto — NÃO é hardcoded.** Vem do **catálogo** (skill `lista-de-produtos`, ADR 0014):
o brief estruturado fica em `${MAT}/produtos/${product}.json` e é lido via `Read` (headless-safe;
o `.claude/` é COPY-ado para a imagem Fly). O arg `product=<slug>` seleciona qual (default `cca`).

O brief traz tudo que os subagents precisam: `name`, `shortCode`, `tagline`, `positioning`,
`tone`, `offer` (priceCents, anchorPriceCents, checkoutUrl, waitlistUrl, cartState, deadline,
payments, guarantee, scarcity), o conteúdo de copy (`dores`, `mecanismo`, `stack`, `prereqs`,
`agenda`, `entregaveis`, `persona`, `comparison`, `autoridade`, `numeros`, `faqHints`), `seo`,
`assets` (logo/foto do instrutor), `defaultSubdomain` e `brand` (alimenta `theme`). **Nunca
invente** dados de produto — use o brief. Produtos atuais: `cca` e `imersao-agencia`.

---

## 3. Defaults autônomos (decisões já tomadas — não reabrir)

| Decisão | Valor | Por quê |
|---|---|---|
| `product` (slug do catálogo) | `cca` (default) | Seleciona o brief `${MAT}/produtos/${product}.json`. Se o arquivo não existir → aborta (`verified:false`). |
| `nome` (subdomínio) | **obrigatório (sem default)** | Vira `<nome>.b2tech.io` + projeto CF `b2tech-<nome>` + `landing_pages.subdomain`. Sem `nome` → aborta. **Nunca** assuma `cca` (é uma página de produção). O brief tem `defaultSubdomain`, mas `nome` ainda precisa ser passado explicitamente. |
| Sink do conteúdo | **Supabase** (rows `landing_page_sections` + `settings`/`theme`) | SPEC-012 — fonte de verdade do rascunho. NÃO escreve `messages/pt.json`/`content-spec.json` (o publish serializa do Supabase). |
| Build + deploy | **job `landing_publish`** (enfileirado no fim) | Esta skill não builda/deploya — ver §1.5. |
| Template | `landing-pages/_template/` → `landing-pages/<nome>/` (só p/ imagens + reuso no publish) | Clonável |
| Seções | enum: hero·urgency·problem·comparison·solution·features·curriculum·stats·proof·logos·persona·authority·offer·guarantee·faq·finalCta·footer | Template (ADR 0013) |
| Design system | claro + blocos escuros, Inter/DM Sans (@fontsource), accent laranja, motion leve | ADR 0013 |
| `cart-state` | `open` (ou do brief) | `closed` → CTA waitlist WhatsApp |
| `noindex` | `1` (preview) | Repassado ao publish; go-live exige `noindex=0` |
| Tom da copy | tech-hacker, pt-BR, sênior (sem clichês) | Marca |

**Validação de `nome`:** `^[a-z0-9-]{2,40}$` (vira subdomínio + nome de projeto CF). Se
inválido → manifest `verified:false` e sair.

**Args** via `$ARGUMENTS` (`key=value`): `nome` (**obrigatório**), `product` (default `cca`),
`ref-url` (opcional), `cart-state`, `noindex`. Sem `nome` → aborta (manifest `verified:false`).
Nunca use `cca` como fallback de `nome`. `checkout-url`/`cart-state`/`deadline` vêm do brief do
produto; um arg explícito, se passado, sobrescreve o brief.

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- `REPO="$(pwd)"` (no runner é `/app`). Guarde — você vai `cd` para dirs de LP.
- **Env (REST do Supabase + imagens):**
  ```bash
  [ -f .env.local ] && set -a && eval "$(tr -d '\r' < .env.local)" && set +a || true
  SUPABASE_URL="$(printf '%s' "${SUPABASE_URL:-}" | tr -d '[:space:]')"
  SUPABASE_KEY="$(printf '%s' "${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}" | tr -d '[:space:]')"
  REST="${SUPABASE_URL%/}/rest/v1"
  ```
  `OPENAI_API_KEY` é necessário para o `image-generate` (Passo 6). Se `SUPABASE_URL`/
  `SUPABASE_KEY` vazios → manifest `verified:false` (`errors:["supabase creds ausentes"]`), sair.
- Parse dos args; aplicar defaults da §3 (`product=cca`). **`nome` é obrigatório**: se ausente
  → manifest `verified:false` (`errors:["nome obrigatório"]`) e sair. Validar
  `nome =~ ^[a-z0-9-]{2,40}$` e `product =~ ^[a-z0-9-]{2,40}$`. **Nunca** assumir `cca` como `nome`.
- Paths: `LP_DIR="${REPO}/landing-pages/${nome}"`, `TRY_DIR=tentativas-geracao-de-campanhas`,
  `MAT=.claude/materiais-das-empresas/brunobracaioli`, `BRIEF_FILE="${MAT}/produtos/${product}.json"`.
  `mkdir -p "${TRY_DIR}" "${LP_DIR}/.gen"`. `GEN=$(mktemp -d)` para corpos REST intermediários.
- **Carregar o brief do produto (catálogo, ADR 0014):** `Read` `${BRIEF_FILE}` → objeto `PRODUCT`.
  Se não existir → manifest `verified:false`
  (`errors:["produto '${product}' não está no catálogo (${MAT}/produtos/)"]`) e sair. Derivar
  (via `jq` do `BRIEF_FILE`): `PROD_NAME=.name`, `SHORT=.shortCode`,
  `PRICE_CENTS=.offer.priceCents`, `CHECKOUT_URL=.offer.checkoutUrl`,
  `WAITLIST_URL=.offer.waitlistUrl`, `CART=.offer.cartState` (arg `cart-state` sobrescreve),
  `DEADLINE=.offer.deadline`, `DEFAULT_SUB=.defaultSubdomain`. O `PRODUCT` inteiro alimenta os
  subagents (Passos 3/4).
- **Resolver os assets do brief (ADR 0014/0018) — fonte de verdade é `assets.*`, com fallback
  de convenção** (caminhos relativos ao repo). Use o que o brief declara; só caia pro padrão se
  o campo faltar. Resolva e confira existência:
  ```bash
  resolve_asset() { # $1 = jq path no brief  $2 = caminho-convenção de fallback
    local p; p=$(jq -r "$1 // \"\"" "${BRIEF_FILE}")
    [ -n "${p}" ] && [ "${p}" != "null" ] || p="$2"
    [ -f "${REPO}/${p}" ] && printf '%s' "${REPO}/${p}" || printf ''  # vazio = ausente
  }
  LOGO_SRC=$(resolve_asset '.assets.logo'            "${MAT}/logo/logo.png")
  INSTRUCTOR_SRC=$(resolve_asset '.assets.instructorPhoto' "${MAT}/logo/foto-do-infoprodutor/bruno-bracaioli.jpg")
  MASCOTE_SRC=$(resolve_asset '.assets.mascote'      "${MAT}/mascote/claude-lendo.png")
  EXAMPLE_ADS_DIR=$(jq -r '.assets.exampleAds // ""' "${BRIEF_FILE}"); [ -n "${EXAMPLE_ADS_DIR}" ] || EXAMPLE_ADS_DIR="${MAT}/exemplo-de-ads/"
  ```
  Asset ausente (`*_SRC` vazio) **não** aborta — degrada (sem logo/foto). Esses caminhos
  alimentam o Passo 6 (refs do `image-prompt-generator`, cópia da foto, upload da logo).
- **Constantes derivadas:**
  ```bash
  NOINDEX_BOOL=$([ "${noindex:-1}" = "0" ] && echo false || echo true)
  TRACKING='{"fb_pixel_id":"653995666521954","ga4_id":"G-Z60CJ7W2Z8","consent_key":"b2tech_consent_v1"}'
  ```

> **Helper REST (use em todas as chamadas ao Supabase):** sempre os headers
> `apikey: ${SUPABASE_KEY}` e `Authorization: Bearer ${SUPABASE_KEY}`, `--max-time 15`. Para
> escrita use `-H "Content-Type: application/json"`; para upsert
> `-H "Prefer: resolution=merge-duplicates,return=representation"` + `?on_conflict=<cols>`.
> Trate corpo vazio/erro como falha transitória (re-tente 1x antes de abortar).

### Passo 1 — Client lookup + upsert `products` + upsert `landing_pages` (draft `generating`)
1. **Client lookup** (REST):
   ```bash
   CLIENT=$(curl -fsS "${REST}/clients?slug=eq.brunobracaioli&select=id,materials_path" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 15)
   CLIENT_ID=$(echo "${CLIENT}" | jq -r '.[0].id // empty')
   ```
   Vazio → manifest `verified:false` (`errors:["cliente brunobracaioli não encontrado"]`), sair.
2. **Upsert `products`** (read-model do catálogo, ADR 0016) `ON CONFLICT (client_id,slug)`:
   ```bash
   PBODY=$(jq -nc --arg cid "${CLIENT_ID}" --arg slug "${product}" --arg name "${PROD_NAME}" \
     --arg bp "${BRIEF_FILE}" --arg ds "${DEFAULT_SUB}" --slurpfile brief "${BRIEF_FILE}" \
     '{client_id:$cid, slug:$slug, name:$name, brief_path:$bp, brief:$brief[0],
       default_subdomain:(if $ds=="" or $ds=="null" then null else $ds end), status:"active"}')
   PROW=$(curl -fsS -X POST "${REST}/products?on_conflict=client_id,slug" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=representation" \
     --max-time 15 -d "${PBODY}")
   PRODUCT_ID=$(echo "${PROW}" | jq -r '.[0].id // empty')
   ```
3. **`theme`** (tokens de design por LP) a partir de `brief.brand` (navy→navy900,
   navyAlt→navy800, orange→orange; fonts/scale ficam default — editor ajusta na Wave 4):
   ```bash
   THEME=$(jq -c '{colors: ({} +
     (if .brand.orange   then {orange:.brand.orange}     else {} end) +
     (if .brand.navy     then {navy900:.brand.navy}      else {} end) +
     (if .brand.navyAlt  then {navy800:.brand.navyAlt}   else {} end))}' "${BRIEF_FILE}")
   ```
4. **`settings` parcial** (o resto — seo/cartClosed — entra no Passo 4, quando a copy existe):
   ```bash
   SETTINGS=$(jq -nc --arg sub "${nome}" --arg name "${SHORT}" --arg product "${PROD_NAME}" \
     --arg site "https://${nome}.b2tech.io" --argjson price "${PRICE_CENTS:-null}" \
     --arg checkout "${CHECKOUT_URL}" --arg waitlist "${WAITLIST_URL}" \
     --arg cart "${CART}" --argjson ni "${NOINDEX_BOOL}" --arg deadline "${DEADLINE}" \
     --argjson tracking "${TRACKING}" \
     '{subdomain:$sub, name:$name, product:$product, site_url:$site, tracking:$tracking,
       checkout_url:$checkout, price_cents:$price, cart_state:$cart, noindex:$ni}
      + (if $waitlist=="" or $waitlist=="null" then {} else {waitlist_url:$waitlist} end)
      + (if $deadline=="" or $deadline=="null" then {} else {deadline:$deadline} end)')
   ```
5. **Upsert `landing_pages`** `ON CONFLICT (subdomain)` (colunas NOT NULL: client_id, name,
   subdomain, fqdn, url, repo_path):
   ```bash
   LBODY=$(jq -nc --arg cid "${CLIENT_ID}" \
     --argjson pid "$([ -n "${PRODUCT_ID}" ] && echo "\"${PRODUCT_ID}\"" || echo null)" \
     --arg name "${SHORT}" --arg sub "${nome}" --arg fqdn "${nome}.b2tech.io" \
     --arg url "https://${nome}.b2tech.io" --arg repo "landing-pages/${nome}" \
     --arg cfp "b2tech-${nome}" --argjson theme "${THEME}" --argjson settings "${SETTINGS}" \
     --arg checkout "${CHECKOUT_URL}" --argjson price "${PRICE_CENTS:-null}" \
     --arg cart "${CART}" --argjson ni "${NOINDEX_BOOL}" --argjson tracking "${TRACKING}" \
     '{client_id:$cid, product_id:$pid, name:$name, subdomain:$sub, fqdn:$fqdn, url:$url,
       repo_path:$repo, cloudflare_project_id:$cfp, theme:$theme, settings:$settings,
       draft_status:"generating", cart_state:$cart, noindex:$ni, tracking:$tracking,
       checkout_url:$checkout, price_cents:$price, status:"draft"}')
   LROW=$(curl -fsS -X POST "${REST}/landing_pages?on_conflict=subdomain" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=representation" \
     --max-time 15 -d "${LBODY}")
   LP_ID=$(echo "${LROW}" | jq -r '.[0].id // empty')
   ```
   Sem `LP_ID` → manifest `verified:false` (`errors:["falha ao upsert landing_pages"]`), sair.
   **A partir daqui, qualquer abort DEVE** repor `draft_status='ready'` (Passo 7-abort).

### Passo 2 — Scrape da referência (OPCIONAL, idempotente)
O **brief do catálogo (`PRODUCT`) é a fonte primária** — não precisa de scrape. Só rode scrape
se `ref-url` for passado (para suplementar tom/visual de uma referência externa):
- `Agent(subagent_type="scrape-extractor")` com `ref-url` → salve em `${LP_DIR}/.gen/scrape.json`.
  Sem `ref-url` → `scrape=null`.

### Passo 3 — Arquitetura de conversão → INSERT das linhas de seção
1. `Agent(subagent_type="landing-page-architect")` passando o **brief do produto** (catálogo).
   Mapeie `PRODUCT` para o contrato `product` (estendido) + `scrape` opcional:
   ```jsonc
   { "scrape": <scrape.json ou null>,
     "product": {
       "name": "<PROD_NAME>", "shortCode": "<SHORT>",
       "priceCents": <PRICE_CENTS>, "anchorPriceCents": <PRODUCT.offer.anchorPriceCents>,
       "checkoutUrl": "<CHECKOUT_URL>", "cartState": "<CART>", "deadline": "<DEADLINE>",
       "tagline": "<PRODUCT.tagline>", "positioning": "<PRODUCT.positioning>",
       "offerDetails": "<PRODUCT.whatItIs>",
       "dores": <PRODUCT.dores>, "mecanismo": <PRODUCT.mecanismo>, "stack": <PRODUCT.stack>,
       "prereqs": <PRODUCT.prereqs>, "agenda": <PRODUCT.agenda>, "entregaveis": <PRODUCT.entregaveis>,
       "persona": <PRODUCT.persona>, "comparison": <PRODUCT.comparison>,
       "autoridade": <PRODUCT.autoridade>, "numeros": <PRODUCT.numeros>,
       "scarcity": "<PRODUCT.offer.scarcity>", "guarantee": "<PRODUCT.offer.guarantee>"
     },
     "constraints": {"language": "<PRODUCT.language>", "style": "<PRODUCT.tone>", "maxSections": 17} }
   ```
   → JSON de arquitetura (`sections[]` com `type`/`order`/`goal`, `heroAngle`, CTA, `seoIntent`).
   Salve em `${LP_DIR}/.gen/architecture.json`. Se vier `{"error":...}` → repor
   `draft_status='ready'`, manifest `verified:false`, sair.
2. **INSERT das rows `landing_page_sections`** — uma por seção da arquitetura, `fields` vazio
   (a copy preenche no Passo 4). Idempotente: `ON CONFLICT (landing_page_id,type)` atualiza só
   `position`/`enabled` (**sem** mandar `fields`, para não apagar copy de uma re-run):
   ```bash
   SECROWS=$(jq -c --arg lp "${LP_ID}" \
     '[.sections[] | {landing_page_id:$lp, type:.type, position:(.order-1),
                      enabled:true, updated_by:"generator"}]' \
     "${LP_DIR}/.gen/architecture.json")
   curl -fsS -X POST "${REST}/landing_page_sections?on_conflict=landing_page_id,type" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" \
     --max-time 15 -d "${SECROWS}" >/dev/null
   N_SECTIONS=$(jq '.sections | length' "${LP_DIR}/.gen/architecture.json")
   ```

### Passo 4 — Copy long-form → UPDATE de `fields` por seção + `settings`
1. `Agent(subagent_type="lp-copywriter")` com `{architecture, product:<mesmo objeto do Passo 3>,
   scrape:<ou null>, tone:"<PRODUCT.tone>", language:"<PRODUCT.language>"}` → copy JSON no shape
   de `messages/pt.json` (inclui `seo`, `hero`, `sections.*`, `offer`, `faq` (array), `finalCta`,
   `cartClosed`, `footer`). Salve em `${LP_DIR}/.gen/copy.json`. **A copy sai do brief — não
   inventar dados.** Se vier `{"error":...}` → repor `draft_status='ready'`, manifest
   `verified:false`, sair.
2. **UPDATE de `fields` por seção** (cada PATCH é um marco de progresso visível no dashboard).
   O mapeamento é o **inverso do serializer** (`packages/lp-render/src/serialize.ts`): `hero`/
   `offer`/`finalCta`/`footer` → o objeto direto; `faq` → `{items:<array>}`; as seções "middle"
   (`urgency`/`problem`/`comparison`/`solution`/`features`/`curriculum`/`stats`/`proof`/`logos`/
   `persona`/`authority`/`guarantee`) → o objeto sob `sections.<type>`. PATCH só casa rows que
   existem (as que o Passo 3 criou); chaves sem row viram no-op:
   ```bash
   jq -c '({hero:.hero, offer:.offer, finalCta:.finalCta, footer:.footer, faq:{items:.faq}}
           + (.sections // {}))
          | to_entries[] | select(.value != null)' \
     "${LP_DIR}/.gen/copy.json" > "${GEN}/fieldmap.jsonl"
   while IFS= read -r entry; do
     t=$(echo "${entry}" | jq -r '.key')
     [[ "${t}" =~ ^[a-zA-Z]+$ ]] || continue
     fv=$(echo "${entry}" | jq -c '.value')
     curl -fsS -X PATCH "${REST}/landing_page_sections?landing_page_id=eq.${LP_ID}&type=eq.${t}" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
       -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
       -d "$(jq -nc --argjson f "${fv}" '{fields:$f, updated_by:"generator"}')" >/dev/null
   done < "${GEN}/fieldmap.jsonl"
   ```
3. **UPDATE de `landing_pages.settings`** (substituição completa — agora com `seo` + `cartClosed`
   da copy, sobre o parcial do Passo 1). O publish valida que `settings` tem
   subdomain/site_url/seo/tracking/checkout_url/price_cents/cart_state/noindex/cartClosed:
   ```bash
   SETTINGS_FULL=$(jq -nc --arg sub "${nome}" --arg name "${SHORT}" --arg product "${PROD_NAME}" \
     --arg site "https://${nome}.b2tech.io" --argjson price "${PRICE_CENTS:-null}" \
     --arg checkout "${CHECKOUT_URL}" --arg waitlist "${WAITLIST_URL}" \
     --arg cart "${CART}" --argjson ni "${NOINDEX_BOOL}" --arg deadline "${DEADLINE}" \
     --argjson tracking "${TRACKING}" --slurpfile copy "${LP_DIR}/.gen/copy.json" \
     '{subdomain:$sub, name:$name, product:$product, site_url:$site, tracking:$tracking,
       checkout_url:$checkout, price_cents:$price, cart_state:$cart, noindex:$ni,
       seo: ($copy[0].seo // {title:"",description:""}),
       cartClosed: ($copy[0].cartClosed // {})}
      + (if $waitlist=="" or $waitlist=="null" then {} else {waitlist_url:$waitlist} end)
      + (if $deadline=="" or $deadline=="null" then {} else {deadline:$deadline} end)')
   curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
     -d "$(jq -nc --argjson s "${SETTINGS_FULL}" '{settings:$s}')" >/dev/null
   ```

### Passo 5 — Scaffold do template (para o publish reusar; não builda aqui)
- Se `${LP_DIR}/package.json` não existe: `cp -r "${REPO}/landing-pages/_template/." "${LP_DIR}/"`
  (use a forma `/.`; copiar sem o `/.` aninha o template). Remova `out/`/`.next/` se vierem.
- **No runner Fly** o `_template` já traz `node_modules` pré-bakeado (inclui `tsx` + o symlink
  `@b2tech/lp-render`); o `cp` os leva junto → o job `landing_publish` (mesma máquina) acha
  `package.json` + `public/` presentes e **pula o scaffold e o `npm ci`**. Esta skill **não**
  escreve `messages/pt.json`/`content-spec.json` (o publish serializa do Supabase).

### Passo 6 — Visual hero + OG + foto do instrutor → `${LP_DIR}/public` + Storage (idempotente, best-effort)
Gera os visuais localmente **E os persiste no bucket público `landing-assets`** + grava as URLs
no Supabase, para que **sobrevivam a republish/edição** (SPEC-012 Wave 4). As imagens passam a
ser **renderizadas** na página: `settings.logo` (logo no topo do hero), `hero.image` (visual do
hero), `authority.image` (foto do instrutor), e `settings.seo.ogImage` (preview social). Os
caminhos de origem (`LOGO_SRC`/`INSTRUCTOR_SRC`/`MASCOTE_SRC`/`EXAMPLE_ADS_DIR`) vêm de
`assets.*` do brief (Passo 0). Falha de imagem/upload **não** quebra o publish
(`images.unoptimized`) — degrada para texto.

1. **Reuse**: se `${LP_DIR}/public/hero.png` e `og.png` já existem do dia, pule a geração. Senão:
   - `Agent(subagent_type="image-prompt-generator")` (variant A) com:
     `{scrape, brief:<PRODUCT (tagline/positioning/numeros)>, aspectRatio:"1920x1080",
     referenceImagePaths:[ <LOGO_SRC>, <MASCOTE_SRC>, <EXAMPLE_ADS_DIR>/*.png ] (use os
     `*_SRC` resolvidos no Passo 0 — pule os vazios), configHints:{brandName:"<PROD_NAME>"}}`
     → prompt do hero.
   - `Skill(skill="image-generate", args="prompt-file=<prompt> aspect=1.91:1 out-dir=${LP_DIR}/public out-name=hero")`
     → `hero.png`. Derive `og.png` (1200×630) do hero (ou gere um segundo). Registre o custo
     estimado (manifest do `image-generate`) para o `image_cost_usd_estimate` (Passo 8).
2. **Foto do instrutor (seção authority):** se `INSTRUCTOR_SRC` (Passo 0) existe, copie-o para
   `${LP_DIR}/public/instrutor.jpg` (`[ -n "${INSTRUCTOR_SRC}" ] && cp "${INSTRUCTOR_SRC}" "${LP_DIR}/public/instrutor.jpg"`).
   Sem foto, o template degrada para painel só-texto.
2b. **Logo da marca:** se `LOGO_SRC` (Passo 0) existe, copie-o para `${LP_DIR}/public/logo.png`
   (`[ -n "${LOGO_SRC}" ] && cp "${LOGO_SRC}" "${LP_DIR}/public/logo.png"`). A logo é renderizada
   no topo do hero (`settings.logo`) — ver Passo 5 da persistência abaixo. Sem logo, degrada.
3. **Bucket** (idempotente — ignore "já existe"): garanta `landing-assets` público:
   ```bash
   curl -sS -X POST "${SUPABASE_URL%/}/storage/v1/bucket" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" --max-time 15 \
     -d '{"id":"landing-assets","name":"landing-assets","public":true}' >/dev/null 2>&1 || true
   ```
4. **Upload** de cada PNG/JPG presente (`x-upsert: true` para regravar numa re-run), caminho
   estável `${LP_ID}/<file>` → ecoa a URL pública (vazio se o arquivo não existe ou o upload falhou):
   ```bash
   upload_asset() {  # $1=arquivo local  $2=nome no bucket  $3=content-type
     [ -f "$1" ] || return 1
     curl -sS -X POST "${SUPABASE_URL%/}/storage/v1/object/landing-assets/${LP_ID}/$2" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
       -H "x-upsert: true" -H "Content-Type: $3" --max-time 30 --data-binary @"$1" >/dev/null 2>&1 \
       && printf '%s' "${SUPABASE_URL%/}/storage/v1/object/public/landing-assets/${LP_ID}/$2"
   }
   HERO_URL=$(upload_asset "${LP_DIR}/public/hero.png"      hero.png      image/png  || true)
   OG_URL=$(upload_asset   "${LP_DIR}/public/og.png"        og.png        image/png  || true)
   INSTR_URL=$(upload_asset "${LP_DIR}/public/instrutor.jpg" instrutor.jpg image/jpeg || true)
   LOGO_URL=$(upload_asset "${LP_DIR}/public/logo.png"      logo.png      image/png  || true)
   ```
5. **Persistir as URLs no Supabase** (sempre **merge** — NÃO clobber a copy do Passo 4: GET →
   `+` no jq → PATCH):
   ```bash
   patch_section_image() {  # $1=type  $2=url
     [ -n "$2" ] || return 0
     local cur new
     cur=$(curl -fsS "${REST}/landing_page_sections?landing_page_id=eq.${LP_ID}&type=eq.$1&select=fields" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 15 \
       | jq -c '.[0].fields // {}') || return 0
     [ -n "${cur}" ] || cur='{}'
     new=$(jq -nc --argjson f "${cur}" --arg u "$2" '$f + {image:$u}')
     curl -fsS -X PATCH "${REST}/landing_page_sections?landing_page_id=eq.${LP_ID}&type=eq.$1" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
       -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
       -d "$(jq -nc --argjson f "${new}" '{fields:$f, updated_by:"generator"}')" >/dev/null 2>&1 || true
   }
   patch_section_image hero      "${HERO_URL:-}"
   patch_section_image authority "${INSTR_URL:-}"   # no-op se não há row authority
   # Page-level: og → settings.seo.ogImage; logo → settings.logo (1 GET/merge/PATCH):
   if [ -n "${OG_URL:-}" ] || [ -n "${LOGO_URL:-}" ]; then
     CURS=$(curl -fsS "${REST}/landing_pages?id=eq.${LP_ID}&select=settings" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 15 \
       | jq -c '.[0].settings // {}')
     [ -n "${CURS}" ] || CURS='{}'
     NEWS=$(jq -nc --argjson s "${CURS}" --arg og "${OG_URL:-}" --arg logo "${LOGO_URL:-}" \
       '$s
        + (if $og   != "" then {seo: (($s.seo // {}) + {ogImage:$og})} else {} end)
        + (if $logo != "" then {logo:$logo} else {} end)')
     curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
       -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
       -d "$(jq -nc --argjson s "${NEWS}" '{settings:$s}')" >/dev/null 2>&1 || true
   fi
   ```
   Imagens faltando **não** quebram o publish (`images.unoptimized`); o publish baixa as URLs
   do `landing-assets` de volta para `public/` (skill `publish-*` Passo 5).

### Passo 7 — Marcar `ready` + enfileirar `landing_publish` + `operation_logs`
1. **`draft_status='ready'`** (rascunho pronto para editar/publicar):
   ```bash
   curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
     -d '{"draft_status":"ready"}' >/dev/null
   ```
2. **Enfileirar `landing_publish`** (INSERT em `agent_jobs`; o poller do Fly dispara a skill
   `publish-landing-page-brunobracaioli`, que serializa→build→deploy). O dedup per-LP
   (`agent_jobs_one_active_per_lp_kind`) cobre concorrência — `409`/`23505` = "já há publish em
   voo", trate como ok:
   ```bash
   JOB=$(jq -nc --arg cid "${CLIENT_ID}" --arg lp "${LP_ID}" --arg ni "${noindex:-1}" \
     '{client_id:$cid, skill:"publish-landing-page-brunobracaioli", kind:"landing_publish",
       landing_page_id:$lp, requested_by:"generator", args:{landing_page_id:$lp, noindex:$ni}}')
   PUB_CODE=$(curl -sS -o "${GEN}/job.json" -w "%{http_code}" -X POST "${REST}/agent_jobs" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: return=representation" --max-time 15 \
     -d "${JOB}")
   # 201 = enfileirado; 409 (dedup) = já há publish em voo → ok. Outro código → registre como aviso.
   ```
3. **`operation_logs`** — uma linha (sem segredos):
   ```bash
   curl -fsS -X POST "${REST}/operation_logs" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
     -d "$(jq -nc --arg c "${CLIENT_ID}" --arg e "${LP_ID}" \
         --arg s "LP ${nome}.b2tech.io: rascunho gerado (${N_SECTIONS} seções) e publish enfileirado (noindex=${noindex:-1})" \
         '{client_id:$c, entity_type:"landing_page", entity_id:$e, action:"create", actor:"claude-code", summary:$s}')" >/dev/null
   ```

### Passo 7-abort — Reposição em caso de falha (obrigatório)
Se abortar **após** o Passo 1 (já marcou `draft_status='generating'`), antes de sair **sempre**
reponha para `ready` (para o dashboard não ficar preso em "gerando") e grave o manifest
`verified:false` com `errors[]`:
```bash
curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
  -d '{"draft_status":"ready"}' >/dev/null
```

### Passo 8 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-landing-page.json` (**sempre**, mesmo em falha):
```json
{
  "skill": "create-landing-page-brunobracaioli",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "product": "${product}",
  "nome": "${nome}",
  "subdomain": "${nome}",
  "url": "https://${nome}.b2tech.io",
  "landing_page_id": "${LP_ID}",
  "product_id": "${PRODUCT_ID}",
  "repo_path": "landing-pages/${nome}",
  "draft_status": "ready",
  "sections_count": ${N_SECTIONS},
  "publish_enqueued": true,
  "noindex": ${NOINDEX_BOOL},
  "cart_state": "${CART}",
  "content_source": "generated|reused",
  "image_cost_usd_estimate": 0.0,
  "decisions": ["sink=supabase-draft", "noindex=${noindex:-1} (preview)", "publish via landing_publish job"],
  "errors": []
}
```
**Nunca** inclua a `SUPABASE_SECRET_KEY`. Se algo falhou, `verified:false` + `errors[]` descritivo.

### Passo 9 — Resumo final (stdout)
LP id, subdomínio (`https://${nome}.b2tech.io`), nº de seções gravadas, `draft_status='ready'`,
estado `noindex`, e a frase: **"Rascunho no Supabase pronto para edição. Publicação enfileirada
(job `landing_publish`) — a página vai nascer em PREVIEW (noindex). Go-live = publicar com
`noindex=0`."**

---

## 5. Critério de sucesso
- `clients` resolvido (REST); `products` e `landing_pages` upsertados (`draft_status` passou
  `generating`→`ready`); `product_id`/`theme`/`settings` preenchidos.
- N linhas em `landing_page_sections` (uma por seção da arquitetura), com `fields` preenchido
  pela copy (hero/offer/finalCta/footer/faq + middle), `position` na ordem da arquitetura.
- `landing_pages.settings` completo (subdomain, site_url, seo, tracking, checkout_url,
  price_cents, cart_state, noindex, cartClosed) — pronto para o publish validar.
- Imagens em `${LP_DIR}/public/` (hero/og; instrutor/logo se houver) + template scaffoldado, e
  (best-effort) subidas ao bucket `landing-assets` com as URLs persistidas em
  `landing_page_sections.fields.image` (hero/authority), `settings.seo.ogImage` e `settings.logo`
  — assets resolvidos de `assets.*` do brief.
- Job `landing_publish` enfileirado em `agent_jobs` (ou `409` dedup) + 1 `operation_logs`.
- Manifest JSON gravado em `${TRY_DIR}/`.

## 6. Anti-padrões (NÃO faça)
- ❌ `AskUserQuestion` / parar para perguntar.
- ❌ Usar o **MCP do Supabase** (não autentica headless) — só REST/curl + `SUPABASE_SECRET_KEY`.
- ❌ Escrever `messages/pt.json`/`content-spec.json` ou rodar `tsc`/`next build`/`wrangler` aqui
  — build/deploy é do job `landing_publish` (skill `publish-landing-page-*`).
- ❌ Ecoar/commitar `SUPABASE_SECRET_KEY` (manifest, logs, stdout, operation_logs).
- ❌ Mandar `fields` no upsert de seções do Passo 3 (apagaria a copy de uma re-run; o `fields`
  é preenchido só no Passo 4 via PATCH).
- ❌ Gravar `settings` incompleto e enfileirar publish (o publish aborta sem seo/cartClosed) —
  só enfileire após o Passo 4.3.
- ❌ Assumir `nome=cca` (ou qualquer default) — `nome` é obrigatório; sem ele, aborte.
- ❌ Sair com `draft_status='generating'` preso após uma falha (sempre reponha — Passo 7-abort).
- ❌ Inventar dados de produto — a copy/arquitetura saem do brief (`PRODUCT`).
- ❌ Generalizar para outros clientes.

## 7. Gotchas obrigatórios

**Supabase headless = REST/curl.** `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (service_role,
bypassa RLS). Strip de CR/espaço nas duas (secret de fonte CRLF carrega `\r` e quebra a URL).
O MCP do Supabase é OAuth-gated → não autentica no runner (gotcha conhecido, igual ao publish).

**Upsert PostgREST.** Use `?on_conflict=<cols>` + `Prefer: resolution=merge-duplicates`. No
upsert de seções (Passo 3), **omita `fields`** do payload: no INSERT ele assume o default
`'{}'`; no conflito, colunas ausentes do payload **não** são tocadas → a copy de uma run
anterior sobrevive. As `fields` são preenchidas no Passo 4 via PATCH por `type`.

**Sink é o Supabase, não arquivo.** O serializer (`packages/lp-render/serialize-cli.ts`, rodado
pelo publish) reconstrói `messages/pt.json` + `content-spec.json` + `theme.css` a partir de
`settings`+`theme`+`landing_page_sections`. Mapeamento (inverso): `hero/offer/finalCta/footer`
→ `fields` direto; `faq` → `fields.items`; middle → `messages.sections.<type>`; `settings.seo`
→ `messages.seo`; `settings.cartClosed` → `messages.cartClosed`; `theme.colors.*` → CSS vars.
Posição dos blocos = `landing_page_sections.position` (da `order` da arquitetura).

**Build/deploy moveram para o job `landing_publish`.** Esta skill termina enfileirando o publish.
O publish (skill `publish-landing-page-brunobracaioli`) faz scaffold-se-preciso, serializa,
`next build` (static export), `wrangler deploy`, bind de domínio + CNAME + SSL, e persiste
`published_snapshot`. Os gotchas de `output:'export'`, `@fontsource`, CNAME/SSL e `wrangler`
headless vivem **lá**.

**`noindex` é build-time** — o valor (`0|1`) é gravado em `settings.noindex` e repassado ao job
publish em `args.noindex`; o flip de preview→go-live exige republicar (rebuild+redeploy). Default
`1` (seguro).

**Peso do scaffold no runner Fly** — `cp -r _template/. ${LP_DIR}/` leva o `node_modules`
pré-bakeado (com `tsx` + symlink `@b2tech/lp-render`); o job publish (mesma máquina) reusa e
pula o `npm ci`. Não rode `npm ci` aqui.

**Headless** — `.claude/HEADLESS.md`. Sem `AskUserQuestion`. `--dangerously-skip-permissions`
destrava writes. Confiamos no contrato deste markdown (noindex default + sem segredos vazados).

## 8. Pré-requisitos
- Env: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (secrets do Fly no runner; `.env.local` localmente);
  `OPENAI_API_KEY` para o `image-generate`. **Não** precisa de `CLOUDFLARE_*` (deploy é do publish).
- Migrations da SPEC-012 aplicadas (`products`, `landing_page_sections`, `landing_pages.{product_id,
  theme,settings,draft_status,published_snapshot}`, `agent_jobs.{landing_publish kind,landing_page_id}`)
  — já em prod (2026-06-03). Migration `landing_pages` base (`20260530000008`).
- **Brief do produto no catálogo**: `${MAT}/produtos/${product}.json` (skill `lista-de-produtos`,
  ADR 0014). Sem ele, a skill aborta. Produtos atuais: `cca`, `imersao-agencia`.
- Skill `publish-landing-page-brunobracaioli` no disco (o poller a dispara pelo job).
- `landing-pages/_template/` presente (com `node_modules` no runner Fly).
- Skill `image-generate` e subagents (`landing-page-architect`, `lp-copywriter`,
  `image-prompt-generator`, `scrape-extractor`) disponíveis.
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
