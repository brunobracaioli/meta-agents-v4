---
name: google-ads-analytics-brunobracaioli
description: 'Análise diária 100% autônoma e headless da performance de TODAS as campanhas GOOGLE ADS (Search) da conta 4342319594 (Blog B2 Tech) do cliente brunobracaioli, via connector MCP_GOOGLE_ADS_B2_TECH (read-only). Lê métricas por campanha/ad group/anúncio (get_insights), o search-terms report (candidatos a keyword negativa) e as recomendações do Google, diagnostica cruzando ≥2 métricas ancorado na bidding strategy, e PERSISTE no Supabase via REST: analyses (channel=google_ads) + metric_snapshots + analysis_findings. NÃO altera NADA na conta Google. É o espelho Google da funnel-analytics-brunobracaioli-campaign (Meta). Use quando pedirem "analisar o Google Ads / campanhas de pesquisa / search do brunobracaioli", via cron DIÁRIO 08:30 BRT, ou via fila agent_jobs (kind=analyze_google) — sempre `claude -p --dangerously-skip-permissions ".claude/skills/google-ads-analytics-brunobracaioli"`.'
argument-hint: "[window=last_7d] [compare=previous_period]"
allowed-tools: Read, Bash, Glob, Write, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__google_token_status, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_accessible_customers, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_campaigns, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_ad_groups, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_ads, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__get_insights, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__run_insights_report, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__get_search_terms, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__get_recommendations, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_conversion_actions, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__get_conversion_tags, mcp__plugin_telegram_telegram__reply
---

# Skill: /google-ads-analytics-brunobracaioli

Avalia, **de ponta a ponta e sem intervenção humana**, a performance de **TODAS as campanhas
com gasto na janela** da conta Google Ads `4342319594` (Blog B2 Tech, BRL) — hoje 100% Search.
Espelho Google da `funnel-analytics-brunobracaioli-campaign` (Meta): mesmo contrato de
autonomia, mesmas tabelas de persistência (ADR 0004), diferenciadas por `analyses.channel='google_ads'`.

> Disparos: cron do runner Fly.io **diário 08:30 BRT** (`crontab`) e fila `agent_jobs`
> (**kind=`analyze_google`**, via Ultron). Migration: `20260703000002_google_ads_analysis.sql`.

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Escrita para **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`** nem pare esperando confirmação — deadlock. Em qualquer
   dúvida ou erro: decida sozinho com os defaults da §3, registre no manifest e siga.
2. **READ-ONLY na conta Google.** Esta skill **só lê**. Nenhuma tool de escrita
   (`create_*`, `add_*`, `update_*`, `pause_*`, `apply_recommendations`) está no
   `allowed-tools` e nenhuma deve ser chamada. As recomendações vão pro banco; um humano decide.
3. **Resolva erros por conta própria.** Tool quebrada ou campo ausente → registre a limitação
   no manifest e siga com o que tem. Só aborte se for impossível ler qualquer dado — e mesmo
   aí grave `analyses` com `overall_verdict='error'` antes de sair (exit ≠ 0).
4. **Cliente é fixo: `brunobracaioli`.** Não generalize.
5. **Sempre grave a rodada.** Toda execução produz exatamente 1 linha em `analyses` (mesmo
   `no_data`/`error`). É o sinal que o runner e o dashboard inspecionam.

**Passo 0 — detecte a origem do disparo** (só afeta `triggered_by`, nada mais):

```bash
[ -n "${AGENT_JOB_ID:-}" ] && echo "ORIGEM=fila job=${AGENT_JOB_ID}" || echo "ORIGEM=cron/interativo"
```

`AGENT_JOB_ID` presente (poller da fila) → `triggered_by='ultron'`; ausente (cron diário ou
sessão interativa) → `triggered_by='cron'`. Nos dois casos as regras de autonomia acima valem
integralmente — esta skill nunca tem pontos interativos.

---

## 2. Constantes do cliente

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Conta Google Ads | `customer_id: 4342319594` (Blog B2 Tech, BRL) — passe `customer_id` explícito em toda tool |
| Conta manager (NÃO usar) | `1720061401` — restrita, nunca consulte insights nela |
| Moeda / fuso | `BRL` · `America/Sao_Paulo` |
| Escopo | **TODAS as campanhas com gasto na janela**, qualquer status — inclusive criadas manualmente |
| Budget cap | `5000` cents/dia (R$50) **por campanha** — checar `budget_amount` de cada uma; se exceder, finding `severity='medium'`, `metric_focus='budget'` |

`client_id` (uuid): lookup via REST no início —
`GET ${SUPABASE_URL%/}/rest/v1/clients?slug=eq.brunobracaioli&select=id` (headers da §4.1).
Valor esperado: `fe1b93e9-2f23-4949-897e-59a5c5130788` (use o lookup como fonte de verdade;
o literal é só verificação de sanidade).

---

## 3. Modelo de dados + framework de diagnóstico

### 3.1 Shape do connector (validado ao vivo 2026-07-03)

`get_insights(customer_id, level, date_preset|time_range_since+until, limit)` — níveis
`customer|campaign|ad_group|ad`. Cada linha:

```json
{"impressions":231,"clicks":10,"ctr":0.0433,"cost":51.48,"average_cpc":5.15,
 "conversions":0,"conversions_value":0,
 "campaign_id":"...","campaign_name":"..."}        // ad_group_id/ad_group_name no level ad_group
                                                    // ad_id (sem nome) no level ad
```

- **`cost`/`average_cpc` já vêm em REAIS** (o connector converte micros → unidades de moeda).
  Para o banco: `*_cents = round(valor * 100)`. **NÃO divida por 10.000** — micros só aparecem
  em `budget_amount_micros` do `list_campaigns` (que também traz `budget_amount` pronto).
- `ctr` é **fração** (0.0433 = 4,33%). Persista como veio (coluna `ctr numeric`).
- Linhas com tudo zerado aparecem para entidades sem tráfego — filtre `cost > 0` para análise;
  ordenação é por custo desc; linha final `{"_truncated": ...}` (ou `{}` vazia no search-terms)
  não é erro — ignore.
- Janela custom: `time_range_since` E `time_range_until` juntos (`YYYY-MM-DD`) — um só é erro.
- **Não existe level `keyword` no get_insights** — métrica de termo vem do search-terms report.

`get_search_terms(customer_id, date_preset, ...)` — por linha: `search_term`,
`status` (**NONE**=não é keyword | **ADDED**=já é keyword | **EXCLUDED**=já negativado),
`matched_keyword`, `match_type`, `campaign_id`, `ad_group_id`, `impressions`, `clicks`,
`ctr`, `cost`, `conversions`.

`list_campaigns` — `id, name, status (ENABLED|PAUSED|REMOVED), advertising_channel_type,
bidding_strategy_type, budget_amount` (reais). Use para `active_entities` (status ENABLED),
bidding strategy e checagem do cap.

`get_recommendations` — ⚠️ **QUEBRADA no connector em 2026-07-03** (GAQL com campos
`recommendation.impact.*` não reconhecidos pela API). Chame 1x mesmo assim (pode ter sido
corrigida); se der erro, registre em `errors[]` do manifest e **siga sem ela** — nunca aborte
por causa dela. Se funcionar, cada recomendação vira finding `severity='info'`,
`recommendation_type='observe'`, com o tipo do Google em `evidence`.

`list_conversion_actions` — cheque se há action `ENABLED`. Hoje existe 1 (`PAGE_VIEW`,
"Visualização de página") — conversões fracas: trate `conversions` como sinal secundário,
não como north-star, enquanto não houver action de compra/lead.

### 3.2 North-star por bidding strategy ("NUNCA métrica isolada")

Toda conclusão **cruza ≥2 métricas** e ancora na estratégia de lance da campanha:

| Bidding strategy | North-star | Diagnóstico secundário |
|---|---|---|
| `TARGET_SPEND` (max cliques — caso atual) | **CPC médio** + volume de cliques | CTR (Search saudável ≥ 2-3%; nichado pode passar de 15%), custo/dia vs budget |
| `MAXIMIZE_CONVERSIONS` / tCPA | CPA = cost/conversions | CVR, volume de conversões |
| `MAXIMIZE_CONVERSION_VALUE` / tROAS | ROAS = conversions_value/cost | ticket médio, CVR |

### 3.3 Matriz relacional (Search)

```
CPC=cost/clicks · CTR=clicks/impressions · CPM=cost/impressions×1000
CPA=cost/conversions · ROAS=conversions_value/cost
```

| Sintoma combinado | Diagnóstico provável | recommendation_type |
|---|---|---|
| CPC↑ + CTR↓ | anúncio/keyword com relevância fraca (QS baixo) | `adjust_keywords` |
| CPC↑ + CTR ok | leilão caro no termo — concorrência, não copy | `observe` (ou `reallocate_budget` p/ ad group mais barato) |
| search term irrelevante com custo (status NONE, intenção ≠ produto: "grátis", "download", "udemy", "login", tema alheio) | desperdício de budget em query errada | `add_negative_keywords` |
| keyword ADDED com muitas impressões + CTR↓↓ vs irmãs | keyword atrai busca errada | `adjust_keywords` |
| CTR alto + clicks ok + conversions=0 com action ENABLED | gargalo pós-clique (LP/tag) | `fix_landing_page` |
| irmã com mesmo CPC a 2x+ o custo total | realocar para a vencedora | `reallocate_budget` |
| tudo saudável + gasto << budget diário | impression share limitado — dá pra crescer | `scale` (respeitar cap R$50) |
| `budget_amount` > R$50 | acima do cap do cliente | `reallocate_budget`, `metric_focus='budget'` |

**Âncora de tendência:** janela atual vs `compare` (delta %) e vs `metric_snapshots` de rodadas
anteriores da MESMA entidade (`channel='google_ads'`) — com cadência diária o histórico interno
é a âncora mais confiável.

**Gates de significância** (nicho pequeno — não agir no ruído → `is_significant=false`,
`recommendation_type='observe'`): `impressions < 100`, ou `clicks < 10`, ou `cost < R$10`
na janela. Termo de busca individual: só vira finding de negativa com `cost ≥ R$5` OU
`clicks ≥ 3` sem relevância.

**Defaults de entrada** (`$ARGUMENTS`, `key=value`): `window=last_7d`,
`compare=previous_period` (= os 7 dias imediatamente anteriores, via
`time_range_since`/`until`). Presets aceitos: os do connector (`today ... maximum`).

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- Detecção de origem (§1) + `DATE=$(TZ=America/Sao_Paulo date +%F)`,
  `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- Carregar env: se existir `.env.local`, `set -a && eval "$(tr -d '\r' < .env.local)" && set +a`
  (strip de CRLF obrigatório; tolere ausência — no runner os envs já vêm de `fly secrets`).
- Exigir `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (fallback `SUPABASE_SERVICE_ROLE_KEY`) — sem
  eles não há persistência: aborte cedo com mensagem clara (exit ≠ 0).
- `TRY_DIR=tentativas-geracao-de-campanhas`; `mkdir -p "$TRY_DIR"`.
- Parse de overrides do `$ARGUMENTS`; aplicar defaults da §3.3. Calcular as datas da janela
  de comparação. Marcar `run_started_at` (UTC).

### Passo 1 — Pré-condições
- `client_id` via REST (§2). Falhou → sem como gravar: exit ≠ 0 com log claro.
- `google_token_status` → exigir autenticado na conta certa. Inválido → gravar `analyses`
  com `overall_verdict='error'`, `channel='google_ads'`, e sair (não chame
  `google_login`/`google_refresh_token` — são interativos).

### Passo 2 — Coleta (read-only)
Sempre `customer_id: 4342319594` explícito:
1. `list_campaigns(limit=200)` → status, bidding strategy, `budget_amount` (cap R$50),
   `active_entities` = count ENABLED.
2. `get_insights(level="campaign", date_preset=window)` → base da análise. Repetir com
   `time_range_since/until` da janela de comparação.
3. `get_insights(level="ad_group")` e `level="ad"` na janela atual (comparação por entidade
   filha é opcional; priorize campanha).
4. `get_search_terms(date_preset=window)` → candidatos a negativa / keywords fracas.
5. `get_recommendations()` → best-effort (§3.1 — quebrada? registre e siga).
6. `list_conversion_actions()` → contexto de conversão (há action ENABLED? de que tipo?).

Payloads desta conta são pequenos (≤ ~15 campanhas) — nada de `tool-results/` gigante; se um
dia estourar, processe o arquivo com `jq`/`python3`, nunca leia inteiro no contexto.

### Passo 3 — Caminho `no_data`
Se **nenhuma** campanha teve `cost > 0` na janela: 1 linha em `analyses` com
`overall_verdict='no_data'`, `channel='google_ads'`, `active_entities` conforme
`list_campaigns`, + 1 finding `info` ("Nenhuma campanha Google Ads com gasto no período",
`recommendation_type='none'`, `is_significant=false`, `level=null`). Seguir p/ Passos 6-8.
**Não é erro** — é o estado esperado enquanto tudo está PAUSED.

### Passo 4 — Diagnóstico (aplicar §3)
Para cada campanha com gasto: derivar métricas, cruzar conforme a matriz, aplicar gates,
comparar tendência, rankear irmãs. Search terms: classifique a intenção de cada termo com
custo relevante contra o produto do ad group (CCA-F Prep/cursos Claude/tráfego pago — veja o
nome do ad group); termo alheio → finding `add_negative_keywords` com o termo exato em
`evidence` e no `recommended_action` ("negativar '<termo>' em PHRASE na campanha X").
Produzir `overall_verdict` ∈ {`healthy`,`watch`,`underperforming`,`learning`} e findings
priorizados — cada `diagnosis` cita a relação entre ≥2 métricas
(ex.: "CPC R$5,15 com CTR 4,3%: leilão caro, não copy — 'vibe coding' custou R$20 sem conversão").

### Passo 5 — Persistir no Supabase (100% via REST)
⚠️ **Não use o MCP do Supabase** — no headless ele é OAuth-gated e não está disponível
(gotcha validado). Tudo via PostgREST:

```bash
H=(-H "apikey: ${SUPABASE_SECRET_KEY}" -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" -H "Content-Type: application/json")
```

- **`analyses`** (1 linha, `-H "Prefer: return=representation"` para capturar o `id`):
  `client_id, channel:'google_ads', objective` = lista distinta de bidding strategies com
  gasto (ex.: `'TARGET_SPEND'`), `window_start, window_stop, compare_window_start,
  compare_window_stop, entities_analyzed, active_entities, overall_verdict, summary,
  manifest_path, triggered_by` (§1), `run_started_at, run_finished_at`.
- **`metric_snapshots`** (1 POST com array JSON, `Prefer: return=minimal`; 1 item/entidade
  com gasto): `analysis_id, client_id, level` ∈ {`campaign`,`ad_group`,`ad`},
  `meta_entity_id` = resource name Google (`customers/4342319594/campaigns/<id>`,
  `.../adGroups/<id>`, `.../ads/<id>`), `entity_name` (ads não têm nome → `null`),
  `date_start, date_stop`, e o mapeamento:
  `impressions→impressions` · `clicks→link_clicks` · `ctr→ctr` (fração) ·
  `round(cost*100)→spend_cents` · `round(average_cpc*100)→cpc_cents` ·
  `round(cost/impressions*1000*100)→cpm_cents` (null se 0 impressões) ·
  `conversions→results` · `round(cost/conversions*100)→cost_per_result_cents` (null se 0).
  Meta-only (`reach, frequency, landing_page_views, cplpv_cents, outbound_ctr, *_ranking`)
  = null. `raw` = linha bruta do connector + derivados + (no level campaign) top search
  terms do período.
- **`analysis_findings`** (1 POST com array): `analysis_id, client_id, level`
  (`campaign`/`ad_group`/`ad`/`keyword`; achado de conta → `null`), `meta_entity_id`
  (para `keyword`: o próprio termo de busca), `entity_name, severity, metric_focus,
  diagnosis, evidence` (jsonb com os números), `recommended_action, recommendation_type`
  (inclui os novos `add_negative_keywords`/`adjust_keywords`), `confidence, is_significant`.
- **NÃO** grave em `funnel_events` (funil de 7 etapas é Meta-specific) nem em
  `campaigns/ad_sets/ads` (schema Meta).
- Cheque cada POST: `-w '%{http_code}'` esperando 2xx. Falha de escrita → tente 1 retry;
  persistindo, manifest `verified:false` + exit ≠ 0.

### Passo 6 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-google-ads.json`:
```json
{
  "skill": "google-ads-analytics-brunobracaioli",
  "client": "brunobracaioli",
  "channel": "google_ads",
  "date": "...",
  "verified": true,
  "connector": "MCP_GOOGLE_ADS_B2_TECH",
  "window": {"window": "last_7d", "compare": "previous_period"},
  "analysis_id": "...",
  "overall_verdict": "no_data|healthy|watch|underperforming|learning|error",
  "entities_analyzed": 0,
  "active_entities": 0,
  "campaigns": [{"id":"...","name":"...","cost":0,"clicks":0,"cpc":null,"ctr":null,"verdict":"..."}],
  "negative_keyword_candidates": ["..."],
  "findings": [{"severity":"info","metric_focus":"...","diagnosis":"...","recommendation_type":"none","is_significant":false}],
  "decisions": [],
  "errors": []
}
```
Se algo falhou, `verified:false` + `errors[]`. **Sempre** escreva o manifest.

### Passo 7 — Notificar no Telegram (best-effort)
`TELEGRAM_CHAT_ID` ausente ou tool indisponível → pular com log ("Telegram pulado") e seguir —
nunca trave o headless. Presente → resumo curto (veredito + CPC/CTR das top campanhas + top 3
findings) via `mcp__plugin_telegram_telegram__reply`.

### Passo 8 — Resumo final (stdout)
Tabela por campanha (nome, status, spend, clicks, CPC, CTR, veredito) + candidatos a negativa
+ `overall_verdict` + recomendações priorizadas. Fechar com: **"Análise read-only — nenhuma
alteração feita na conta Google Ads. Métricas + recomendações gravadas no Supabase para
decisão humana."**

---

## 5. Critério de sucesso
- Exatamente 1 linha em `analyses` com `channel='google_ads'` (mesmo `no_data`/`error`).
- 1 `metric_snapshots` por entidade com gasto, dinheiro em cents (reais × 100), IDs como
  resource names Google.
- Cada finding cruza ≥2 métricas com `evidence`; candidatos a negativa citam o termo exato.
- Manifest JSON em `${TRY_DIR}/`.
- **Zero** chamadas de escrita no Google Ads (verificável pelo `allowed-tools`).

## 6. Anti-padrões (NÃO faça)
- ❌ `AskUserQuestion` ou parar para pedir confirmação.
- ❌ Qualquer mutação no Google Ads (`apply_recommendations` incluso — recomendação é para
  humano decidir).
- ❌ Usar o MCP do Supabase para persistir — headless não tem; é REST sempre.
- ❌ Dividir `cost` por 10.000 — o connector JÁ entrega reais; cents = × 100.
- ❌ Consultar a conta manager `1720061401`.
- ❌ Concluir a partir de uma métrica isolada; julgar CTR de nicho pelos benchmarks de
  display/social.
- ❌ Tratar `no_data` como erro (estado esperado com tudo PAUSED).
- ❌ Abortar porque `get_recommendations` quebrou (best-effort, §3.1).
- ❌ Gravar `funnel_events` ou as tabelas `campaigns/ad_sets/ads`.

## 7. Pré-requisitos
- Migration `20260703000002_google_ads_analysis` aplicada (channel + levels + kinds).
- Connector `MCP_GOOGLE_ADS_B2_TECH` autenticado (token no Supabase, `google_token_status`).
- `SUPABASE_URL` + `SUPABASE_SECRET_KEY` no ambiente (runner: `fly secrets`; local: `.env.local`).
- Opcional: `TELEGRAM_CHAT_ID`.
