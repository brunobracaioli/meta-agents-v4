# SPEC — Meta Ads funnel analytics (b2tech connector)

- Status: accepted · Date: 2026-06-14
- ADR: `docs/adr/0025-meta-ads-funnel-analytics-b2tech.md`
- Skill: `.claude/skills/funnel-analytics-brunobracaioli-campaign/SKILL.md`
- Migration: `supabase/migrations/20260614000001_add_funnel_events.sql`

## Objetivo

Extrair, de ponta a ponta e sem humano, o **funil de conversão completo** de todas as
campanhas ativas do cliente `brunobracaioli` no Meta Ads via o connector
`mcp-meta-ads-b2tech` (read-only), persistir um **read model normalizado**
(`funnel_events`) que alimenta o funil de eventos visual no dashboard, e manter o motor
de diagnóstico relacional (findings cruzando ≥2 métricas) da análise diária.

## Contratos

### Entrada
- `$ARGUMENTS` (`key=value`): `window` (default `last_7d`), `compare`
  (`previous_period`), `level` (default `ad`). Presets aceitos pelo MCP em §3 da skill.

### Fonte de dados (mcp-meta-ads-b2tech)
- `meta_token_status` → sanity do token (`source:"supabase"`).
- `list_ad_accounts` → confirmar `act_225179730538661`.
- `list_campaigns(account_id)` → enumerar campanhas; filtrar `effective_status=ACTIVE`.
- `get_insights(object_id, level, date_preset|time_range, fields, breakdowns)` por
  entidade ativa (payload pequeno). `run_insights_report` para janelas grandes.
- Campos confirmados (2026-06-14): `spend, impressions, reach, frequency, clicks, ctr,
  cpc, cpm, actions, action_values, purchase_roas, cost_per_action_type` (+ `campaign_id,
  campaign_name, objective` etc.). Valores vêm **limpos** (numéricos em string).

### Saída (Supabase)
- `analyses` (1 linha/run), `metric_snapshots` (1/entidade, `raw.funnel` incluído),
  `analysis_findings` (1/achado) — inalterados (ADR 0004).
- `funnel_events` (1 linha por entidade × etapa) — read model do funil visual.
- Manifest JSON em `tentativas-geracao-de-campanhas/` + Telegram (opcional).

## Funil canônico (step_order)
`impression(1) → link_click(2) → landing_page_view(3) → view_content(4) →
add_to_cart(5) → initiate_checkout(6) → purchase(7)`.

## Critérios de aceite
1. ≥1 linha em `analyses` por run (mesmo `no_data`/`error`).
2. Para cada entidade com entrega: 7 linhas em `funnel_events` (count≥0), com
   `cvr_from_prev`/`cvr_from_top` e `cost_per_event_cents` coerentes; `purchase` com
   `value_cents` (receita) quando houver `action_values`.
3. ROAS e receita refletidos no `metric_snapshots.raw` e nos findings.
4. Cada finding cruza ≥2 métricas e cita a etapa do funil onde o dinheiro vaza.
5. **Zero** chamadas de escrita na conta Meta (read-only verificável pelo allowed-tools).
6. Manifest gravado; headless nunca chama `AskUserQuestion`.

## Edge cases
- Tudo PAUSED / sem gasto → `overall_verdict='no_data'`, `funnel_events` opcional
  (zerado ou ausente), sai com sucesso.
- `get_insights` account+level=campaign estoura tokens → iterar campanhas ativas.
- Token b2tech inválido → `overall_verdict='error'`, manifest `verified:false`, sair.
- `action_values`/`purchase_roas` ausentes (objetivo não-vendas) → `value_cents=null`,
  ROAS null; funil para no evento mais fundo disponível.
