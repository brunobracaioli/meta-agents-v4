---
name: funnel-analytics-brunobracaioli-campaign
description: 'Análise diária 100% autônoma e headless da performance de TODAS as campanhas ativas Meta Ads do cliente brunobracaioli (qualquer objetivo) usando o connector MCP_META_ADS_B2_TECH (read-only), que entrega o FUNIL DE CONVERSÃO COMPLETO (impression → link_click → landing_page_view → view_content → add_to_cart → initiate_checkout → purchase) com receita (action_values) e ROAS (purchase_roas). Extrai o funil por entidade, diagnostica cruzando ≥2 métricas (nunca métrica isolada) ancorado no north-star de cada objetivo, e PERSISTE no Supabase: analyses + metric_snapshots + analysis_findings (ADR 0004) + o read model funnel_events (ADR 0025) que alimenta o funil de eventos visual no dashboard. NÃO altera NADA na conta Meta. Substitui a analytic-traffic-brunobracaioli-campaign. Use quando pedirem "analisar performance/funil de brunobracaioli/CCA", ou via cron DIÁRIO (`claude -p --dangerously-skip-permissions ".claude/skills/funnel-analytics-brunobracaioli-campaign"`).'
argument-hint: "[window=last_7d] [compare=previous_period] [level=ad]"
allowed-tools: Read, Bash, Glob, Write, mcp__claude_ai_MCP_META_ADS_B2_TECH__meta_token_status, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ad_accounts, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_campaigns, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_adsets, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ads, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_creatives, mcp__claude_ai_MCP_META_ADS_B2_TECH__get_insights, mcp__claude_ai_MCP_META_ADS_B2_TECH__run_insights_report, mcp__supabase__execute_sql, mcp__supabase__list_tables, mcp__plugin_telegram_telegram__reply
---

# Skill: /funnel-analytics-brunobracaioli-campaign

Avalia, **de ponta a ponta e sem intervenção humana**, a performance de **TODAS as campanhas
ativas** do cliente **brunobracaioli** no Meta Ads — qualquer objetivo (`OUTCOME_TRAFFIC`/
`LINK_CLICKS`, `OUTCOME_SALES`, `OUTCOME_ENGAGEMENT`, ...). Diferença central para a skill
anterior: lê via o connector **`MCP_META_ADS_B2_TECH`**, que entrega o **funil de conversão
completo** com valores limpos (`actions`, `action_values`, `purchase_roas`,
`cost_per_action_type`) — o que o MCP oficial não consolidava.

> **Substitui** `analytic-traffic-brunobracaioli-campaign` (mantida só p/ rollback).
> O runner Fly.io dispara esta skill **diariamente** às 08h BRT (casca fina
> `timeout 1500 claude -p --dangerously-skip-permissions ...`). **Toda a inteligência está aqui.**
> ADR: `docs/adr/0025-meta-ads-funnel-analytics-b2tech.md` · Spec:
> `docs/specs/meta-ads-funnel-analytics.md` · Migration: `20260614000001_add_funnel_events.sql`.

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano para responder, a sessão entra em deadlock. Em
   qualquer dúvida ou erro: **decida sozinho** com os defaults da §3, registre no manifest e siga.
2. **READ-ONLY na conta Meta.** Esta skill **só lê**. As tools de escrita do b2tech
   (`create_*`, `pause_*`, `update_*`) e do MCP oficial **não estão** no `allowed-tools` e **nunca**
   devem ser chamadas. As recomendações vão pro banco; um humano decide. A skill **não age** na conta.
3. **Resolva erros por conta própria.** Se um campo faltar, use o fallback de mapeamento (§3) e
   registre a limitação no manifest. Só aborte se for impossível ler qualquer dado — e mesmo aí,
   **grave `analyses` com `overall_verdict='error'`** e o manifest com `verified:false` antes de sair.
4. **Cliente é fixo: `brunobracaioli`.** Não generalize para outros clientes.
5. **Sempre grave a rodada.** Toda execução produz ≥1 linha em `analyses` (mesmo `no_data`/`error`)
   + manifest. É o sinal que o runner inspeciona.

---

## 2. Constantes do cliente

Fonte de verdade: `.claude/skills/lista-de-clientes/SKILL.md`. No início, faça lookup de
`clients WHERE slug='brunobracaioli'` no Supabase para obter `client_id` (uuid) — **não hardcode**.

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Ad Account | `act_225179730538661` (o b2tech aceita o id com prefixo `act_`) |
| Business Manager | `772813643612039` (Bracaioli Tech — BM) |
| Facebook Page | `867347659802006` |
| Moeda / fuso | `BRL` · `America/Sao_Paulo` |
| Escopo da análise | **TODAS as campanhas ativas com gasto na janela**, qualquer objetivo — inclusive criadas manualmente pelo operador |
| Budget cap | `5000` cents/dia (R$50) **por campanha** — checar `daily_budget` de cada ativa; se exceder, finding `severity='medium'`, `metric_focus='budget'` |

A escrita no Supabase é **via MCP** (`execute_sql`) — não precisa de chave no `.env.local`. A única
env opcional é `TELEGRAM_CHAT_ID` (Passo 7).

---

## 3. Modelo de dados + framework de diagnóstico

### 3.1 Funil canônico (a espinha dorsal — alimenta o funil visual)

Ordem fixa (`step_order`). Cada etapa vira 1 linha em `funnel_events`:

| step | event_type | fonte (campo/action) | fallback de action_type |
|---|---|---|---|
| 1 | `impression` | campo `impressions` | — |
| 2 | `link_click` | action `link_click` | — |
| 3 | `landing_page_view` | action `landing_page_view` | `omni_landing_page_view` |
| 4 | `view_content` | action `view_content` | `offsite_conversion.fb_pixel_view_content`, `omni_view_content`, `onsite_web_view_content` |
| 5 | `add_to_cart` | action `add_to_cart` | `offsite_conversion.fb_pixel_add_to_cart`, `omni_add_to_cart` |
| 6 | `initiate_checkout` | action `initiate_checkout` | `offsite_conversion.fb_pixel_initiate_checkout`, `omni_initiated_checkout` |
| 7 | `purchase` | action `purchase` | `offsite_conversion.fb_pixel_purchase`, `omni_purchase` |

Por etapa derive:
- `count` = valor do action (inteiro). Ausente ⇒ `0`.
- `value_cents` = de `action_values[]` no MESMO event_type (mesma prioridade de fallback) → `round(valor*100)`. Só `purchase` costuma ter valor; demais ⇒ `null`.
- `cost_per_event_cents` = de `cost_per_action_type[]` no mesmo event_type → `round(valor*100)`; se ausente e `count>0`, computar `round(spend*100/count)`; senão `null`.
- `cvr_from_prev` = `count / count(etapa anterior)` (guarda divisão por zero ⇒ `null`).
- `cvr_from_top` = `count / count(impression)` (guarda ⇒ `null`).
- `raw` = jsonb com o(s) action_type usado(s) e os valores brutos (auditoria).

**ROAS** = `purchase_roas[]` (`omni_purchase` → fallback `purchase`), numérico. Vai no
`metric_snapshots.raw` e nos findings — não é etapa do funil.

> **Valores vêm LIMPOS** do b2tech (`"1756.47"`, `"5.313491"`, `"2723.33"`) — números em string,
> **sem** localização `R$/vírgula`. Converta dinheiro para **cents** (`round(float*100)`); NÃO há
> o parsing localizado da skill antiga.

### 3.2 North-star por objetivo ("NUNCA métrica isolada")

Toda conclusão **cruza ≥2 métricas** e ancora **no objetivo da campanha**. Nunca declare "CPC alto"
ou "CTR baixo" sozinhos.

| Objetivo | North-star | Diagnóstico secundário |
|---|---|---|
| `OUTCOME_TRAFFIC` / `LINK_CLICKS` | `CPLPV` (≈ `cost_per_action_type.landing_page_view`) | CTR link, LPV% = LPV/link_click |
| `OUTCOME_SALES` | `CPA` (`cost_per_action_type.purchase`) e **ROAS** | funil VC→ATC→IC→Purchase; **onde vaza?** CPM alto + CTR ok ⇒ leilão/audiência, não criativo |
| `OUTCOME_ENGAGEMENT` | custo/engajamento; CPM + frequência | **NÃO julgar por CTR link** |

Com o funil completo, o diagnóstico de vendas agora aponta **a etapa exata do vazamento**
(ex.: IC→Purchase = 9,5% ⇒ problema no checkout/preço, não no criativo nem na audiência).

### 3.3 Identidades + matriz relacional

```
CPM=spend/impr×1000 · CTR=link_click/impr · CPC=spend/link_click · LPV%=lpv/link_click
CPLPV=spend/lpv · CPA=spend/purchase · ROAS=receita/spend · freq=impr/reach
CVR(etapa)=count/count_anterior   (a leitura mais nova: onde o funil quebra)
```

| Sintoma combinado | Diagnóstico provável | recommendation_type |
|---|---|---|
| CPC↑ + CTR↓ | criativo/relevância fraca | `rotate_creative` |
| CPC↑ + CTR ok | CPM alto — leilão/audiência cara (não criativo) | `adjust_audience` |
| CTR ok + CPLPV↑ | gargalo pós-clique (LP lenta, pixel, mismatch) | `fix_landing_page` |
| funil ok até IC + **IC→Purchase↓** | gargalo de checkout/preço/parcelamento | `fix_landing_page` |
| VC→ATC↓ forte | oferta/produto não convence na página | `fix_landing_page` |
| CTR↓ no tempo + freq↑ | fadiga de criativo | `rotate_creative` |
| irmã com mesmo CPA/ROAS a 2x+ o custo | realocar p/ vencedora | `reallocate_budget` |
| tudo saudável + volume baixo | restrição de budget/audiência | `scale` (respeitar cap R$50) |

**Âncora de tendência:** janela atual vs `compare` (delta %) **e** vs `metric_snapshots`/`funnel_events`
de rodadas anteriores (mesma entidade no tempo) — com cadência diária, o histórico interno é a
âncora mais confiável.

**Gates de significância** (não agir no ruído → `is_significant=false`, `recommendation_type='observe'`):
ad set em aprendizado (< ~50 eventos de otimização/7d), ou abaixo dos pisos `impressions<1000`,
`link_clicks<50`, `spend<R$10`, ou `<3 dias` veiculando.

**Defaults de entrada** (`$ARGUMENTS`, `key=value`): `window=last_7d`, `compare=previous_period`,
`level=ad`. Presets aceitos: `today, yesterday, last_3d, last_7d, last_14d, last_28d, last_30d,
last_90d, this_month, last_month, this_year, maximum`.

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- Carregar env (opcional, só `TELEGRAM_CHAT_ID`): se existir `.env.local`,
  `set -a && eval "$(tr -d '\r' < .env.local)" && set +a` (tolere ausência).
- `TRY_DIR=tentativas-geracao-de-campanhas`; `mkdir -p "$TRY_DIR"`.
- Parse de overrides do `$ARGUMENTS`; aplicar defaults da §3.
- Marcar `run_started_at` (agora, UTC).

### Passo 1 — Pré-condições (banco + token b2tech)
- `list_tables` (schema `public`) → confirmar `analyses`, `metric_snapshots`, `analysis_findings`,
  **`funnel_events`**. Se `funnel_events` faltar → gravar manifest `verified:false`
  ("migration 20260614000001_add_funnel_events ausente") e seguir gravando o resto (degrada o funil,
  não a análise).
- Lookup `client_id`: `SELECT id FROM clients WHERE slug='brunobracaioli'`.
- `meta_token_status` → exigir `is_valid:true`. Se inválido → `analyses` com
  `overall_verdict='error'`, manifest `verified:false`, e sair (não chamar `meta_login`/`meta_refresh_token`
  — são interativos; só registrar a limitação).
- `list_ad_accounts` → confirmar `act_225179730538661` acessível.

### Passo 2 — Coletar o funil (read-only, b2tech)
**O token b2tech lê no nó CONTA, não no nó campanha** (validado 2026-06-14): chamar
`get_insights(object_id=<campaign_id>, ...)` retorna **Meta #200** ("owner has NOT granted
ads_read"). Portanto **sempre** consulte com `object_id=act_225179730538661` e varie só o `level`.

1. **Overall da conta** (alimenta o funil "conta inteira"): 1× `get_insights(object_id=act_...,
   level="account", date_preset=window, fields=FIELDS)` — payload pequeno (1 linha), traz `actions`,
   `action_values`, `purchase_roas` **e** `cost_per_action_type` completos.
2. **Por campanha** (`object_id=act_..., level="campaign"`): retorna 1 linha por campanha e
   **estoura o limite de tokens** (a conta tem ~89 campanhas) → o resultado é salvo em
   `tool-results/…txt`. **Isto não é erro.** **NUNCA** leia o arquivo inteiro no contexto —
   processe com `python3`/`jq`: localize `{"result":[…]}`, **filtre `spend>0`** (pega TODAS as
   campanhas com gasto na janela, não só as `ACTIVE` de agora) e mapeie as 7 etapas. Idem
   `level="adset"` e `level="ad"` (mesmo padrão arquivo+filtro).
3. `list_campaigns(account_id="act_225179730538661", limit=200)` → use para `effective_status`,
   `objective` e `daily_budget` (checagem do teto R$50) e para marcar quais das campanhas com gasto
   estão `ACTIVE` (vira `active_entities`).
4. Para `compare`, repetir com `time_range={"since","until"}` explícito — **nunca** os dois juntos.

`FIELDS` (validado 2026-06-14): `spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,
action_values,purchase_roas,cost_per_action_type` + identificadores do nível
(`campaign_id,campaign_name,objective` / `adset_id,adset_name` / `ad_id,ad_name`). **Peça o FIELDS
completo** — um field set reduzido omite `cost_per_action_type`/`reach`/`frequency` e força computar
`cost_per_event` por `spend/count`.

- `run_insights_report` (async) **pode dar timeout** nesta conta — não dependa dele; o caminho
  account-scope + arquivo + `jq` é o confiável.
- Mapear `actions/action_values/cost_per_action_type` → as 7 etapas da §3.1 (prioridade + fallback).
- Notação `level`: o MCP usa `adset` (sem underscore); a **coluna do banco usa `ad_set`**.
- **Persistência de alto volume** (centenas de `funnel_events`): preferir o REST do Supabase
  (PostgREST com `SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY` do `.env.local`, `Prefer: return=minimal`)
  para não despejar SQL gigante; os poucos `analysis_findings` podem ir via MCP `execute_sql`.
- **`analysis_findings.level`** só aceita `campaign`/`ad_set`/`ad` → findings de CONTA usam
  `level=null` (a coluna é nullable). `funnel_events.level` aceita `account`.

### Passo 3 — Caminho `no_data` (estado esperado quando tudo PAUSED)
Se **nenhuma** entidade teve `spend>0` na janela:
- Inserir 1 `analyses` com `overall_verdict='no_data'`, `active_entities=0`.
- Inserir 1 `analysis_findings` `info`: "Nenhuma campanha ativa com gasto no período."
  (`recommendation_type='none'`, `is_significant=false`).
- `funnel_events` opcional (pode pular ou gravar zerado da conta). Seguir p/ Passo 6/7. **Não é erro.**

### Passo 4 — Diagnóstico (aplicar §3)
Para cada entidade com entrega: derivar o funil e as métricas, **cruzar** conforme a matriz da §3.3,
aplicar gates, comparar tendência (vs `compare` e vs snapshots/funnel anteriores), rankear irmãos.
Produzir:
- `overall_verdict` ∈ {`healthy`,`watch`,`underperforming`,`learning`}.
- Findings priorizados, cada um com `diagnosis` que **cita a relação entre métricas E a etapa do
  funil** (ex.: "ROAS 1,55 com CPA R$92: funil saudável até IC (CVR ATC→IC 80%), mas **IC→Purchase
  só 9,5%** → gargalo no checkout, não no criativo") e `evidence` (jsonb com os números).

### Passo 5 — Persistir no Supabase (via MCP)
Via `mcp__supabase__execute_sql` (dinheiro em `*_cents`, IDs Meta em `text`):

- **`analyses`** (insert com `RETURNING id`): `client_id, objective` (lista distinta dos objetivos com
  gasto, alfabética, separada por vírgula), `window_start, window_stop, compare_window_start,
  compare_window_stop, entities_analyzed, active_entities, overall_verdict, summary, manifest_path,
  triggered_by='cron', run_started_at, run_finished_at=now()`.
- **`metric_snapshots`** (1/entidade, `ON CONFLICT (analysis_id, level, meta_entity_id) DO UPDATE`):
  `level` ∈ {`campaign`,`ad_set`,`ad`} (a conta vai só em `funnel_events`/análise),
  `impressions, reach, frequency, spend_cents, link_clicks, ctr, cpc_cents, cpm_cents,
  landing_page_views, cplpv_cents, results, cost_per_result_cents, raw`. Em `raw` inclua
  `{funnel:{...7 etapas...}, roas, revenue_cents, action_values_raw}`. Semântica de
  `results`/`cost_per_result_cents`: compras/CPA p/ `OUTCOME_SALES`, LPV/CPLPV p/ tráfego, NULL p/
  engajamento. `ctr` persistido é o de link.
- **`funnel_events`** (7 linhas/entidade COM ENTREGA, incl. nível `account`;
  `ON CONFLICT (analysis_id, level, meta_entity_id, event_type) DO UPDATE`):
  `analysis_id, client_id, level, meta_entity_id, entity_name, objective, date_start, date_stop,
  step_order, event_type, count, value_cents, cost_per_event_cents, cvr_from_prev, cvr_from_top, raw`.
- **`analysis_findings`** (1/achado): `analysis_id, client_id, level, meta_entity_id, entity_name,
  severity, metric_focus, diagnosis, evidence, recommended_action, recommendation_type, confidence,
  is_significant`.
- Escape de strings em SQL: aspas simples duplicadas, ou jsonb via `$$...$$`. Nunca quebre por copy
  com apóstrofo.

### Passo 6 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-funnel.json`:
```json
{
  "skill": "funnel-analytics-brunobracaioli-campaign",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "connector": "MCP_META_ADS_B2_TECH",
  "window": {"window": "last_7d", "compare": "previous_period"},
  "analysis_id": "...",
  "overall_verdict": "no_data|healthy|watch|underperforming|learning|error",
  "entities_analyzed": 0,
  "active_entities": 0,
  "account_funnel": {"impression":0,"link_click":0,"landing_page_view":0,"view_content":0,"add_to_cart":0,"initiate_checkout":0,"purchase":0,"revenue_cents":0,"roas":null},
  "snapshots": [{"level":"campaign","meta_entity_id":"...","spend_cents":0,"cpa_cents":null,"roas":null}],
  "findings": [{"severity":"info","metric_focus":"...","diagnosis":"...","recommendation_type":"none","is_significant":false}],
  "objectives": ["OUTCOME_SALES"],
  "decisions": ["window=last_7d","iterei só campanhas ACTIVE (evita estouro de tokens)"],
  "errors": []
}
```
Se algo falhou, `verified:false` + `errors[]`. **Sempre** escreva o manifest.

### Passo 7 — Notificar no Telegram (toda rodada, com fallback)
- Ler `TELEGRAM_CHAT_ID`. Vazio/ausente → pular, logar "Telegram pulado (sem CHAT_ID)" e seguir.
- Presente → resumo curto (veredito + ROAS + top 3 findings com a relação de métricas e a etapa do
  funil) via `mcp__plugin_telegram_telegram__reply` com `chat_id=$TELEGRAM_CHAT_ID`.
- Tool falhar/indisponível → **fallback log-only** (nunca trave o headless).

### Passo 8 — Resumo final (stdout)
Funil da conta (7 etapas com count + CVR) + tabela por entidade (nível, nome, spend, CPA/CPLPV,
ROAS, veredito) + `overall_verdict` + recomendações priorizadas. Fechar com: **"Análise read-only —
nenhuma alteração feita na conta Meta. Funil + recomendações gravados no Supabase para decisão humana."**

---

## 5. Critério de sucesso
- 1 linha em `analyses` (mesmo `no_data`/`error`) + `metric_snapshots`/`analysis_findings` coerentes.
- Para cada entidade com entrega: 7 linhas em `funnel_events` com `cvr_*` e `cost_per_event_cents`
  coerentes; `purchase.value_cents` = receita quando houver `action_values`.
- Cada finding cruza ≥2 métricas e cita a etapa do funil onde o dinheiro vaza; tem `evidence`.
- Manifest JSON gravado em `${TRY_DIR}/`.
- **Zero** chamadas de escrita na Meta (read-only verificável pelo `allowed-tools`).
- Telegram enviado (ou fallback log-only).

## 6. Anti-padrões (NÃO faça)
- ❌ `AskUserQuestion` ou parar para pedir confirmação.
- ❌ Chamar `create_*`/`pause_*`/`update_*` do b2tech, ou qualquer mutação (oficial ou b2tech).
- ❌ Chamar `get_insights(object_id=<campaign_id>, …)` — retorna Meta #200; consulte sempre na CONTA (`act_…`) variando o `level`.
- ❌ Ler o arquivo `tool-results/` inteiro no contexto — processe com `jq`/`python3` filtrando `spend>0`.
- ❌ Concluir a partir de **uma métrica isolada** (sempre cruze ≥2 e ancore no objetivo + etapa do funil).
- ❌ Reintroduzir parsing localizado `R$/vírgula` — o b2tech já entrega número limpo.
- ❌ Tratar `no_data` como erro (é o estado esperado enquanto tudo está PAUSED).
- ❌ Deixar de gravar `analyses` ou o manifest; travar o headless por Telegram ausente.

## 7. Gotchas obrigatórios
- **Token lê só no nó CONTA** — `object_id=<campaign_id>` → Meta **#200**. Use `object_id=act_…` e
  varie o `level` (Passo 2). `level=campaign` na conta traz todas as ~89 campanhas e vai pra
  `tool-results/` (não é erro) — processe com `jq`/`python3` filtrando `spend>0`; nunca leia o
  arquivo inteiro no contexto. `run_insights_report` async pode dar timeout — não dependa dele.
- **`level` do MCP é `adset`; a coluna do banco é `ad_set`** — converta ao persistir.
- **Funil pode não ser estritamente monotônico** entre variantes de pixel (ex.: `view_content` 751 vs
  `onsite_web_view_content` 754) — use a prioridade da §3.1 de forma consistente e guarde a fonte em `raw`.
- **`action_values`/`purchase_roas` só existem com vendas** — objetivo de tráfego/engajamento ⇒
  `value_cents=null`, ROAS null; o funil termina no evento mais fundo disponível.
- **Token b2tech vem do Supabase** (`meta_token_status.source:"supabase"`); se expirar, registrar
  `error` e sair — `meta_login`/`meta_refresh_token` são interativos, fora do headless.
- **Campanhas manuais do operador entram na análise** — analise todas com o north-star do objetivo
  delas e cheque o teto de budget (§2).
- **Headless** — `--dangerously-skip-permissions`. A confiança vem deste contrato: **read-only**,
  nenhuma tool de escrita no `allowed-tools`.

## 8. Pré-requisitos
- Migration `20260614000001_add_funnel_events` aplicada (tabela `funnel_events`) + as tabelas da
  migration `add_meta_ads_performance_analysis` (`analyses`, `metric_snapshots`, `analysis_findings`).
- Connector `MCP_META_ADS_B2_TECH` autenticado (token válido no Supabase) e MCP do Supabase autenticado.
- Opcional: `TELEGRAM_CHAT_ID` no ambiente (`.env.local` / `fly secrets`).
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
