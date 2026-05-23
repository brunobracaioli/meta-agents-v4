# Spec — Análise de performance de campanhas Meta Ads (autônoma, a cada 3 dias)

> Status: implementado em 2026-05-23. ADR: [0004](../adr/0004-meta-ads-performance-analysis-schema.md).
> Skill: `.claude/skills/analytic-traffic-brunobracaioli-campaign/`.

## Objetivo

Avaliar, de forma **autônoma, headless e recorrente (a cada 3 dias)**, a performance das campanhas
de tráfego do cliente `brunobracaioli` no Meta Ads, e **persistir diagnóstico + recomendações de
forma estruturada e auditável** no Supabase — para que um humano (ou, em ondas futuras, um
decision-engine) decida as ações.

Princípio inegociável (pedido do usuário): **nunca analisar uma métrica isolada.** Toda conclusão
cruza ≥2 métricas e as ancora no **objetivo** da campanha (`OUTCOME_TRAFFIC` → otimização
`LANDING_PAGE_VIEWS`).

## Escopo

- **Read-only na Meta.** A skill **não** cria, edita, pausa nem ativa nada na conta. Só lê insights
  e grava análise no banco. Mantém a invariante do projeto ("tudo PAUSED até um humano decidir").
- Disparada pelo runner Fly.io (`docs/specs/flyio-cron-campaign-runner.md`) via supercronic, com o
  mesmo contrato headless da skill de criação (`claude -p --dangerously-skip-permissions`).
- Cliente fixo `brunobracaioli` (Onda 2). Generalização multi-cliente fica para onda futura.

## Contratos

### Entrada (overrides opcionais via `$ARGUMENTS`, `key=value`)
- `window` — janela principal de análise. Default `last_7d`.
- `compare` — janela de comparação para tendência. Default `previous_period`.
- `level` — granularidade-alvo (`ad`|`ad_set`|`campaign`). Default `ad` (sempre agrega para cima).

### Saída
1. Linhas em `analyses`, `metric_snapshots`, `analysis_findings` (schema abaixo).
2. Manifest JSON em `tentativas-geracao-de-campanhas/${STAMP}-analise.json`.
3. Resumo em stdout (inspecionado pelo runner / `/var/log/runs`).
4. Notificação Telegram (toda rodada) — com **fallback log-only** se a tool/`TELEGRAM_CHAT_ID`
   não estiver disponível (headless nunca trava).

## Framework de diagnóstico (boas práticas — "nunca métrica isolada")

### North-star e identidades do funil
Para tráfego, a métrica-objetivo é o **CPLPV** (custo por landing page view); CTR(link) e CPC(link)
são diagnósticos. As identidades que **ligam** as métricas (e que tornam ilegítimo olhar uma só):

```
CPM   = spend / impressões × 1000
CTR   = clicks(link) / impressões
CPC   = spend / clicks(link) = CPM / (CTR × 10)
LPV%  = landing_page_views / clicks(link)
CPLPV = spend / landing_page_views = CPC / LPV%
freq  = impressões / alcance
```

### Matriz de diagnóstico relacional (sempre cruzar ≥2 métricas)

| Sintoma combinado | Diagnóstico provável | recommendation_type |
|---|---|---|
| CPC↑ + CTR↓ | criativo/relevância fraca (ad não atrai o clique) | `rotate_creative` |
| CPC↑ + CTR ok | CPM alto — leilão/competição/audiência cara (não é o criativo) | `adjust_audience` |
| CTR ok + CPC ok + CPLPV↑ | gargalo pós-clique (LP lenta, pixel/LPV não dispara, mismatch) | `fix_landing_page` |
| CTR↓ ao longo do tempo + frequência↑ | fadiga de criativo | `rotate_creative` |
| CPM↑ + frequência baixa no início | fase de aprendizado (dados imaturos) | `observe` |
| tudo saudável + volume baixo | restrição de budget/audiência | `scale` (respeitar cap R$50) |

Rankings de leilão (`quality_ranking`, `engagement_rate_ranking`, `conversion_rate_ranking`)
contextualizam: quality baixo → criativo; conversion baixo → pós-clique/oferta.

### Âncoras (relativo, não absoluto)
- **Benchmark de indústria** e **auction ranking benchmarks** do MCP respondem "esse CTR/CPC é bom?".
- **Tendência**: janela atual vs `compare` (delta %) **e** vs snapshots anteriores acumulados em
  `metric_snapshots` (comparação inter-rodadas). Sinais de `performance_trend` e `anomaly_signal`.
- **Comparação entre irmãos**: rankear os 3 ângulos (autoridade/dor/oferta) entre si para achar
  vencedor/perdedor relativo.

### Gates de significância / fase de aprendizado (não agir no ruído)
Não emitir veredito forte (`is_significant=false`, `recommendation_type='observe'`) quando:
- ad set em **fase de aprendizado** (< ~50 eventos de otimização em 7 dias), ou
- abaixo dos pisos mínimos: `impressions < 1000`, `link_clicks < 50`, `spend_cents < 1000` (R$10),
  ou `< 3 dias` de veiculação na janela.

Os pisos são heurísticos e documentados aqui para revisão; ajustáveis sem mudar schema.

## Modelo de dados (3 tabelas, schema `public`)

```
clients ──< analyses ──< metric_snapshots
                  └─────< analysis_findings
```

| Tabela | Papel | Chave / unique |
|---|---|---|
| `analyses` | 1 linha por rodada (janela, veredito, resumo, manifest) | `id` |
| `metric_snapshots` | 1 linha por entidade por rodada (métricas cruas + derivadas) | `(analysis_id, level, meta_entity_id)` |
| `analysis_findings` | 1 linha por achado/recomendação (diagnóstico relacional) | `id` |

### Invariantes (herdadas do ADR 0002)
- Dinheiro em `*_cents` (integer; `>= 0` para métricas, pode ser 0).
- IDs do Meta em `text`.
- `metric_snapshots.cplpv_cents` = north-star (custo por landing page view).
- `analyses.overall_verdict ∈ {healthy, watch, underperforming, learning, no_data, error}`.
- `analysis_findings.recommendation_type ∈ {observe, rotate_creative, pause_loser, adjust_audience,
  fix_landing_page, reallocate_budget, scale, none}`; `severity ∈ {info,low,medium,high,critical}`;
  `confidence ∈ {low,medium,high}`.
- `analysis_findings.diagnosis` **deve** cruzar ≥2 métricas; `evidence` (jsonb) guarda os valores.
- Tabelas append-only (`created_at`/`captured_at`, sem `updated_at`).
- RLS habilitado deny-by-default; agente escreve via `service_role` (MCP do Supabase).

## Caminho `no_data`

Como a skill de criação deixa tudo **PAUSED** e nunca ativa, é o estado esperado hoje haver zero
gasto. Nesse caso: `analyses.overall_verdict='no_data'`, 1 finding `info`
("nenhuma campanha ativa com gasto no período; ative no Ads Manager para gerar dados"),
manifest com `verified:true`, notifica, e sai com sucesso. O diagnóstico completo só é exercitado
quando há entidade com `spend_cents > 0` na janela.

## Critérios de aceite

1. Migration `add_meta_ads_performance_analysis` aplicada; 3 tabelas com RLS; advisors sem novos
   erros além do `rls_enabled_no_policy` INFO esperado.
2. Rodada headless grava 1 `analyses` + N `metric_snapshots` + M `analysis_findings`, escreve o
   manifest e imprime o resumo — **sem nunca** chamar tool de escrita na Meta.
3. Sem gasto na janela → caminho `no_data` íntegro (não falha, não fica em deadlock).
4. Com gasto → cada finding tem `diagnosis` cruzando ≥2 métricas, `evidence` coerente, e passa (ou
   é marcado fora de) pelos gates de significância.
5. Cron a cada 3 dias registrado no `crontab` e validável com `supercronic -test`.

## Pendências / próximos passos
- Onda 3+: decision-engine consome `analysis_findings` para agir (exigirá sair do read-only).
- Definir RLS policies quando o app multi-tenant existir (mesma dívida do ADR 0002).
- Eventual view materializada de tendência por entidade (sobre `metric_snapshots`).
