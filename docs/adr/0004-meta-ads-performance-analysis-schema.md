# ADR 0004 — Schema e skill de análise de performance de campanhas Meta Ads

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-23 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/meta-ads-performance-analysis.md](../specs/meta-ads-performance-analysis.md) |
| Migrations | `add_meta_ads_performance_analysis` |
| Relacionado | [ADR 0001](0001-fly-machine-supercronic.md) (runner), [ADR 0002](0002-supabase-meta-ads-persistence-schema.md) (schema base) |

## Context

A agência já cria campanhas de tráfego de forma autônoma (skill
`create-traffic-brunobracaioli-campaign`, runner Fly.io 1×/dia). Faltava a contraparte de
**avaliação**: medir performance e produzir recomendações de otimização sem intervenção humana.

O usuário pediu uma skill que rode **a cada 3 dias** via cron na MV do Fly.io, aplique boas
práticas de tráfego pago e — regra central — **nunca analise uma métrica isolada**, sempre
relacionando-as entre si e ao objetivo da campanha.

O banco (ADR 0002) guarda a *estrutura* criada (campaigns/ad_sets/ads/creatives) mas **nenhuma
métrica de performance** (impressões, cliques, gasto, CPC, CTR, CPLPV, rankings). Sem persistir
snapshots, não há como analisar **tendência entre rodadas** — e tendência é parte de "não olhar
métrica isolada" no eixo do tempo.

Duas decisões de escopo foram tomadas com o usuário:
1. **Escopo de ação:** *read-only*. A skill analisa e salva sugestões estruturadas; **não** muta a
   conta Meta (não pausa, não ativa, não realoca budget). Preserva a invariante "tudo PAUSED, humano
   decide" da Onda 2.
2. **Persistência:** novas tabelas dedicadas (esta migration), em vez de só logar em manifest.

## Decision

Criamos **3 tabelas** em `public` via `apply_migration`, espelhando as convenções do ADR 0002
(IDs Meta em `text`, dinheiro em `integer` cents, `jsonb` para payload cru, RLS deny-by-default com
escrita via `service_role`):

- **`analyses`** — uma linha por rodada: janela, janela de comparação, contagem de entidades,
  `overall_verdict ∈ {healthy,watch,underperforming,learning,no_data,error}`, resumo, caminho do
  manifest, timestamps da execução.
- **`metric_snapshots`** — uma linha por entidade por rodada (níveis campaign/ad_set/ad), com
  métricas cruas (impressões, alcance, frequência, gasto, cliques de link, LPV, results) e
  **derivadas** (`ctr`, `cpc_cents`, `cpm_cents`, `cplpv_cents` — north-star de tráfego —,
  `cost_per_result_cents`) + os três rankings de leilão + `raw` jsonb. Unique
  `(analysis_id, level, meta_entity_id)` para idempotência e acúmulo histórico inter-rodadas.
- **`analysis_findings`** — uma linha por achado: `severity`, `metric_focus`, `diagnosis` (texto que
  **cruza ≥2 métricas**), `evidence` jsonb, `recommended_action`, `recommendation_type` (enum de
  ações), `confidence` e `is_significant` (passou nos gates de significância/fase de aprendizado).

A inteligência (framework de diagnóstico, identidades do funil, matriz relacional, gates de
significância, âncoras de benchmark/tendência) mora na skill `analytic-traffic-brunobracaioli-campaign`
(read-only), documentada na spec. O runner Fly.io a dispara com o mesmo contrato headless da skill de
criação; um item no `crontab` agenda **a cada 3 dias** às 08:00 BRT.

### Por que read-only nesta onda
Agir automaticamente (pausar/ativar/realocar) cruza a invariante de segurança vigente e concentra
risco financeiro em decisão de máquina. Separar *análise* (barata, reversível, auditável) de *ação*
(cara, com efeito real na conta) deixa o humano no loop e prepara o terreno para o decision-engine
da Onda 3+ consumir `analysis_findings`.

### Por que tabelas dedicadas em vez de só manifest/operation_logs
Tendência entre rodadas exige histórico **queryable** e tipado. `metric_snapshots` acumulado permite
comparar a mesma entidade ao longo do tempo (delta %), que é o eixo temporal do princípio "nunca
métrica isolada". Manifest continua existindo como artefato de run, não como fonte de verdade.

### Por que append-only sem `updated_at`
Cada rodada é um fato imutável no tempo; reprocessar gera nova `analysis`. Seguimos o padrão de
`operation_logs` (só `created_at`), sem trigger de `updated_at`.

## Consequences

### Positivas
- Performance auditável e comparável entre rodadas; recomendações estruturadas e priorizadas.
- Read-only elimina risco de ação automática indevida; custo Meta da skill = 0.
- Esquema pronto para o decision-engine (Onda 3+) ler `analysis_findings` sem nova migration.

### Negativas / dívidas
- Mais 3 avisos `rls_enabled_no_policy` (INFO) — mesma dívida aceita do ADR 0002, até o app
  multi-tenant definir policies.
- `metric_snapshots` cresce a cada rodada; sem retenção/rollup definidos ainda (aceitável no volume
  atual; rollup vira item futuro).
- A skill depende de o MCP da Meta expor `landing_page_views`/`actions` na conta; quando ausente,
  cai para CPC/CTR como proxies e registra a limitação no manifest.
- Notificação Telegram depende do connector estar seedado no runner; sem ele, degrada para log-only.
