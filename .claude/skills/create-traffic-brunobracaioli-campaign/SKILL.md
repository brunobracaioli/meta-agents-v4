---
name: create-traffic-brunobracaioli-campaign
description: Cria de forma 100% autônoma e headless uma campanha de tráfego Meta Ads (CBO, Advantage+) para o cliente brunobracaioli — scrape da landing, geração de 3 criativos, campanha + adset + 3 ads PAUSED via MCP da Meta, persistência no Supabase e manifest. Use quando pedirem "criar campanha de tráfego para brunobracaioli/CCA", ou quando disparada via cron/headless (`claude -p --dangerously-skip-permissions ".claude/skills/create-traffic-brunobracaioli-campaign"`).
argument-hint: "[url=https://cca.b2tech.io] [budget-cents=5000] [optimization=LANDING_PAGE_VIEWS] [n-creatives=3]"
allowed-tools: Read, Bash, Glob, Write, Agent, mcp__claude_ai_MCP_META_ADS_B2_TECH__meta_token_status, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ad_accounts, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_campaign, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_adset, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_creative, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_ad, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_campaigns, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_adsets, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ads, mcp__supabase__execute_sql, mcp__supabase__list_tables
---

# Skill: /create-traffic-brunobracaioli-campaign

Cria, **de ponta a ponta e sem intervenção humana**, uma campanha de tráfego no
Meta Ads para o cliente **brunobracaioli** (produto: Claude Code Architect — CCA):
scrape da landing → 3 criativos (imagem + copy) → **campanha CBO + 1 ad set
Advantage+ + 3 ads, tudo PAUSED** → persistência no Supabase → manifest da run.

> Esta skill é o contrato que o runner Fly.io (`docs/specs/flyio-cron-campaign-runner.md`)
> dispara 1×/dia às 10h BRT. **Toda a inteligência está aqui**; o runner é uma
> casca fina (`timeout 1500 claude -p --dangerously-skip-permissions ...`).

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Esta skill roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano para responder, a sessão entra em
   deadlock. Em qualquer dúvida ou erro: **decida sozinho** usando os defaults da
   §3, registre a decisão no manifest (§ passo 8) e **siga em frente**. Nunca pare
   para perguntar.
2. **Resolva erros por conta própria, end-to-end.** Os modos de falha conhecidos e
   suas correções estão na §7 (Gotchas) e nos passos. Se aparecer um erro novo,
   diagnostique pela resposta da tool (`error_user_msg`/subcode) e por `list_ads`/`list_adsets`
   (`effective_status`), aplique a correção mais provável e continue. Só aborte se for impossível prosseguir sem gastar verba ou
   violar um limite duro — e mesmo aí, **grave o manifest com `verified:false`** antes
   de sair, explicando o bloqueio.
3. **Cliente é fixo: `brunobracaioli`.** Não generalize para outros clientes.
4. **Meta só via MCP da Meta** (CLAUDE.md). **Persista tudo no Supabase via MCP.**
5. **Limites duros (defesa em profundidade):**
   - Orçamento ≤ **5000 cents/dia** (R$50). Nunca exceda, mesmo se um argumento pedir.
   - **Tudo nasce PAUSED. NUNCA** ative (não chame `update_campaign/update_adset/update_ad`
     com `status="ACTIVE"`; aliás, tools de update nem estão no allowed-tools). Custo Meta = 0
     até um humano ativar manualmente. Esta skill **não ativa nada**, sob nenhuma condição.
   - Prefira **reusar** criativos já gerados hoje a regerar (respeita o cap de LLM
     `WORKFLOW_LLM_BUDGET_USD_CAP=2.00` e o custo de imagem).

---

## 2. Constantes do cliente

Fonte de verdade: `.claude/skills/lista-de-clientes/SKILL.md` (+ `docs/reference/runner-reference.md` §7).
No início da run, faça lookup da linha `clients WHERE slug='brunobracaioli'` no Supabase
para obter o `client_id` (uuid) — **não hardcode o uuid**.

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Ad Account | `225179730538661` (alias `act_225179730538661`) |
| Business Manager | `772813643612039` |
| Facebook Page | `867347659802006` |
| Landing default | `https://cca.b2tech.io` |
| Budget cap | `5000` cents (R$50/dia) · moeda `BRL` |
| Materiais | `.claude/materiais-das-empresas/brunobracaioli/` |
| Bucket público (ingestão Meta) | `ad-ingest` (ADR 0003) |

---

## 3. Defaults autônomos (decisões já tomadas — não reabrir)

| Decisão | Valor | Por quê |
|---|---|---|
| Objetivo | `OUTCOME_TRAFFIC` | Campanha de tráfego |
| Buying type | `AUCTION` | Padrão |
| Budget mode | **CBO** (budget na campanha) | Padrão do projeto |
| Daily budget | `5000` cents | Cap do cliente |
| Bid strategy | `LOWEST_COST_WITHOUT_CAP` | Maior volume / autobid |
| Otimização do ad set | `LANDING_PAGE_VIEWS` → **fallback `LINK_CLICKS`** | Tráfego de qualidade; cai p/ clicks se a Meta recusar |
| Billing event | `IMPRESSIONS` | Padrão |
| Destino | `WEBSITE` → landing | — |
| **Geo** | `["US"]` | **BR bloqueado** — ver §7 |
| Advantage+ Público | `targeting_automation.advantage_audience: 1` | Pedido padrão |
| Advantage+ Posicionamentos | **omitir `placement`/`publisher_platforms`** | Sem placement spec = Advantage+ placements |
| CTA | `LEARN_MORE` (todos os ads) | — |
| Nº de criativos | `3` — ângulos **autoridade / dor / oferta** (v1/v2/v3) | — |
| Status final | **PAUSED** (campanha, ad set e ads) | Custo zero até ativação manual |

**Naming** (data em `America/Sao_Paulo`, `DATE=YYYY-MM-DD`):
- Campanha: `[TRF][CCA][${DATE}] Tráfego CBO — US`
- Ad set: `[TRF][CCA] adset — US — Advantage+ — LPV — ${DATE}`
- Ads: `[TRF][CCA] v1 Autoridade — ${DATE}` / `v2 Dor` / `v3 Oferta`

**Overrides opcionais** via `$ARGUMENTS` (`key=value`): `url`, `budget-cents`
(clamp a ≤5000), `optimization`, `n-creatives`. Sem argumentos → usa os defaults acima.

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- Carregar env: `set -a && eval "$(tr -d '\r' < .env.local)" && set +a` (raiz do projeto;
  precisa de `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
- Definir paths: `ADS_DIR=.claude/materiais-das-empresas/brunobracaioli/generated-ads/cca-${DATE}`
  e `TRY_DIR=tentativas-geracao-de-campanhas`. Criar ambos (`mkdir -p`).
- Parse de overrides do `$ARGUMENTS`; aplicar defaults da §3; **clampar budget a 5000**.

### Passo 1 — Validar conexão Meta
- (Opcional) `meta_token_status` → exigir `is_valid:true` com scope `ads_management`.
- `list_ad_accounts` → confirmar `225179730538661` ativo (`account_status:1`), moeda `BRL`.
- Page `867347659802006` é **constante do cliente** (não há tool de listagem de páginas no
  MCP novo) — use direto no `create_creative`.
- Se a conta não responder ou MCP estiver indisponível → gravar manifest `verified:false`
  com o erro e sair (nada criado, custo zero).

### Passo 2 — Criativos (gerar fresco + reusar SOMENTE no mesmo dia)
**Idempotência (vale apenas para o diretório de HOJE):** se `${ADS_DIR}` já tem
`ad-v1-autoridade.png`, `ad-v2-dor.png`, `ad-v3-oferta.png` **e** `public-urls.txt`
→ **reuse**: leia as URLs públicas e a copy (`prompt-vN.txt` / registros no Supabase)
e pule para o Passo 3. Não regere. **Telemetria do reuse (obrigatória)** — o HUD ao
vivo só mostra atividade que vira `agent_events`; ao pular a cadeia, insira 1 evento
sintético para a interface não ficar cega:
```bash
curl -sS -X POST "${SUPABASE_URL}/rest/v1/agent_events" \
  -H "apikey: ${SUPABASE_SECRET_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"run_id\":\"${AGENT_JOB_ID:-cron-${STAMP}}\",\"agent_name\":\"criativos\",\"agent_type\":\"skill\",\"event_type\":\"step\",\"summary\":\"reusando os criativos já aprovados de hoje (idempotência)\"}"
```

Senão, a cadeia de subagentes abaixo é **OBRIGATÓRIA** (igual ao `/create-campaign`)
— rode os itens 1–3 completos. **NUNCA pule a cadeia reaproveitando copy/prompt de
dias anteriores** (de `generated-ads/cca-*` antigos ou dos registros no Supabase):
isso cega o HUD ao vivo (sem chamada `Task` no stream → nenhum subagent aparece na
interface) e congela os criativos, acelerando fadiga. Material de dias anteriores
entra só como ÂNCORA DE QUALIDADE no item de prompt abaixo — nunca como substituto
da cadeia.
1. `Agent(subagent_type="scrape-extractor")` com a `url` → `scrape.json` (tema, value
   prop, CTA, tom, paleta).
2. Para cada ângulo (`autoridade`, `dor`, `oferta`):
   - `Agent(subagent_type="copywriter")` com `{scrape, objective:"OUTCOME_TRAFFIC",
     configHints:{brandName:"Claude Code Architect", angle:<ângulo>}}` → `headline`
     (≤40), `primaryText` (≤250), `description` (≤30), `callToActionType`
     (force `LEARN_MORE`).
   - **Refs canônicas (OBRIGATÓRIO usar as 6, nesta ordem)** — set pré-redimensionado
     ≤1MB em `REFS_DIR=.claude/materiais-das-empresas/brunobracaioli/refs-canonicas/`:
     `01-logo.png`, `02-bruno-retrato.jpg`, `03-estilo-meta-team-agents.jpg`,
     `04-estilo-pipeline-equipe-tecnica.jpg`, `05-estilo-pipeline-equipe-conteudo.jpg`,
     `06-estilo-comunidade-fomo.jpg`. NÃO use os originais de `logo/` e
     `exemplo-de-ads/` (excedem 1MB e são descartados pelo validador).
   - `Agent(subagent_type="image-prompt-generator")` com `{scrape, aspectRatio:"1080x1080",
     referenceImagePaths:[ as 6 refs canônicas acima, na ordem ],
     configHints:{brandName:"Claude Code Architect", lastApprovedPrompt:<conteúdo do
     `prompt-vN.txt` do MESMO ângulo no `generated-ads/cca-*` mais recente, se
     existir — âncora de qualidade: manter o mesmo nível de direção de arte e os
     elementos que funcionaram, SEM copiar verbatim>}}` → `prompt`. (O agente tem o
     preset de marca brunobracaioli: navy `#0A0F1A`→`#0E1422` + laranja `#FF6B1A`,
     rosto do Bruno + 3-6 bichinhos pixel-art laranja trabalhando + headline forte
     são OBRIGATÓRIOS em todo criativo.)
   - `Skill(skill="image-generate", args="prompt-file=<prompt> aspect=1:1
     refs=<as mesmas 6 refs canônicas, separadas por vírgula, na ordem>
     out-dir=${ADS_DIR} out-name=ad-v<N>-<ângulo>")` → PNG 1024×1024. As refs vão
     pro `/v1/images/edits` do gpt-image-2 — sem elas o modelo não tem o rosto do
     Bruno nem o padrão visual dos exemplos, e o criativo sai off-brand. Salve
     também `prompt-vN.txt` e `log-vN.txt`.
   - **Gate visual antes do upload**: `Read` o PNG gerado e confira: rosto do Bruno
     presente e fiel; 3+ bichinhos laranja visíveis; paleta navy/preto + laranja
     (NUNCA verde/vermelho/azul dominante); headline legível; faixa/botão CTA
     laranja. Se falhar qualquer item, regere 1× (mesmo prompt). Se falhar de novo,
     regere com prompt reforçado no item ausente. Máx 3 tentativas por criativo;
     persista a melhor e anote o desvio no manifest.
3. **Upload para o bucket público `ad-ingest`** (o fetcher do Meta NÃO baixa bucket
   privado — ADR 0003). Para cada PNG, com `RAND=$(openssl rand -hex 10)` por dia:
   ```bash
   PREFIX="brunobracaioli/cca-${DATE}/${RAND}"
   # SUPABASE_SECRET_KEY é formato novo `sb_secret_` (NÃO-JWT): tem que ir no header
   # `apikey`. Só `Authorization: Bearer` dá 403 "Invalid Compact JWS".
   curl -sS -X POST "${SUPABASE_URL}/storage/v1/object/ad-ingest/${PREFIX}/ad-v${N}-${ANGLE}.png" \
     -H "apikey: ${SUPABASE_SECRET_KEY}" -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
     -H "Content-Type: image/png" --data-binary @"${ADS_DIR}/ad-v${N}-${ANGLE}.png"
   # URL pública resultante:
   # ${SUPABASE_URL}/storage/v1/object/public/ad-ingest/${PREFIX}/ad-v${N}-${ANGLE}.png
   ```
   Grave `${ADS_DIR}/public-urls.txt` no formato:
   ```
   PUBLIC_PREFIX=brunobracaioli/cca-${DATE}/${RAND}
   URL_ad-v1-autoridade=https://.../public/ad-ingest/${PREFIX}/ad-v1-autoridade.png
   URL_ad-v2-dor=...
   URL_ad-v3-oferta=...
   ```
   Confirme cada URL com `curl -sS -o /dev/null -w "%{http_code} %{content_type}"` → deve
   ser `200 image/png` antes de usar no ad.

### Passo 3 — Criar a campanha (PAUSED)
`create_campaign` (conta = `account_id="225179730538661"`):
- `name=[TRF][CCA][${DATE}] Tráfego CBO — US`, `objective="OUTCOME_TRAFFIC"`,
  `special_ad_categories=[]`, `status="PAUSED"`.
- **CBO**: `daily_budget=5000` (cents, int) na campanha, `bid_strategy="LOWEST_COST_WITHOUT_CAP"`.
- A resposta vem como `{"id":"<meta_campaign_id>","success":true}` — guardar o `id`.

### Passo 4 — Criar o ad set (PAUSED)
`create_adset` (`account_id="225179730538661"`, `campaign_id=<meta_campaign_id>`):
- `name=[TRF][CCA] adset — US — Advantage+ — LPV — ${DATE}`, `status="PAUSED"`.
- **Sem `daily_budget`** (CBO controla na campanha).
- `optimization_goal="LANDING_PAGE_VIEWS"`, `billing_event="IMPRESSIONS"`,
  `destination_type="WEBSITE"`.
- `targeting={"geo_locations":{"countries":["US"]},"targeting_automation":{"advantage_audience":1}}`
  — **sem** `publisher_platforms`/`placement` (= Advantage+ posicionamentos).
- Se a Meta recusar `LANDING_PAGE_VIEWS` → **recriar** o ad set com `optimization_goal="LINK_CLICKS"`
  (não há `update` no allowed-tools; o ad set recusado não cria objeto órfão).
- Se a Meta exigir geo BR ou der subcode `3858634` → manter `["US"]` (§7).
- Guardar o `id` da resposta como `meta_ad_set_id`.

### Passo 5 — Criar os 3 criativos + 3 ads (PAUSED) — fluxo de 2 etapas
O MCP novo tem `create_creative`, que **aceita `image_url` público DIRETO** (monta o
`object_story_spec` internamente) e devolve um `creative_id`. Então, **para cada ângulo**,
são **2 chamadas**:

**5a. `create_creative`** (`account_id="225179730538661"`):
- `name=[TRF][CCA] creative vN <ângulo> — ${DATE}`, `page_id="867347659802006"`,
  `link="https://cca.b2tech.io"`, `message=<primaryText>`,
  `image_url=<URL pública do ad-ingest>` (a `URL_ad-vN-…` do `public-urls.txt`, já `200 image/png`),
  `headline=<headline>`, `description=<description>`, `cta_type="LEARN_MORE"`.
- A resposta `{"id":"<creative_id>","success":true}` → guardar `creative_id` (= `meta_creative_id`).

**5b. `create_ad`** (`account_id="225179730538661"`, `adset_id=<meta_ad_set_id>`):
- `creative_id=<creative_id do 5a>`, `name=[TRF][CCA] vN <ângulo> — ${DATE}`, `status="PAUSED"`.
- A resposta `{"id":"<meta_ad_id>","success":true}` → guardar `meta_ad_id`.

São independentes por ângulo ⇒ os 3 creatives podem ir em **paralelo**, e depois os 3 ads.
Não há mais workaround de `link_data.picture` (§7) — `image_url` no `create_creative` resolve.

### Passo 6 — Validar e auto-resolver
O MCP novo **não tem** `ads_get_errors`/`ads_get_field_context`. Valide pelas respostas das
tools (cada `create_*` retorna `success:true` + `id`, ou um erro com `error_user_msg`/subcode)
e por `list_ads(account_id="225179730538661")`:
  - `effective_status="IN_PROCESS"` nos ads é **normal** (Meta ingerindo a imagem) — não é erro.
  - `effective_status="WITH_ISSUES"` → inspecionar o motivo; se for imagem, reconferir que a
    `image_url` é pública (`200 image/png`) e recriar o creative+ad.
  - Erro de geo / subcode `3858634` → garantir `["US"]`.
  - `optimization_goal` inválido → recriar o ad set com `LINK_CLICKS` (Passo 4).
- Em headless não há revisão visual; confie em `success:true` de cada chamada + URL pública
  `200 image/png` + ausência de `WITH_ISSUES` no `list_ads`.

### Passo 7 — Persistir no Supabase (idempotente)
Via `mcp__supabase__execute_sql`, upserts `ON CONFLICT (<chave meta>) DO UPDATE`.
Tabelas e chaves (IDs Meta são `text`; dinheiro em `*_cents`):
- `clients` — lookup por `slug='brunobracaioli'` → `client_id`.
- `campaigns` (conflict `meta_campaign_id`): `client_id, meta_campaign_id, name,
  objective='OUTCOME_TRAFFIC', buying_type='AUCTION', budget_mode='CBO',
  daily_budget_cents=5000, bid_strategy='LOWEST_COST_WITHOUT_CAP', status='PAUSED',
  special_ad_categories='{}', ads_manager_url, raw_spec`.
- `ad_sets` (conflict `meta_ad_set_id`): `campaign_id, meta_ad_set_id, name,
  optimization_goal, billing_event='IMPRESSIONS', destination_type='WEBSITE',
  daily_budget_cents=NULL, targeting (jsonb), advantage_audience=true,
  advantage_placements=true, status='PAUSED', raw_spec`.
- `generated_images` (conflict `(storage_bucket,storage_path)`): `client_id,
  variant_key='v1-autoridade'|..., storage_bucket='ad-ingest', storage_path,
  width=1024,height=1024, mime_type='image/png', model='gpt-image-2', prompt,
  aspect='1:1', cost_usd_estimate`.
- `creatives` (conflict `meta_creative_id`): `client_id, meta_creative_id, name,
  page_id='867347659802006', link_url, headline, primary_text, description,
  call_to_action_type='LEARN_MORE', image_url (URL pública), raw_spec`.
- `ads` (conflict `meta_ad_id`): `ad_set_id, creative_id, meta_ad_id, name,
  status='PAUSED', effective_status, ads_manager_url, raw_spec`.
- `operation_logs` — **uma linha por entidade criada**: `client_id, entity_type
  ('campaign'|'ad_set'|'creative'|'ad'|'image'), entity_id, meta_entity_id,
  action='create', actor='claude-code', summary` (humano, ex.: "Campanha Traffic CBO
  R$50/dia (US, Advantage+) criada PAUSED").

### Passo 8 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-trafego.json`:
```json
{
  "skill": "create-traffic-brunobracaioli-campaign",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "campaign": {"meta_campaign_id":"...","name":"...","status":"PAUSED","daily_budget_cents":5000},
  "ad_set": {"meta_ad_set_id":"...","optimization_goal":"LANDING_PAGE_VIEWS","geo":["US"]},
  "ads": [{"meta_ad_id":"...","meta_creative_id":"...","angle":"autoridade","image_url":"...","status":"PAUSED"}],
  "creatives_source": "generated|reused",
  "public_urls_file": "${ADS_DIR}/public-urls.txt",
  "errors": [],
  "decisions": ["geo=US (BR bloqueado, subcode 3858634)","cta=LEARN_MORE","optimization=LANDING_PAGE_VIEWS"],
  "image_cost_usd_estimate": 0.0,
  "ads_manager_url": "https://business.facebook.com/adsmanager/manage/campaigns?act=225179730538661"
}
```
Se algo falhou, `verified:false` + `errors[]` descritivo. **Sempre** escreva o manifest
(é o sinal de sucesso que o runner inspeciona).

### Passo 9 — Resumo final (stdout)
Tabela campanha / ad set / 3 ads com IDs e status, link do Ads Manager, e a frase:
**"Tudo PAUSED — custo Meta = 0. Ative manualmente no Ads Manager quando aprovar."**

---

## 5. Critério de sucesso
- 3 PNGs em `${ADS_DIR}` + `public-urls.txt` (URLs `200 image/png`).
- 1 campanha + 1 ad set + 3 creatives + 3 ads **PAUSED** na conta `225179730538661`, nomes `[TRF][CCA]...`.
- Cada `create_*` retornou `success:true`; `list_ads` sem `WITH_ISSUES` (erros resolvidos e documentados no manifest).
- Linhas correspondentes no Supabase + 1 `operation_logs` por entidade.
- Manifest JSON gravado em `${TRY_DIR}/`.

## 6. Anti-padrões (NÃO faça)
- ❌ Chamar `AskUserQuestion` ou parar para pedir confirmação.
- ❌ Ativar qualquer entidade (`update_*` com `status="ACTIVE"`).
- ❌ Orçamento > 5000 cents/dia.
- ❌ Passar `image_url` privado/signed (Meta não baixa) — use a URL pública do `ad-ingest`.
- ❌ Targeting `["BR"]` (trava — subcode 3858634).
- ❌ Anexar imagem por signed URL do bucket privado `creatives` (Meta não baixa — 3858258).
- ❌ Criar entidades na Meta sem persistir no Supabase + `operation_logs`.
- ❌ Regerar imagem se já existe a pasta do dia (desperdício de custo).

## 7. Gotchas obrigatórios (memória do projeto + ADRs)

**BR bloqueado** — [[meta-br-advertiser-verification-blocker]]. Em `create_adset`,
`geo_locations.countries:["BR"]` falha com `VALIDATION` / subcode **`3858634`**
("Advertiser is missing: provide a verified advertiser"). Preencher `dsa_beneficiary`/
`dsa_payor` **NÃO** resolve — é exigência de anunciante verificado para entrega no
Brasil, ainda não suportada pela API/MCP nesta conta. **Mire `["US"]`** e use sufixo
`US` no nome. Produto é pt-BR/R$; o US é workaround técnico, reavaliar periodicamente.

**Imagem via `create_creative(image_url=…)`** — [[new-meta-mcp-b2tech-validated]]. O MCP novo
`MCP_META_ADS_B2_TECH` tem `create_creative` que **aceita `image_url` público direto** e monta o
`object_story_spec` internamente (validado E2E 2026-06-18) — **não** precisa de `image_hash` nem
do workaround antigo de `link_data.picture`. Continua valendo: a URL precisa ser **pública**
(bucket `ad-ingest`, ADR 0003); o fetcher do Meta não baixa signed URL de bucket privado
(`Image Wasn't Downloaded`, subcode 3858258). O histórico do workaround inline está em
[[meta-inline-ad-image-url-must-be-in-link-data]] (não se aplica mais ao fluxo novo).

**Bucket público `ad-ingest`** — ADR 0003. O fetcher do Meta não baixa a signed URL
privada do Supabase (`Image Wasn't Downloaded`, subcode 3858258). Suba a cópia de
ingestão para o bucket **público** `ad-ingest` (path `<cliente>/<data>/<rand-hex>/`); o
master canônico continua no bucket privado `creatives`.

**Headless** — `.claude/HEADLESS.md`. Sem `AskUserQuestion`. `--permission-mode
bypassPermissions` não basta para writes na conta do cliente; é o
`--dangerously-skip-permissions` que destrava (o classifier de risco ainda bloquearia).
Confiamos no contrato deste markdown — por isso os limites duros (R$50, tudo PAUSED).

## 8. Pré-requisitos
- `.env.local` na raiz com `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
- Connector **`MCP_META_ADS_B2_TECH`** autenticado (token válido no Supabase, scope `ads_management`)
  e MCP do Supabase autenticado.
- Bucket público `ad-ingest` no Supabase (existe).
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
