---
name: publish-landing-page-brunobracaioli
description: Publica (deploy no Cloudflare Pages) o RASCUNHO atual de uma landing page do cliente brunobracaioli que vive no Supabase (landing_pages.settings + landing_pages.theme + landing_page_sections). Serializa o ContentDoc → messages/pt.json + content-spec.json + theme.css (serializer puro compartilhado) → next build (static export) → wrangler deploy → persiste o snapshot publicado. Use quando pedirem "publicar a landing page X" ou quando disparada via Ultron/headless pela fila agent_jobs (kind=landing_publish, ex.: `claude -p --dangerously-skip-permissions ".claude/skills/publish-landing-page-brunobracaioli landing_page_id=<uuid>"`). NÃO gera copy nem cria a LP — só publica o rascunho existente. NÃO cria campanha Meta.
argument-hint: "landing_page_id=<uuid> | nome=<subdominio> [noindex=0|1] [overwrite=true]"
allowed-tools: Read, Bash, Glob, Write, Edit
---

# Skill: /publish-landing-page-brunobracaioli

Publica o **rascunho** de uma landing page que vive no Supabase como blocos editáveis,
gerando um **snapshot estático** no Cloudflare Pages sob `<subdomain>.b2tech.io`.

Esta é a **superfície "Publicado"** da SPEC-012 (CMS editável). A **fonte de verdade do
rascunho** é o Supabase (`landing_pages.settings` + `landing_pages.theme` + as linhas
`landing_page_sections`). Publicar = **serializar esse rascunho** → os mesmos arquivos que
o build da SPEC-011 já consome → `next build` → `wrangler deploy`. **Nada no pipeline de
build/deploy muda** — só ganha o serializer na frente.

> Disparada pela fila `agent_jobs` (kind `landing_publish`, ADR 0009) no runner Fly, ou
> manualmente. Toda a inteligência está aqui; o runner é casca fina.
> Spec: `docs/specs/SPEC-012-landing-page-editor.md`. ADRs: 0015 (Supabase rascunho),
> 0017 (pacote `@b2tech/lp-render`). O bloco de deploy reusa o **Passo 9** de
> `create-landing-page-brunobracaioli` (mesma mecânica de Cloudflare/DNS/SSL).

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Roda **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano, a sessão entra em deadlock. Em qualquer
   dúvida/erro: **decida sozinho** com os defaults abaixo, registre no manifest (Passo 8) e
   **siga em frente** — ou aborte com `verified:false` se for impossível prosseguir.
2. **Cliente é fixo: `brunobracaioli`.** Não generalize.
3. **Supabase é via REST/curl com `SUPABASE_SECRET_KEY` (service_role).** **NÃO** use o MCP
   do Supabase: ele é OAuth-gated e **não autentica no runner headless**. Toda leitura/escrita
   no banco usa `curl` no endpoint REST (mesmo padrão de `scripts/poll-agent-jobs.sh`).
4. **Deploy só via `wrangler` + API CF (Bash).** Segredos CF (`CLOUDFLARE_API_TOKEN`/
   `ACCOUNT_ID`) e a `SUPABASE_SECRET_KEY` **nunca** vão para manifest, logs, stdout,
   `operation_logs`, ou qualquer arquivo. Nunca os ecoe.
5. **Esta skill NÃO gera conteúdo.** Não chama subagents de copy/arquitetura/imagem. Se o
   rascunho não tem seções, aborta (`verified:false`) — geração é a `create-landing-page-*`.
6. **`noindex`:** se o rascunho/arg pedir preview, mantenha `noindex` ligado. Go-live
   (`noindex=0`) é build-time → esta skill rebuilda com o valor pedido.

---

## 2. Argumentos

Args via `$ARGUMENTS` (`key=value`):

| Arg | Obrigatório | Default | Descrição |
|---|---|---|---|
| `landing_page_id` | sim* | — | UUID da LP em `landing_pages`. Forma primária (a fila passa este). |
| `nome` | sim* | — | Alternativa: subdomínio (`landing_pages.subdomain`) p/ lookup se não vier `landing_page_id`. |
| `noindex` | não | (valor do rascunho) | `0` = indexável (go-live), `1` = preview. Sobrescreve `settings.noindex`. |
| `overwrite` | não | `true` | Republicar a própria LP é autorizado por padrão (ver Passo 6.0). |

\* Pelo menos um de `landing_page_id` **ou** `nome`. Sem nenhum → manifest `verified:false`.

**Validação:** `landing_page_id =~ ^[0-9a-fA-F-]{32,36}$`; `nome =~ ^[a-z0-9-]{2,40}$`;
`noindex =~ ^[01]$`. Inválido → `verified:false` e sair.

---

## 3. Defaults autônomos

| Decisão | Valor | Por quê |
|---|---|---|
| Stack | Next.js 15 **static export** (`out/` flat) | ADR 0012 (idêntico à geração) |
| Template | `landing-pages/_template/` → `landing-pages/<subdomain>/` | Scaffold se ausente |
| Serializer | `packages/lp-render/serialize-cli.ts` via **`tsx`** | ADR 0017; `node` puro não resolve os imports `.ts` extensionless do pacote |
| Fonte do conteúdo | **Supabase** (`settings`+`theme`+`landing_page_sections`) | SPEC-012; nada inventado |
| `overwrite` | `true` | A LP **é dona** do subdomínio (carregada por id) → redeploy é intencional |

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- `REPO="$(pwd)"` (o runner faz `cd /app`; localmente, raiz do repo). Guarde — você vai
  `cd` para dirs de LP e precisa de caminhos absolutos para o serializer.
- **Env:** carregue `.env.local` se existir (strip de CR); senão confie no ambiente (no
  runner, `SUPABASE_URL`/`SUPABASE_SECRET_KEY`/`CLOUDFLARE_*` já são secrets do Fly):
  ```bash
  [ -f .env.local ] && set -a && eval "$(tr -d '\r' < .env.local)" && set +a || true
  SUPABASE_URL="$(printf '%s' "${SUPABASE_URL:-}" | tr -d '[:space:]')"
  SUPABASE_KEY="$(printf '%s' "${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}" | tr -d '[:space:]')"
  CF_TOKEN="$(printf %s "${CLOUDFLARE_API_TOKEN:-}" | tr -d '[:space:]')"
  REST="${SUPABASE_URL%/}/rest/v1"
  ```
  Se `SUPABASE_URL`/`SUPABASE_KEY` vazios → `verified:false` (`errors:["supabase creds ausentes"]`), sair.
- Parse dos args; aplicar defaults/validações da §2.
- `TRY_DIR=tentativas-geracao-de-campanhas`; `mkdir -p ${TRY_DIR}`.
- `GEN=$(mktemp -d)` para artefatos intermediários (contentdoc.json etc.).

> **Helper REST (use em todas as chamadas ao Supabase):** sempre mande os headers
> `apikey: ${SUPABASE_KEY}` e `Authorization: Bearer ${SUPABASE_KEY}`, `--max-time 15`,
> e trate corpo vazio/erro como falha transitória (re-tente 1x antes de abortar).

### Passo 1 — Carregar o rascunho do Supabase (REST)
1. **Linha da LP** — por id (preferido) ou por subdomínio:
   ```bash
   SEL="id,client_id,subdomain,fqdn,url,cloudflare_project_id,settings,theme,noindex,cart_state,draft_status,product_id,content_spec"
   if [ -n "${landing_page_id}" ]; then
     ROW=$(curl -fsS "${REST}/landing_pages?id=eq.${landing_page_id}&select=${SEL}" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 15)
   else
     ROW=$(curl -fsS "${REST}/landing_pages?subdomain=eq.${nome}&select=${SEL}" \
       -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 15)
   fi
   echo "${ROW}" | jq -e '.[0].id' >/dev/null || { echo "LP não encontrada"; }  # → verified:false se vazio
   ```
   - Vazio/`[]` → manifest `verified:false` (`errors:["landing page não encontrada"]`), sair.
   - Extraia: `LP_ID=.[0].id`, `CLIENT_ID=.[0].client_id`, `SUB=.[0].subdomain`,
     `CF_PROJECT=.[0].cloudflare_project_id // "b2tech-"+SUB`, `SETTINGS=.[0].settings`,
     `THEME=.[0].theme`. Salve `SETTINGS`/`THEME` em `${GEN}/settings.json` / `${GEN}/theme.json`.
   - **Validação do rascunho:** `SETTINGS` precisa ter ao menos `subdomain`, `site_url`,
     `seo`, `tracking`, `checkout_url`, `price_cents`, `cart_state`, `noindex`, `cartClosed`.
     Se `SETTINGS` for `{}` (LP nunca gerada/configurada) → `verified:false`
     (`errors:["settings vazio — rode a geração antes de publicar"]`), sair.
2. **Marcar `draft_status='publishing'`** (PATCH; sinaliza ao dashboard):
   ```bash
   curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
     -d '{"draft_status":"publishing"}' >/dev/null
   ```
   **A partir daqui, qualquer abort DEVE** repor `draft_status='ready'` e `status='failed'`
   antes de sair (ver Passo 7 / Anti-padrões).
3. **Seções (blocos)** ordenadas por `position`:
   ```bash
   curl -fsS "${REST}/landing_page_sections?landing_page_id=eq.${LP_ID}&select=type,position,enabled,fields&order=position.asc" \
     -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 15 \
     > ${GEN}/sections.json
   ```
   - `[]` (zero blocos) → repor `draft_status='ready'`, manifest `verified:false`
     (`errors:["sem seções para publicar"]`), sair.

### Passo 2 — Montar o ContentDoc
Combine os três pedaços no shape de `packages/lp-render/src/content-doc.ts`:
```bash
jq -n \
  --slurpfile s ${GEN}/settings.json \
  --slurpfile t ${GEN}/theme.json \
  --slurpfile sec ${GEN}/sections.json \
  '{settings: $s[0], theme: $t[0], sections: $sec[0]}' > ${GEN}/contentdoc.json
```
- **Override de `noindex`** (se o arg foi passado): edite `settings.noindex` no doc:
  ```bash
  if [ -n "${noindex_arg}" ]; then
    NI=$([ "${noindex_arg}" = "1" ] && echo true || echo false)
    jq --argjson ni "${NI}" '.settings.noindex=$ni' ${GEN}/contentdoc.json > ${GEN}/cd.tmp && mv ${GEN}/cd.tmp ${GEN}/contentdoc.json
  fi
  NOINDEX_FLAG=$(jq -r '.settings.noindex' ${GEN}/contentdoc.json)   # true|false
  ```

### Passo 3 — Scaffold + serializar para arquivos
- `LP_DIR="${REPO}/landing-pages/${SUB}"`.
- **Scaffold** se ausente (cópia do template, que já traz `node_modules` pré-bakeado no
  runner — inclui `tsx` e o symlink `@b2tech/lp-render`):
  ```bash
  if [ ! -f "${LP_DIR}/package.json" ]; then
    mkdir -p "${LP_DIR}"
    cp -r "${REPO}/landing-pages/_template/." "${LP_DIR}/"
    rm -rf "${LP_DIR}/out" "${LP_DIR}/.next"
  fi
  ```
- **Serializar** (rodando o `tsx` do `_template`, que sempre existe — robusto mesmo se um
  `LP_DIR` antigo não tiver `tsx`). O serializer escreve `messages/pt.json`,
  `content-spec.json` e `app/theme.css` dentro do `LP_DIR`:
  ```bash
  ( cd "${REPO}/landing-pages/_template" \
    && node --import tsx "${REPO}/packages/lp-render/serialize-cli.ts" \
         "${GEN}/contentdoc.json" "${LP_DIR}" )
  ```
  Confirme que `${LP_DIR}/messages/pt.json`, `${LP_DIR}/content-spec.json` e
  `${LP_DIR}/app/theme.css` existem. Falha aqui → abort (Passo 7).

### Passo 4 — Importar o `theme.css` no layout do CLONE (idempotente)
O `_template` **não** importa `theme.css` (mantém o build do template byte-a-byte). O CLONE
precisa importar o `app/theme.css` (tokens por-LP) **logo depois** do `globals.css` para que
o `:root` sobreponha os defaults. Faça **só no clone**, idempotente:
- Leia `${LP_DIR}/app/layout.tsx`. Se **não** contém `import "./theme.css";`, insira essa
  linha **imediatamente após** `import "@b2tech/lp-render/globals.css";` (use `Edit`).
- Se já contém (republish) → não faça nada.

### Passo 5 — Assets (best-effort, bounded)
A geração (skill `create-*` Passo 6) e o editor persistem imagens no bucket **público**
`landing-assets` e gravam **URLs absolutas** em `fields.image` (hero/authority/problem/solution/
features/proof) e `settings.seo.ogImage`. Como o bucket é público, o `<img src="https://…/
landing-assets/…">` do export estático **carrega direto do Storage no browser** — o build **não
precisa** de arquivo local para essas imagens. Portanto:
- **Preserve** o `${LP_DIR}/public/` existente (hero/og/instrutor de uma geração na mesma
  máquina). **Não** clobber. Não é obrigatório baixar nada — URLs absolutas já renderizam.
- **Back-compat (best-effort):** se o doc serializado ainda referenciar uma URL de Storage do
  `landing-assets`, espelhe-a em `${LP_DIR}/public/` com o basename (cobre conteúdo legado que
  usa caminho relativo). Falha de download **não** aborta:
  ```bash
  mkdir -p "${LP_DIR}/public"
  grep -rhoE 'https?://[^"]+/storage/v1/object/public/landing-assets/[^"]+\.(png|jpe?g|webp|avif)' \
    "${LP_DIR}/messages/pt.json" "${LP_DIR}/content-spec.json" 2>/dev/null | sort -u | \
  while IFS= read -r url; do
    base=$(basename "${url%%\?*}")
    [ -f "${LP_DIR}/public/${base}" ] || curl -fsS --max-time 30 -o "${LP_DIR}/public/${base}" "${url}" || true
  done
  ```
- Imagens faltantes (`/hero.png`, `/og.png`, `/instrutor.jpg`) **não** quebram o build
  (`images.unoptimized`); a página degrada graciosamente.

### Passo 6 — Build local
Em `${LP_DIR}`:
- Se `node_modules/` **não** existe: `npm ci --include=dev` (ou `npm install`). **`--include=dev`
  é obrigatório** (`tsc`/`next`/`tsx` são devDeps; `NODE_ENV=production` os pularia).
- **NÃO** rode `tsc --noEmit` aqui: o build per-LP **não type-checka** por design (artefato
  gerado; tipos são gateados na fonte — ADR 0017). O conteúdo é dado (JSON), não código.
- Build: `NEXT_PUBLIC_NOINDEX=$([ "${NOINDEX_FLAG}" = "true" ] && echo 1 || echo 0) npx next build`.
- Verifique `out/index.html`, `out/sitemap.xml`, `out/robots.txt`. Com `noindex` ligado,
  `out/robots.txt` deve conter `Disallow: /`. Falha → abort (Passo 7).

### Passo 6.0 — Autorização de deploy (diferente da geração)
A `create-landing-page-*` **recusa** sobrescrever um projeto CF vivo (guard anti-clobber),
porque um `nome` arbitrário poderia colidir com outra página. **Aqui é o oposto**: a LP foi
carregada de `landing_pages` **por id/subdomínio**, então ela **é a dona** de
`<SUB>.b2tech.io` — republicar é a função desta skill. **Não** aborte por "já existe deploy".
(Só respeite `overwrite=false` se for explicitamente passado para um dry-run — então pule o
deploy e marque `deploy.deployed:false` no manifest.)

### Passo 7 — Deploy no Cloudflare Pages
Mesma mecânica do **Passo 9** de `create-landing-page-brunobracaioli` (ver lá os detalhes/
gotchas de DNS/SSL). Use `CF_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. Em `${LP_DIR}`:
```bash
PROJ="${CF_PROJECT}"   # geralmente b2tech-${SUB}
# 1) projeto (idempotente)
CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  npx wrangler pages project create "${PROJ}" --production-branch=main || true
# 2) deploy
CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  npx wrangler pages deploy out --project-name="${PROJ}" --branch=main
#    → capture o deployment id e a URL *.pages.dev do stdout
# 3) bind do custom domain
curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJ}/domains" \
  -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
  --data "{\"name\":\"${SUB}.b2tech.io\"}"
# 4) CNAME explícito (o bind NÃO auto-cria; token tem escopo Zone DNS Edit) — idempotente
ZID=$(curl -sS "https://api.cloudflare.com/client/v4/zones?name=b2tech.io" \
  -H "Authorization: Bearer ${CF_TOKEN}" | jq -r '.result[0].id')
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${ZID}/dns_records" \
  -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
  --data "{\"type\":\"CNAME\",\"name\":\"${SUB}\",\"content\":\"${PROJ}.pages.dev\",\"proxied\":true,\"ttl\":1}"
# 5) SSL bounded (~8x/20s); *.pages.dev já fica 200 no deploy
for i in $(seq 1 8); do
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" "https://${SUB}.b2tech.io/" || echo 000)
  [ "$CODE" = "200" ] && { SSL=active; break; } || { SSL=pending; sleep 20; }
done
```
- `200` → `ssl=active`; senão `ssl=pending` (não é falha). Resolver local lento (WSL) pode
  mascarar DNS já propagado — confirme via `*.pages.dev` antes de concluir `error`.
- **Falha real do `wrangler deploy`** (não DNS/SSL) → abort (Passo 7-abort): repor
  `draft_status='ready'`, `status='failed'`, manifest `verified:false`.

### Passo 8 — Persistir o publish no Supabase (REST PATCH)
Grave o snapshot publicado e o estado do deploy. `published_snapshot` é o **ContentDoc exato**
(auditoria / rollback / diff). Monte o corpo com `jq` (embute o doc) e PATCH:
```bash
BODY=$(jq -n \
  --slurpfile doc ${GEN}/contentdoc.json \
  --arg dep "${DEPLOY_ID:-}" --arg ssl "${SSL:-pending}" \
  --argjson ni $([ "${NOINDEX_FLAG}" = "true" ] && echo true || echo false) \
  '{
     status: "deployed",
     draft_status: "ready",
     noindex: $ni,
     ssl_status: $ssl,
     last_deploy_id: $dep,
     deployed_at: (now | todate),
     published_at: (now | todate),
     published_snapshot: $doc[0],
     content_spec: ($doc[0].settings)   # read-model leve p/ dashboard; snapshot completo fica em published_snapshot
   }')
curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
  -d "${BODY}" >/dev/null
```
- **`operation_logs`** — uma linha (sem segredos):
  ```bash
  curl -fsS -X POST "${REST}/operation_logs" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
    -d "$(jq -nc --arg c "${CLIENT_ID}" --arg e "${LP_ID}" --arg s "LP ${SUB}.b2tech.io publicada (noindex=${NOINDEX_FLAG}, ssl=${SSL})" \
        '{client_id:$c, entity_type:"landing_page", entity_id:$e, action:"update", actor:"claude-code", summary:$s}')" >/dev/null
  ```

### Passo 8-abort — Reposição em caso de falha (obrigatório)
Se abortar **após** o Passo 1.2 (já marcou `publishing`), antes de sair **sempre**:
```bash
curl -fsS -X PATCH "${REST}/landing_pages?id=eq.${LP_ID}" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" --max-time 15 \
  -d '{"draft_status":"ready","status":"failed"}' >/dev/null
```
E grave o manifest `verified:false` com `errors[]`.

### Passo 9 — Manifest + resumo
- Manifest em `${TRY_DIR}/${STAMP}-landing-publish.json` (**sempre**, sucesso ou falha):
  ```json
  {
    "skill": "publish-landing-page-brunobracaioli",
    "client": "brunobracaioli",
    "date": "${DATE}",
    "verified": true,
    "landing_page_id": "${LP_ID}",
    "subdomain": "${SUB}",
    "url": "https://${SUB}.b2tech.io",
    "pages_dev_url": "https://${CF_PROJECT}.pages.dev",
    "cloudflare_project": "${CF_PROJECT}",
    "repo_path": "landing-pages/${SUB}",
    "sections_published": <n>,
    "deploy": {"deployed": true, "ssl": "active|pending", "deployment_id": "..."},
    "noindex": <true|false>,
    "source": "supabase-draft",
    "errors": []
  }
  ```
  **Nunca** inclua segredos (CF token, Supabase key).
- Stdout: URL, projeto CF, SSL, `noindex`, nº de seções; e se `noindex=true`:
  **"Publicado em PREVIEW (noindex). Go-live = republicar com `noindex=0`."**

---

## 5. Critério de sucesso
- ContentDoc lido do Supabase (`settings`+`theme`+`landing_page_sections`).
- `${LP_DIR}/{messages/pt.json,content-spec.json,app/theme.css}` gerados pelo serializer.
- `out/{index.html,sitemap.xml,robots.txt}` gerados; com `noindex` → `Disallow: /`.
- `https://<SUB>.b2tech.io/` → `200` (ou `ssl_pending` documentado).
- `landing_pages` atualizada: `status='deployed'`, `draft_status='ready'`, `published_at`,
  `published_snapshot=<ContentDoc>`, `last_deploy_id`, `ssl_status` + 1 `operation_logs`.
- Manifest JSON em `${TRY_DIR}/`.

## 6. Anti-padrões (NÃO faça)
- ❌ `AskUserQuestion` / parar para perguntar.
- ❌ Usar o **MCP do Supabase** (não autentica headless) — só REST/curl.
- ❌ Gerar copy/arquitetura/imagem (isso é da `create-landing-page-*`); aqui só publica.
- ❌ Ecoar/commitar `CLOUDFLARE_API_TOKEN` ou `SUPABASE_SECRET_KEY`.
- ❌ Importar `theme.css` no `_template` (quebraria a identidade byte-a-byte do template) —
  só no CLONE.
- ❌ Abortar por "projeto CF já tem deploy": republish é a função desta skill (Passo 6.0).
- ❌ Rodar `tsc` no build per-LP (o build não type-checka por design — ADR 0017).
- ❌ Sair com `draft_status='publishing'` preso após uma falha (sempre reponha — Passo 8-abort).
- ❌ Rodar o serializer com `node` puro (sem `tsx`): os imports `.ts` extensionless do pacote
  não resolvem (`ERR_MODULE_NOT_FOUND`).
- ❌ Generalizar para outros clientes.

## 7. Gotchas obrigatórios
- **`tsx` para o serializer.** `node packages/lp-render/serialize-cli.ts` **falha**
  (`ERR_MODULE_NOT_FOUND` nos imports `./src/...` sem extensão). Use
  `node --import tsx <...>/serialize-cli.ts`. O `tsx` está nas devDeps do `_template`
  (pré-bakeado na imagem Fly). Rode com `cwd` no `_template` (sempre tem `tsx`).
- **Supabase headless = REST/curl.** `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (service_role,
  bypassa RLS). Strip de CR/espaço nas duas (um secret de fonte CRLF carrega `\r` e quebra a
  URL). MCP do Supabase é OAuth-gated → não serve aqui.
- **`output:'export'`** — sem API routes/server actions/middleware/ISR; `images.unoptimized`.
  O serializer só produz dados (JSON/CSS), nunca código.
- **`NEXT_PUBLIC_NOINDEX` é build-time** — flip exige rebuild+redeploy (é exatamente o que
  esta skill faz). Default = valor do rascunho (`settings.noindex`).
- **CNAME NÃO é auto-criado pelo bind** (validado 2026-06-02) — crie explícito (Passo 7.4).
  SSL provisiona async (~5-15 min; `pending` ≠ falha). Resolver WSL lento pode mascarar DNS
  propagado — confirme via `*.pages.dev`.
- **`wrangler` headless** — env `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (não
  `wrangler login`). Token com CRLF → 401 silencioso: sempre `tr -d '[:space:]'`.
- **Scaffold preserva `node_modules` do `_template`** (com `tsx` + symlink `@b2tech/lp-render`)
  via `cp -r _template/. ${LP_DIR}/` — evita `npm ci` lento na run.

## 8. Pré-requisitos
- Env: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`; para deploy `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` (secrets do Fly no runner; `.env.local` localmente).
- Migrations da SPEC-012 aplicadas (`landing_page_sections`, `landing_pages.{settings,theme,
  draft_status,published_snapshot,...}`) — já em prod (2026-06-03).
- A LP **já existe** em `landing_pages` com `settings` preenchido e ≥1 `landing_page_sections`
  (a `create-landing-page-*` cria; sem isso, esta skill aborta).
- `packages/lp-render/serialize-cli.ts` + `_template` com `tsx` nas devDeps (na imagem Fly).
- `landing-pages/_template/` presente (com `node_modules` no runner).
