---
name: create-sales-brunobracaioli-campaign
description: Cria de forma 100% autônoma e headless uma campanha de VENDAS (OUTCOME_SALES, CBO, otimizada por PURCHASE no pixel) para o cliente brunobracaioli REUSANDO os criativos "top vendas" já vencedores da conta — descobre os ads que mais venderam (get_insights ad-level + list_ads → creative_id), cria campanha + ad set (OFFSITE_CONVERSIONS) + N ads PAUSED via o MCP "MCP META ADS B2 TECH", persiste no Supabase e escreve manifest. NÃO gera arte nem copy — reaproveita creative_id existentes. Use quando pedirem "criar campanha de vendas com os top criativos do brunobracaioli", ou via headless (`claude -p --dangerously-skip-permissions ".claude/skills/create-sales-brunobracaioli-campaign"`).
argument-hint: "[budget-cents=5000] [n-creatives=3] [date-preset=last_30d]"
allowed-tools: Read, Bash, Write, mcp__claude_ai_MCP_META_ADS_B2_TECH__meta_token_status, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ad_accounts, mcp__claude_ai_MCP_META_ADS_B2_TECH__get_insights, mcp__claude_ai_MCP_META_ADS_B2_TECH__run_insights_report, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ads, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_campaigns, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_adsets, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_creatives, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_campaign, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_adset, mcp__claude_ai_MCP_META_ADS_B2_TECH__create_ad, mcp__supabase__execute_sql, mcp__supabase__list_tables
---

# Skill: /create-sales-brunobracaioli-campaign

Cria, **de ponta a ponta e sem intervenção humana**, uma campanha de **vendas
(conversões/compra)** no Meta Ads para o cliente **brunobracaioli**, **reaproveitando os
criativos "top vendas"** que mais venderam na conta — **sem recriar arte nem copy**.
Descobre os ads vencedores (`get_insights` nível ad + `list_ads` → `creative_id`) → cria
**campanha SALES + CBO + 1 ad set (OFFSITE_CONVERSIONS, pixel PURCHASE) + N ads, tudo
PAUSED** → persiste no Supabase → manifest da run.

É a **irmã de vendas** da `/create-traffic-brunobracaioli-campaign`. Diferenças-chave:
objetivo `OUTCOME_SALES`, **reusa criativos existentes** (sem geração de imagem/copy, sem
subagentes), ad set `OFFSITE_CONVERSIONS` + `promoted_object` com pixel `PURCHASE`,
**omite `destination_type`**, e usa o **novo MCP "MCP META ADS B2 TECH"**.

> Base humana testada: `how-to/criar-campanha-vendas-top-creativos.md` (run real
> 15/jun/2026, 3 gates da Meta). Toda a inteligência mora aqui; um runner/Ultron só dispara
> `claude -p --dangerously-skip-permissions ".claude/skills/create-sales-brunobracaioli-campaign"`.

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Esta skill roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano para responder, a sessão entra em deadlock.
   Em qualquer dúvida ou erro: **decida sozinho** usando os defaults da §3, registre a
   decisão no manifest (§4 Passo 9) e **siga em frente**.
2. **Resolva erros por conta própria, end-to-end.** Os 3 modos de falha conhecidos e suas
   correções estão na §7 (Gotchas) e no Passo 7. **Sempre propague `error_user_msg` +
   `error_subcode` da Meta** (princípio §0 do how-to) — eles são a chave do tratamento. Só
   aborte se for impossível prosseguir sem gastar verba ou violar um limite duro — e mesmo
   aí, **grave o manifest com `verified:false`** antes de sair, explicando o bloqueio.
3. **Cliente é fixo: `brunobracaioli`.** Não generalize para outros clientes.
4. **Meta só via o MCP "MCP META ADS B2 TECH".** **Persista tudo no Supabase via MCP.**
5. **Limites duros (defesa em profundidade):**
   - Orçamento ≤ **5000 cents/dia** (R$50). Nunca exceda, mesmo se um argumento pedir.
   - **Tudo nasce PAUSED.** Esta skill **não ativa nada**, sob nenhuma condição — não há
     tool de ativação no allowed-tools. Custo Meta = 0 até um humano ativar manualmente.
   - **Não gere arte nem copy.** Só **reusa** `creative_id` vencedores. Se nenhum criativo
     tiver venda na janela → aborte limpo (manifest `verified:false`, sem criar nada).

---

## 2. Constantes do cliente

Fonte de verdade: `.claude/skills/lista-de-clientes/SKILL.md`. No início da run, faça lookup
da linha `clients WHERE slug='brunobracaioli'` no Supabase para obter o `client_id` (uuid) —
**não hardcode o uuid**.

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Ad Account | `225179730538661` (alias `act_225179730538661`) |
| Business (deste MCP) | `201551218796069` |
| Facebook Page | `867347659802006` ("Bruno Bracaioli") |
| **Pixel (conversão)** | `653995666521954` |
| Budget cap | `5000` cents (R$50/dia) · moeda `BRL` |
| Razão social (DSA) | `B2 Tech` *(placeholder — confirmar; só usado numa futura variante BR)* |
| Ads Manager URL | `https://business.facebook.com/adsmanager/manage/campaigns?act=225179730538661` |

> ⚠️ **Discrepância de `business_id` (não-bloqueante):** o operador informou
> `201551218796069` para este MCP; a `lista-de-clientes` registra a BM `772813643612039`.
> Mantido como constante aqui conforme instrução. **Não é usado no fluxo de criação US**
> (que opera só por `account_id`); registrar no manifest para reconciliação futura.

---

## 3. Defaults autônomos (decisões já tomadas — não reabrir)

| Decisão | Valor | Por quê |
|---|---|---|
| Objetivo | `OUTCOME_SALES` | Campanha de vendas (compra) |
| Buying type | `AUCTION` | Padrão |
| Budget mode | **CBO** (budget na campanha) | Padrão do projeto |
| Daily budget | `5000` cents (clamp do arg) | Cap do cliente |
| Bid strategy | `LOWEST_COST_WITHOUT_CAP` | Maior volume / autobid |
| Otimização do ad set | `OFFSITE_CONVERSIONS` | Otimiza por conversão no site |
| Billing event | `IMPRESSIONS` | Padrão |
| promoted_object | `{pixel_id:653995666521954, custom_event_type:"PURCHASE"}` | Otimiza por compra |
| `destination_type` | **OMITIR** | Meta rejeita em SALES v25 (achado #1) |
| **Geo** | `["US"]` | **BR bloqueado** (DSA, subcode 3858634) — ver §7 |
| Advantage+ Público | `targeting_automation.advantage_audience: 1` | Público amplo Advantage+ |
| Advantage+ Posicionamentos | **omitir `placement`/`publisher_platforms`** | Sem placement spec = automáticos |
| Idade | `age_min:18, age_max:65` | Amplo |
| **Seleção de criativos** | `date_preset=last_30d`, filtra `omni_purchase`, ordena por **nº de compras desc**, top **3** | Reusa os top vendas |
| Status final | **PAUSED** (campanha, ad set e ads) | Custo zero até ativação manual |

**Naming** (data em `America/Sao_Paulo`, `DATE=YYYY-MM-DD`):
- Campanha: `[SALES][TopCreatives][${DATE}] Vendas CBO — US`
- Ad set: `[SALES][TopCreatives] adset — US — Advantage+ — PURCHASE — ${DATE}`
- Ads: `[SALES][TopCreatives] <ad_name_origem> (<compras> vendas) — ${DATE}`

**Overrides opcionais** via `$ARGUMENTS` (`key=value`): `budget-cents` (clamp ≤5000),
`n-creatives`, `date-preset`. Sem argumentos → usa os defaults acima.

> **Prefixo do connector:** este MCP já mudou de prefixo antes
> (`B2_Tech_Meta_Ads` → `MCP_META_PRO_B2TECH` → `MCP_META_ADS_B2_TECH`, how-to §6). As tools
> são referidas por nome curto (`create_campaign`, …); se o connector foi renomeado e as
> tools não resolverem, **re-sincronize o prefixo no `allowed-tools`** do frontmatter.

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- Carregar env: `set -a && eval "$(tr -d '\r' < .env.local)" && set +a` (raiz do projeto;
  precisa de `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
- `TRY_DIR=tentativas-geracao-de-campanhas`; `mkdir -p "$TRY_DIR"`. (Diretório de trabalho
  para insights grandes, se necessário: `mkdir -p "$TRY_DIR/.work-${STAMP}"`.)
- Parse de overrides do `$ARGUMENTS`; aplicar defaults da §3; **clampar `budget-cents` a
  5000** (`budget = min(arg ou 5000, 5000)`); `n-creatives` default 3; `date-preset` default
  `last_30d`.

### Passo 1 — Pré-cheques (falhar cedo, sem criar nada)
- `meta_token_status` → exigir `is_valid:true` e scope contendo `ads_management`. Se
  inválido → manifest `verified:false` (reason `invalid_token`) e sair.
- `list_ad_accounts` (ou `list_campaigns(account_id="act_225179730538661")`) → confirmar que
  a conta `225179730538661` responde. Se não → manifest `verified:false`
  (reason `account_unreachable`) e sair (nada criado, custo zero).

### Passo 2 — Descobrir os criativos vencedores
- `get_insights(object_id="act_225179730538661", level="ad", date_preset="<date-preset>",
  fields=["ad_id","ad_name","spend","actions","action_values","purchase_roas"])`.
- Para cada ad, ler `actions` e extrair a **contagem de compras** do `action_type`
  `omni_purchase` (ou `purchase`). Descartar ads com **0 compras**.
- Ordenar por **nº de compras desc** (desempate: `purchase_roas` desc, depois receita de
  `action_values` desc). Pegar os **top N** (default 3).
- 💡 Se o output do `get_insights` for grande e estourar tokens, salve em
  `$TRY_DIR/.work-${STAMP}/insights.json` e consulte com `jq` em vez de ler tudo
  (how-to §3.1).
- **Se zero ads tiverem compra na janela → aborte limpo:** manifest `verified:false`,
  reason `no_winning_creatives`, **nada criado na Meta**. Esse é um término válido.

### Passo 3 — Mapear `ad_id` → `creative_id`
- Para cada `ad_id` vencedor, `list_ads(account_id="act_225179730538661", ...)` (ou filtrado)
  → extrair `creative.id` (= **`creative_id`**).
- ⚠️ **Use sempre o ID, nunca o nome** (how-to §3.1): o mesmo *nome* de ad costuma mapear
  para `creative_id` **diferentes**. Guarde a tupla `{ad_id, ad_name, purchases, creative_id}`.
- Dedup por `creative_id` (se dois ads vencedores compartilham o mesmo creative, conta 1×).

### Passo 4 — Criar a campanha (PAUSED)
`create_campaign` (conta `act_225179730538661`):
- `name=[SALES][TopCreatives][${DATE}] Vendas CBO — US`, `objective=OUTCOME_SALES`,
  `special_ad_categories=["NONE"]`, `status=PAUSED`.
- **CBO**: `daily_budget=<clamped cents>`, `bid_strategy=LOWEST_COST_WITHOUT_CAP`.
- Guardar `campaign_id` (= `meta_campaign_id`).

### Passo 5 — Criar o ad set (PAUSED) — otimizado para compra
`create_adset` (parent = `meta_campaign_id`):
- `name=[SALES][TopCreatives] adset — US — Advantage+ — PURCHASE — ${DATE}`, `status=PAUSED`.
- **Sem `daily_budget`** (CBO controla na campanha).
- `optimization_goal=OFFSITE_CONVERSIONS`, `billing_event=IMPRESSIONS`.
- `promoted_object={"pixel_id":"653995666521954","custom_event_type":"PURCHASE"}`.
- `targeting={"geo_locations":{"countries":["US"]},"age_min":18,"age_max":65,"targeting_automation":{"advantage_audience":1}}`
  — **sem** `publisher_platforms`/`placement` (= Advantage+ posicionamentos).
- **NÃO envie `destination_type`** (achado #1: a Meta rejeita em SALES v25; ad sets que
  funcionam ficam `UNDEFINED`).
- Se a Meta der subcode `3858634` (gate DSA BR) → **manter `["US"]`** (§7); não tentar BR.
- Guardar `adset_id` (= `meta_ad_set_id`).
- **Idempotência:** se os ads do Passo 6 falharem, **reusar este `adset_id`** — não recriar
  (how-to §7.5; ad sets/ads que falham na criação não deixam objeto órfão).

### Passo 6 — Criar os ads (PAUSED) — um por `creative_id` vencedor
Para cada `creative_id` vencedor, `create_ad` (parent = `meta_ad_set_id`, `status=PAUSED`):
- `creative_id=<CREATIVE_ID_VENCEDOR>` (reuso direto — **preserva copy + Advantage+ creative**
  embutidos no criativo vencedor; não recria nada).
- `name=[SALES][TopCreatives] <ad_name_origem> (<compras> vendas) — ${DATE}`.
- Guardar cada `meta_ad_id`. São chamadas independentes ⇒ podem ir em **paralelo**.

### Passo 7 — Verificar + tratar erros por subcode
- `list_campaigns` / `list_adsets` / `list_ads` → confirmar a estrutura: campanha com
  `daily_budget` + `bid_strategy` corretos; ad set com `optimization_goal:OFFSITE_CONVERSIONS`
  e `promoted_object` (pixel); os N ads no ad set.
- Casar qualquer erro por `error_subcode`/`error_user_msg` (how-to §5) e aplicar a correção:

| subcode / sinal | causa | correção |
|---|---|---|
| `Invalid parameter` no ad set | enviou `destination_type` | **omitir `destination_type`** e recriar o ad set |
| **3858634** (`verified advertiser`) | gate DSA ao mirar BR | já estamos em `["US"]`; manter US e registrar pendência BR no manifest |
| **1885499** (`No Advertiser Permission On Page`) | token sem task *Advertise* na Página | **abortar limpo** + registrar passo manual (conceder permissão de Anunciante na Página `867347659802006` no Business Manager) e refazer depois |

- Sempre logar `error_user_msg` + `error_subcode` **verbatim** no manifest.

### Passo 8 — Persistir no Supabase (idempotente)
Via `mcp__supabase__execute_sql`, upserts `ON CONFLICT (<chave meta>) DO UPDATE`. IDs Meta são
`text`; dinheiro em `*_cents`:
- `clients` — lookup por `slug='brunobracaioli'` → `client_id`.
- `creatives` (conflict `meta_creative_id`) — **uma linha por creative_id reusado** para que
  `ads.creative_id` (FK) resolva: `client_id, meta_creative_id, page_id='867347659802006',
  name=<ad_name_origem>, raw_spec` (copy original embutida; deixar `headline`/`primary_text`
  null se não extraídos — não inventar).
- `campaigns` (conflict `meta_campaign_id`): `client_id, meta_campaign_id, name,
  objective='OUTCOME_SALES', buying_type='AUCTION', budget_mode='CBO',
  daily_budget_cents=<clamped>, bid_strategy='LOWEST_COST_WITHOUT_CAP', status='PAUSED',
  special_ad_categories='{NONE}', ads_manager_url, raw_spec`.
- `ad_sets` (conflict `meta_ad_set_id`): `campaign_id, meta_ad_set_id, name,
  optimization_goal='OFFSITE_CONVERSIONS', billing_event='IMPRESSIONS', destination_type=NULL,
  daily_budget_cents=NULL, targeting (jsonb com geo US + advantage), advantage_audience=true,
  advantage_placements=true, status='PAUSED', raw_spec (inclui promoted_object/pixel)`.
- `ads` (conflict `meta_ad_id`): `ad_set_id, creative_id (uuid da row de creatives),
  meta_ad_id, name, status='PAUSED', effective_status, ads_manager_url, raw_spec`.
- `operation_logs` — **uma linha por entidade criada**: `client_id, entity_type
  ('campaign'|'ad_set'|'creative'|'ad'), entity_id, meta_entity_id, action='create',
  actor='claude-code', summary` (humano, ex.: "Campanha SALES CBO R$50/dia (US, pixel
  PURCHASE) criada PAUSED reusando 3 top creatives").

### Passo 9 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-sales-topcreatives.json`:
```json
{
  "skill": "create-sales-brunobracaioli-campaign",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "business_id": "201551218796069",
  "selection": {"date_preset": "last_30d", "rank_by": "purchases_desc", "top_n": 3},
  "campaign": {"meta_campaign_id":"...","name":"...","objective":"OUTCOME_SALES","status":"PAUSED","daily_budget_cents":5000},
  "ad_set": {"meta_ad_set_id":"...","optimization_goal":"OFFSITE_CONVERSIONS","pixel_id":"653995666521954","custom_event_type":"PURCHASE","geo":["US"],"destination_type":null},
  "ads": [{"meta_ad_id":"...","meta_creative_id":"...","source_ad_name":"demiti-agencia","purchases":3,"status":"PAUSED"}],
  "creatives_source": "reused",
  "errors": [],
  "decisions": ["geo=US (BR bloqueado, subcode 3858634)","destination_type omitido (achado #1)","top 3 por nº de compras em last_30d"],
  "pending_manual_steps": ["trocar geo US→BR e ativar no Ads Manager após confirmar anunciante DSA"],
  "ads_manager_url": "https://business.facebook.com/adsmanager/manage/campaigns?act=225179730538661"
}
```
Se algo falhou, `verified:false` + `errors[]` descritivo (com `error_user_msg`/subcode).
**Sempre** escreva o manifest (é o sinal de término que o runner inspeciona). No término
`no_winning_creatives`, grave `verified:false`, `errors:["no_winning_creatives"]` e
`campaign:null`.

### Passo 10 — Resumo final (stdout)
Tabela campanha / ad set / N ads com IDs, `creative_id` de origem e status; link do Ads
Manager; os passos manuais pendentes; e a frase:
**"Tudo PAUSED — custo Meta = 0. Troque US→BR (se aplicável) e ative manualmente no Ads
Manager quando aprovar."**

---

## 5. Critério de sucesso
- ≥1 `creative_id` vencedor identificado por compras reais (ou término limpo
  `no_winning_creatives`).
- 1 campanha SALES + 1 ad set (`OFFSITE_CONVERSIONS` + pixel PURCHASE) + N ads **PAUSED** na
  conta `225179730538661`, nomes `[SALES][TopCreatives]...`, geo `US`, **sem `destination_type`**.
- Estrutura confirmada via `list_campaigns/list_adsets/list_ads`; erros (se houver) resolvidos
  e documentados no manifest.
- Linhas correspondentes no Supabase + 1 `operation_logs` por entidade.
- Manifest JSON gravado em `${TRY_DIR}/` com os passos manuais pendentes.

## 6. Anti-padrões (NÃO faça)
- ❌ Gerar arte ou copy nova / chamar subagentes de criativo (esta skill **reusa**).
- ❌ Selecionar criativo por **nome** (use o `creative_id` — nomes iguais ≠ creative igual).
- ❌ Enviar `destination_type` no ad set SALES (achado #1 → `Invalid parameter`).
- ❌ Pôr `daily_budget` no ad set (orçamento é da campanha — CBO).
- ❌ Ativar qualquer entidade / orçamento > 5000 cents/dia.
- ❌ Targeting `["BR"]` (trava — subcode 3858634).
- ❌ Recriar o ad set após falha parcial nos ads (reusar o `adset_id`).
- ❌ Chamar `AskUserQuestion` ou parar para pedir confirmação.
- ❌ Criar entidades na Meta sem persistir no Supabase + `operation_logs`.

## 7. Gotchas obrigatórios (how-to + memória do projeto)

**Omitir `destination_type` (achado #1).** A Meta **rejeita** `destination_type` em ad sets
`OUTCOME_SALES` v25 (`Invalid parameter`). Ad sets de venda que funcionam ficam `UNDEFINED`.
Nunca envie esse campo.

**BR bloqueado — subcode `3858634` (achado #2).** [[meta-br-advertiser-verification-blocker]].
Mirar `["BR"]` exige **anunciante DSA confirmado** no Business Manager; `dsa_beneficiary`/
`dsa_payor` como texto livre **não** basta. **Mire `["US"]`** e use sufixo `US` no nome;
registre no manifest a pendência de trocar US→BR e ativar manualmente. Produto é pt-BR/R$; o
US é workaround técnico de criação.

**Permissão de Anunciante na Página — subcode `1885499` (achado #3).** Se o usuário do token
não tem a task *Advertise* na Página `867347659802006`, o `create_ad` falha. Não dá pra
contornar por parâmetro: **aborte limpo** e reporte o passo manual (conceder permissão no
Business Manager), depois refaça só os ads reusando o `adset_id`.

**Propague sempre `error_user_msg` + `error_subcode` (princípio §0).** Os erros "Invalid
parameter" da Graph API quase nunca são bug do MCP — são regras de identidade/negócio da
Meta. Sem a mensagem real, todo erro parece igual. Logue verbatim e case pela tabela do
Passo 7.

**Reuso de `creative_id` preserva o Advantage+ creative.** Passar `creative_id` no `create_ad`
reaproveita arte + copy + variações Advantage+ já embutidas no vencedor — por isso não há
geração de imagem aqui.

**Prefixo do connector pode mudar (how-to §6).** Deploy que muda *schema* de tool exige
reconectar o connector (o claude.ai cacheia `tools/list`). Se as tools `MCP_META_ADS_B2_TECH`
não resolverem, re-sincronize o prefixo no `allowed-tools`.

**Headless** — `.claude/HEADLESS.md`. Sem `AskUserQuestion`. `--permission-mode
bypassPermissions` não basta para writes na conta do cliente; é o
`--dangerously-skip-permissions` que destrava. Confiamos no contrato deste markdown — por
isso os limites duros (R$50, tudo PAUSED).

## 8. Pré-requisitos
- `.env.local` na raiz com `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
- MCP "MCP META ADS B2 TECH" conectado, token válido com `ads_management`
  (`meta_token_status` → `is_valid:true`; senão `meta_login`).
- Pixel `653995666521954` ativo na conta.
- Permissão de Anunciante na Página `867347659802006` ("Bruno Bracaioli").
- Existir ≥1 ad com compra (`omni_purchase`) na janela escolhida.
- Migrations do Supabase aplicadas (tabelas `clients/campaigns/ad_sets/ads/creatives/operation_logs`).
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
