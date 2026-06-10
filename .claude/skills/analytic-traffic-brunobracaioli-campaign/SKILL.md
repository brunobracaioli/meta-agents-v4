---
name: analytic-traffic-brunobracaioli-campaign
description: Analisa de forma 100% autônoma e headless a performance de TODAS as campanhas ativas Meta Ads do cliente brunobracaioli (qualquer objetivo — tráfego, vendas, engajamento) — lê métricas via MCP da Meta (read-only), diagnostica cruzando métricas (nunca métrica isolada) com north-star por objetivo (CPLPV p/ tráfego, CPA p/ vendas, custo/engajamento p/ engajamento), e persiste análise + recomendações estruturadas no Supabase (analyses, metric_snapshots, analysis_findings) + manifest + Telegram. NÃO altera nada na conta Meta. Use quando pedirem "analisar performance das campanhas de brunobracaioli/CCA", ou quando disparada via cron DIÁRIO (`claude -p --dangerously-skip-permissions ".claude/skills/analytic-traffic-brunobracaioli-campaign"`).
argument-hint: "[window=last_7d] [compare=previous_period] [level=ad]"
allowed-tools: Read, Bash, Glob, Write, mcp__claude_ai_Meta_Ads_MCP__ads_get_ad_accounts, mcp__claude_ai_Meta_Ads_MCP__ads_get_ad_entities, mcp__claude_ai_Meta_Ads_MCP__ads_insights_performance_trend, mcp__claude_ai_Meta_Ads_MCP__ads_insights_anomaly_signal, mcp__claude_ai_Meta_Ads_MCP__ads_insights_auction_ranking_benchmarks, mcp__claude_ai_Meta_Ads_MCP__ads_insights_industry_benchmark, mcp__claude_ai_Meta_Ads_MCP__ads_get_opportunity_score, mcp__claude_ai_Meta_Ads_MCP__ads_get_errors, mcp__claude_ai_Meta_Ads_MCP__ads_get_field_context, mcp__claude_ai_Meta_Ads_MCP__ads_insights_advertiser_context, mcp__supabase__execute_sql, mcp__supabase__list_tables, mcp__plugin_telegram_telegram__reply
---

# Skill: /analytic-traffic-brunobracaioli-campaign

Avalia, **de ponta a ponta e sem intervenção humana**, a performance de **TODAS as campanhas
ativas** do cliente **brunobracaioli** no Meta Ads — qualquer objetivo (`OUTCOME_TRAFFIC`/
`LINK_CLICKS`, `OUTCOME_SALES`, `OUTCOME_ENGAGEMENT`, ...): lê as métricas via
MCP da Meta → diagnostica com boas práticas de tráfego pago **cruzando as métricas entre si e com o
objetivo de cada campanha** → persiste análise + recomendações estruturadas no Supabase → manifest
→ Telegram.

> Contraparte da `create-traffic-brunobracaioli-campaign`. O runner Fly.io
> (`docs/specs/flyio-cron-campaign-runner.md`) dispara esta skill **diariamente** às 08h BRT.
> **Toda a inteligência está aqui**; o runner é uma casca fina
> (`timeout 1500 claude -p --dangerously-skip-permissions ...`).
> Spec: `docs/specs/meta-ads-performance-analysis.md` · ADR: `docs/adr/0004-...`.

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Sem humano para responder, a sessão entra em deadlock. Em
   qualquer dúvida ou erro: **decida sozinho** com os defaults da §3, registre no manifest e siga.
2. **READ-ONLY na conta Meta.** Esta skill **só lê**. **NUNCA** chame `ads_update_entity`,
   `ads_activate_entity`, `ads_create_*` nem qualquer mutação. As recomendações são gravadas no
   banco para um humano decidir — a skill **não age** na conta, sob nenhuma condição.
3. **Resolva erros por conta própria.** Use `ads_get_errors`/`ads_get_field_context` para
   diagnosticar. Se uma tool de insights faltar um campo, use proxies (§3) e registre a limitação.
   Só aborte se for impossível ler qualquer dado — e mesmo aí, **grave `analyses` com
   `overall_verdict='error'`** e o manifest com `verified:false` antes de sair.
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
| Ad Account | `225179730538661` (alias `act_225179730538661`) |
| Business Manager | `772813643612039` |
| Facebook Page | `867347659802006` |
| Escopo da análise | **TODAS as campanhas ativas com gasto na janela**, qualquer objetivo (`OUTCOME_TRAFFIC`/`LINK_CLICKS`, `OUTCOME_SALES`, `OUTCOME_ENGAGEMENT`, ...) — inclusive campanhas criadas manualmente pelo operador |
| Budget cap | `5000` cents/dia (R$50) **por campanha** · moeda `BRL` — **checar `daily_budget` de cada campanha ativa**: se exceder o teto, emitir finding `severity='medium'`, `metric_focus='budget'` para decisão humana |
| Geo das campanhas | `BR` (bloqueio antigo resolvido — ver §7) |

A escrita no Supabase é **via MCP** (`execute_sql`) — não precisa de chave no `.env.local`. A única
env opcional é `TELEGRAM_CHAT_ID` (§4 Passo 7).

---

## 3. Framework de diagnóstico (o coração — "NUNCA métrica isolada")

Toda conclusão **cruza ≥2 métricas** e as ancora **no objetivo da campanha analisada**. Nunca
declare "CPC alto" ou "CTR baixo" sozinhos — eles só significam algo em relação.

**North-star por objetivo** (validado na rodada manual de 2026-06-10):

| Objetivo da campanha | North-star | Diagnóstico secundário |
|---|---|---|
| `OUTCOME_TRAFFIC` / `LINK_CLICKS` | `CPLPV` (proxy: CPC link) | CTR link, LPV% = LPV/cliques |
| `OUTCOME_SALES` | `CPA` (custo por compra) | funil LPV → checkout iniciado → compra; CPM alto **+** CTR ok ⇒ leilão/audiência cara (pixel de compra), não criativo |
| `OUTCOME_ENGAGEMENT` | custo/engajamento; CPM + frequência | **NÃO julgar por CTR link** — CTR link baixo não é defeito nesse objetivo |

CTR(link) e CPC(link) são diagnósticos de *onde* o funil quebra, em qualquer objetivo.

**Comparação entre campanhas irmãs do mesmo objetivo** (CPA vs CPA, CPLPV vs CPLPV) é o critério
para `reallocate_budget`: se uma irmã entrega o mesmo resultado a 2x+ o custo com volume comparável,
recomende realocar para a vencedora (ex. real: VENDAS-LP CPA R$22,89 vs CRIATIVOS-FULL R$67,18).

**Identidades do funil** (é isto que torna ilegítimo olhar uma métrica só):
```
CPM   = spend / impressões × 1000
CTR   = clicks(link) / impressões
CPC   = spend / clicks(link) = CPM / (CTR × 10)
LPV%  = landing_page_views / clicks(link)
CPLPV = spend / landing_page_views = CPC / LPV%
freq  = impressões / alcance
```

**Matriz de diagnóstico relacional** (sempre cruzar):

| Sintoma combinado | Diagnóstico provável | recommendation_type |
|---|---|---|
| CPC↑ + CTR↓ | criativo/relevância fraca (não atrai o clique) | `rotate_creative` |
| CPC↑ + CTR ok | CPM alto — leilão/competição/audiência cara (não é o criativo) | `adjust_audience` |
| CTR ok + CPC ok + CPLPV↑ | gargalo pós-clique (LP lenta, pixel/LPV não dispara, mismatch) | `fix_landing_page` |
| CTR↓ no tempo + frequência↑ | fadiga de criativo | `rotate_creative` |
| CPM↑ + frequência baixa no início | fase de aprendizado (dados imaturos) | `observe` |
| tudo saudável + volume baixo | restrição de budget/audiência | `scale` (respeitar cap R$50) |

Rankings de leilão (`quality_ranking` etc.) **não são expostos** pelo MCP nesta conta (§7) — não
peça esses campos; registre a limitação no manifest.

**Âncoras (relativo, não absoluto):**
- `ads_insights_industry_benchmark` + `ads_insights_auction_ranking_benchmarks` → tente, mas nesta
  conta costumam retornar "no data" (§7). Quando vazios, a âncora principal é a tendência interna.
- **Tendência**: janela atual vs `compare` (delta %) **e** vs `metric_snapshots` de rodadas
  anteriores (mesma entidade no tempo) — com cadência diária, o histórico em `metric_snapshots` é a
  âncora mais confiável. `ads_insights_performance_trend` e `ads_insights_anomaly_signal` são
  complementares (frequentemente "no data").
- **Entre irmãos**: rankeie ads do mesmo ad set entre si e campanhas irmãs do mesmo objetivo →
  vencedor/perdedor.

**Gates de significância / fase de aprendizado** (não agir no ruído → `is_significant=false`,
`recommendation_type='observe'`):
- ad set em **aprendizado** (< ~50 eventos de otimização em 7d), ou
- abaixo dos pisos: `impressions < 1000`, `link_clicks < 50`, `spend_cents < 1000` (R$10), ou
  `< 3 dias` veiculando na janela.

**Defaults de entrada** (`$ARGUMENTS`, `key=value`): `window=last_7d`, `compare=previous_period`,
`level=ad`. Sempre agregue para cima (ad → ad_set → campaign).

---

## 4. Passo a passo

### Passo 0 — Setup
Em uma chamada Bash:
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- Carregar env (opcional, só para `TELEGRAM_CHAT_ID`): se existir `.env.local` na raiz,
  `set -a && eval "$(tr -d '\r' < .env.local)" && set +a` (tolere ausência).
- `TRY_DIR=tentativas-geracao-de-campanhas`; `mkdir -p "$TRY_DIR"`.
- Parse de overrides do `$ARGUMENTS`; aplicar defaults da §3.
- Marcar `run_started_at` (agora, UTC).

### Passo 1 — Pré-condições (banco + Meta)
- `list_tables` (schema `public`) → confirmar `analyses`, `metric_snapshots`, `analysis_findings`.
  Se faltarem → gravar manifest `verified:false` ("migration add_meta_ads_performance_analysis
  ausente") e sair (nada a fazer).
- Lookup `client_id`: `SELECT id FROM clients WHERE slug='brunobracaioli'`.
- `ads_get_ad_accounts` → confirmar `225179730538661` acessível (sanity da conexão Meta).
- Se a conta/MCP não responder → `analyses` com `overall_verdict='error'`, manifest
  `verified:false`, e sair.

### Passo 2 — Coletar métricas (read-only)
- `ads_get_ad_entities` na conta `225179730538661` (ID numérico, sem `act_`), com insights na
  `window` (`date_preset`) **e** na `compare` (`time_range` explícito `{"since","until"}` — nunca
  os dois juntos), nos níveis `campaign`, `adset` e `ad` (atenção: o parâmetro `level` usa `adset`
  sem underscore; a coluna do banco usa `ad_set`).
- **Campos que o MCP aceita** (nomes diferem do Graph API padrão — validado em 2026-06-10):
  `id, name, status, effective_status, objective` (campaign), `optimization_goal, campaign_id`
  (adset), `adset_id, creative_id` (ad), `daily_budget, impressions, reach, frequency,
  amount_spent, clicks, ctr, cpc, cpm, actions:link_click, cost_per_link_click, results,
  cost_per_result`.
  **NÃO peça** (erro de validação): `actions` genérico, `inline_link_clicks`,
  `inline_link_click_ctr`, `spend`, `quality_ranking`/`engagement_rate_ranking`/
  `conversion_rate_ranking` (não expostos). Em dúvida, `ads_get_field_context`.
- **Outputs estouram o limite de tokens** (a conta tem 117+ campanhas históricas): o resultado vai
  para um arquivo em `tool-results/`. **Nunca leia o arquivo inteiro no contexto** — processe com
  python3/jq (`.ad_entities | fromjson`), filtrando `spend > 0` antes de qualquer análise.
- **Valores vêm localizados** (`"R$16,12 BRL"`, `"4,84%"`, `"1.808"`) → parsear para cents
  inteiros/float (regex `R\$\s*([\d\.]+),(\d{2})`; cuidado com ` ` NBSP).
- **LPV e compras vêm de `results.all_conversion_types`** (strings `"N (Landing page views)"`,
  `"N (Purchases)"`, `"N (Checkouts initiated)"`) e **só no nível campaign**; para `ad_set`/`ad`
  use `link_clicks` como proxy do funil e registre no manifest.
- Contexto/âncoras (tentar, tolerar "no data"): `ads_insights_advertiser_context`,
  `ads_get_opportunity_score`, `ads_insights_industry_benchmark`,
  `ads_insights_auction_ranking_benchmarks`, `ads_insights_performance_trend`,
  `ads_insights_anomaly_signal`.
- Derivar por entidade: CTR link = `actions:link_click`/impressões; CPC link =
  `cost_per_link_click`; CPLPV = spend/LPV; CPA = spend/compras; LPV% = LPV/cliques link.

### Passo 3 — Caminho `no_data` (estado esperado hoje)
Se **nenhuma** entidade teve `spend_cents > 0` na janela (tudo PAUSED / sem entrega):
- Inserir 1 `analyses` com `overall_verdict='no_data'`, `active_entities=0`.
- Inserir 1 `analysis_findings` `info`: "Nenhuma campanha ativa com gasto no período. Ative no Ads
  Manager para gerar dados de performance." (`recommendation_type='none'`, `is_significant=false`).
- (Opcional) gravar `metric_snapshots` zerados das entidades existentes para histórico.
- Seguir para Passo 6 (manifest) e Passo 7 (Telegram). **Não é erro** — sai com sucesso.

### Passo 4 — Diagnóstico (aplicar §3)
Para cada entidade com entrega, derivar as métricas do funil, então **cruzar** conforme a matriz da
§3, aplicar os gates de significância, ancorar em benchmarks, comparar tendência (vs `compare` e vs
snapshots anteriores) e rankear os ângulos irmãos. Produzir:
- `overall_verdict` da rodada ∈ {`healthy`,`watch`,`underperforming`,`learning`}.
- Lista priorizada de findings (`severity` por impacto), cada um com `diagnosis` que **menciona
  explicitamente a relação entre as métricas** (ex.: "CPC R$X alto **apesar de** CTR Y% saudável →
  CPM R$Z elevado: custo está no leilão/audiência, não no criativo") e `evidence` (jsonb com os
  números que sustentam).

### Passo 5 — Persistir no Supabase (via MCP)
Via `mcp__supabase__execute_sql` (dinheiro em `*_cents`, IDs Meta em `text`):
- **`analyses`** (insert, capturar `id` retornado via `RETURNING id`): `client_id, objective,
  window_start, window_stop, compare_window_start, compare_window_stop, entities_analyzed,
  active_entities, overall_verdict, summary, manifest_path, triggered_by='cron', run_started_at,
  run_finished_at=now()`. **`objective` = lista distinta dos objetivos com gasto na janela**, em
  ordem alfabética e separada por vírgula (ex.: `'LINK_CLICKS,OUTCOME_ENGAGEMENT,OUTCOME_SALES'`)
  — a coluna é text livre, backward-compatible.
- **`metric_snapshots`** (1 por entidade): `analysis_id, client_id, level, meta_entity_id,
  entity_name, date_start, date_stop, impressions, reach, frequency, spend_cents, link_clicks, ctr,
  outbound_ctr, cpc_cents, cpm_cents, landing_page_views, cplpv_cents, results,
  cost_per_result_cents, quality_ranking, engagement_rate_ranking, conversion_rate_ranking, raw`.
- **`analysis_findings`** (1 por achado): `analysis_id, client_id, level, meta_entity_id,
  entity_name, severity, metric_focus, diagnosis, evidence, recommended_action, recommendation_type,
  confidence, is_significant`.
- Semântica de `results`/`cost_per_result_cents` por objetivo: compras/CPA para `OUTCOME_SALES`,
  LPV/CPLPV para tráfego, NULL para engajamento (sem métrica de custo/engajamento exposta). O `ctr`
  persistido é o **CTR de link**; o ctr bruto (all clicks) vai no `raw`.
- Idempotência: `metric_snapshots` tem unique `(analysis_id, level, meta_entity_id)` →
  `ON CONFLICT DO UPDATE`. Escape de strings em SQL (use aspas simples duplicadas ou jsonb via
  `$$...$$`); nunca quebre por copy com apóstrofo.

### Passo 6 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-analise.json`:
```json
{
  "skill": "analytic-traffic-brunobracaioli-campaign",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "window": {"window": "last_7d", "compare": "previous_period"},
  "analysis_id": "...",
  "overall_verdict": "no_data|healthy|watch|underperforming|learning|error",
  "entities_analyzed": 0,
  "active_entities": 0,
  "snapshots": [{"level":"ad","meta_entity_id":"...","spend_cents":0,"ctr":null,"cpc_cents":null,"cplpv_cents":null}],
  "findings": [{"severity":"info","metric_focus":"...","diagnosis":"...","recommendation_type":"none","is_significant":false}],
  "objectives": ["LINK_CLICKS","OUTCOME_SALES"],
  "decisions": ["window=last_7d","LPV só no nível campaign (proxy link_clicks em ad_set/ad)"],
  "errors": []
}
```
Se algo falhou, `verified:false` + `errors[]`. **Sempre** escreva o manifest.

### Passo 7 — Notificar no Telegram (toda rodada, com fallback)
- Ler `TELEGRAM_CHAT_ID` do ambiente. Se **vazio/ausente** → pular Telegram, logar
  "Telegram pulado (TELEGRAM_CHAT_ID ausente) — resultado em manifest+Supabase" e seguir.
- Se presente, montar resumo curto (veredito + top 3 findings com a relação de métricas) e chamar
  `mcp__plugin_telegram_telegram__reply` com `chat_id=$TELEGRAM_CHAT_ID`.
- Se a tool falhar/indisponível → **fallback log-only** (nunca trave o headless por causa disso).

### Passo 8 — Resumo final (stdout)
Tabela por entidade (nível, nome, spend, CTR, CPC, CPLPV, veredito) + `overall_verdict` + as
recomendações priorizadas. Fechar com: **"Análise read-only — nenhuma alteração feita na conta
Meta. Recomendações gravadas no Supabase para decisão humana."**

---

## 5. Critério de sucesso
- 1 linha em `analyses` (mesmo em `no_data`/`error`) + `metric_snapshots`/`analysis_findings`
  coerentes.
- Cada finding com gasto cruza ≥2 métricas em `diagnosis` e tem `evidence`.
- Manifest JSON gravado em `${TRY_DIR}/`.
- **Zero** chamadas de escrita na Meta (read-only verificável).
- Telegram enviado (ou fallback log-only registrado).

## 6. Anti-padrões (NÃO faça)
- ❌ Chamar `AskUserQuestion` ou parar para pedir confirmação.
- ❌ Chamar `ads_update_entity` / `ads_activate_entity` / `ads_create_*` / qualquer mutação na conta.
- ❌ Concluir a partir de **uma métrica isolada** (sempre cruze ≥2 e ancore no objetivo).
- ❌ Emitir veredito forte sem passar pelos gates de significância / fase de aprendizado.
- ❌ Tratar `no_data` como erro (é o estado esperado enquanto tudo está PAUSED).
- ❌ Deixar de gravar `analyses` ou o manifest.
- ❌ Travar o headless por falta de `TELEGRAM_CHAT_ID` ou indisponibilidade do Telegram.

## 7. Gotchas obrigatórios
- **Tudo PAUSED ⇒ sem dados** — a skill de criação nunca ativa (custo zero). Sem entrega não há
  impressões/gasto → caminho `no_data` (Passo 3). Geo: o bloqueio de anunciante BR
  ([[meta-br-advertiser-verification-blocker]]) **foi resolvido** — desde 2026-06-07 campanhas
  novas miram `BR` e entregam normalmente (CPM ~R$13 ≪ CPM do workaround US); se uma criação
  futura falhar com subcode 3858634, registrar (pode ser intermitente).
- **LPV/compras vêm de `results.all_conversion_types` e só no nível campaign** (Passo 2) — não
  existe campo `actions` genérico neste MCP. Sem LPV → `link_clicks`/CPC como proxy + manifest.
- **Campanhas manuais do operador entram na análise** — a conta tem campanhas criadas fora dos
  agents (vendas/engajamento, budgets próprios). Analise todas com o north-star do objetivo delas
  e cheque o teto de budget (§2); campanhas quase idênticas do mesmo objetivo merecem finding de
  possível sobreposição de leilão.
- **Fase de aprendizado distorce** — ad set com poucos eventos de otimização tem CPM/CPC instáveis;
  não diagnostique fadiga/ineficiência aí (gate da §3).
- **Telegram opcional** — connector pode não estar seedado no runner; `TELEGRAM_CHAT_ID` vai por
  `fly secrets`. Ausência ⇒ log-only, nunca falha.
- **Headless** — `--dangerously-skip-permissions` (igual à skill de criação). A confiança vem deste
  contrato: **read-only**, nenhuma tool de escrita na Meta no `allowed-tools`.

## 8. Pré-requisitos
- Migration `add_meta_ads_performance_analysis` aplicada (tabelas `analyses`, `metric_snapshots`,
  `analysis_findings`).
- MCP da Meta e MCP do Supabase autenticados (já feito).
- Opcional: `TELEGRAM_CHAT_ID` no ambiente (`.env.local` / `fly secrets`) para notificação.
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
