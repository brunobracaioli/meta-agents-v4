# 0024 — Análise diária de todas as campanhas ativas (multi-objetivo)

- Status: accepted (2026-06-10)
- Relacionados: [0001](0001-fly-machine-supercronic.md) (cron host),
  [0004](0004-meta-ads-performance-analysis-schema.md) (schema de análise),
  spec [meta-ads-performance-analysis.md](../specs/meta-ads-performance-analysis.md)

## Context

A skill `analytic-traffic-brunobracaioli-campaign` rodava a cada 3 dias e era ancorada em
`OUTCOME_TRAFFIC`. Em 2026-06-10 uma rodada manual (analysis_id `6c05c907`) provou o framework
multi-objetivo na prática: a conta `225179730538661` tinha 6 campanhas ativas com gasto em 3
objetivos distintos (`OUTCOME_SALES`, `OUTCOME_ENGAGEMENT`, `LINK_CLICKS`), incluindo campanhas
criadas manualmente pelo operador — e o diagnóstico relacional (north-star por objetivo, CPM alto
+ CTR ok ⇒ leilão, comparação entre irmãs) funcionou sem nenhuma mudança de schema:
`analyses.objective` é text livre e os enums de veredito/recomendação são agnósticos a objetivo.

O operador pediu: análise **diária** de **todas as campanhas ativas** da conta, e perguntou se
seriam necessárias tabelas novas no Supabase e/ou cron no Vercel.

## Decision

1. **Evoluir a skill existente** (mantendo o nome `analytic-traffic-brunobracaioli-campaign`) para
   escopo multi-objetivo, em vez de criar uma skill nova — preserva crontab, telemetria
   (`agent_events`), histórico de `analyses` e referências em docs.
2. **North-star por objetivo**: CPLPV para tráfego, CPA para vendas, custo/engajamento (CPM +
   frequência) para engajamento; matriz relacional e gates de significância permanecem universais.
   `analyses.objective` passa a gravar a lista distinta de objetivos com gasto na janela.
3. **Cadência diária às 08:00 BRT** no runner Fly.io existente (supercronic, ADR 0001) — mudança de
   1 linha no `crontab` baked na imagem. **Sem Vercel Cron**: o `claude` CLI + OAuth + MCPs
   (Meta/Supabase) vivem no volume do Fly; o ADR 0001 já rejeitou webhook/Vercel para agendamento
   de skills headless.
4. **Sem mudanças de schema**: as 3 tabelas do ADR 0004 já comportam multi-objetivo. A janela
   continua `last_7d` rolante vs período anterior; a granularidade diária vem do acúmulo de
   `metric_snapshots` (append-only), que vira a âncora de tendência.
5. **Notificação Telegram diária** habilitada via `TELEGRAM_CHAT_ID` em `fly secrets` (fallback
   log-only permanece — headless nunca trava por Telegram).
6. A skill codifica as **limitações reais do Meta MCP** descobertas na rodada manual (campos
   suportados, LPV só no nível campaign via `results.all_conversion_types`, valores BRL
   localizados, outputs grandes processados via arquivo, benchmarks "no data") para que rodadas
   headless não desperdicem turns redescobrindo-as.

## Consequences

- ~30 rodadas/mês em `analyses` (antes ~10): mais linhas porém pequenas; o histórico diário de
  `metric_snapshots` habilita tendência por entidade sem nova tabela ou view (a view materializada
  segue como pendência do ADR 0004).
- Custo diário de tokens do runner (uma rodada ≈ 10 min de sessão headless) — aceito; é o produto.
- Campanhas manuais do operador entram no radar (teto de budget R$50/d checado todo dia, finding
  `medium` se excedido) — o contrato read-only permanece: a skill nunca muda nada na conta Meta.
- A skill manteve o nome com "traffic" por compatibilidade apesar do escopo ampliado; renomear
  exigiria tocar crontab/docs/telemetria e foi adiado até a generalização multi-cliente (Wave 2).
- Consumidores (Ultron `get_latest_analysis`, daily-summary) seguem compatíveis: nenhum enum ou
  coluna mudou; `objective` multi-valor é text como antes.
