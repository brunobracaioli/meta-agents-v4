---
name: daily-summary-brunobracaioli
description: Gera de forma 100% autônoma e headless um resumo diário (por IA) do que os agents fizeram para o cliente brunobracaioli — lê operation_logs + analyses + estado das campanhas do dia no Supabase e faz upsert em daily_summaries. Usado pelo Ultron (dashboard) para responder "o que foi feito hoje?" em uma query. Use quando pedirem "gerar resumo diário do brunobracaioli", ou quando disparada via cron à noite (`claude -p --dangerously-skip-permissions ".claude/skills/daily-summary-brunobracaioli"`).
---

# Skill: /daily-summary-brunobracaioli

Gera o resumo diário do dia corrente (timezone America/Sao_Paulo) para o cliente
`brunobracaioli` e persiste em `public.daily_summaries`. É **read-only sobre a conta
Meta** — não lê a Meta; apenas consolida o que já está no Supabase. Alimenta o
assistente Ultron do dashboard (tool `get_daily_summary`).

> Spec: docs/specs/web-dashboard-ultron.md · ADR: docs/adr/0007-daily-summaries-and-agent-events.md

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

- Headless: **NUNCA** faça perguntas ao operador. Decida e execute.
- Idempotente: rode duas vezes no mesmo dia → 1 linha em `daily_summaries`
  (upsert por `(client_id, summary_date)`), sem duplicar.
- Fail-safe: se não houver atividade no dia, gere um resumo curto dizendo isso
  (não falhe). Só falhe se o cliente não existir no banco.
- Toda persistência via **MCP do Supabase** (`mcp__supabase__execute_sql`).

## 2. Constantes do cliente

- `slug = brunobracaioli`
- `summary_date` = data de hoje em America/Sao_Paulo (BRT). Ex.: `2026-05-30`.
- Janela do dia: de `summary_date 00:00:00 BRT` até `summary_date 23:59:59 BRT`
  (em UTC, subtraia 3h ao filtrar `created_at`/`captured_at`).

## 3. Passo a passo

### Passo 0 — Setup
Determine `summary_date` (hoje, BRT) e a janela UTC correspondente.

### Passo 1 — Resolver o cliente (pré-condição)
```sql
select id from public.clients where slug = 'brunobracaioli';
```
Se **não** retornar linha → **aborte** com erro claro (o seed do cliente é
pré-requisito; ver migration de seed). Guarde `client_id`.

### Passo 2 — Coletar o que aconteceu no dia (read-only no Supabase)
Rode SELECTs filtrando pela janela do dia e `client_id`:

- **Ações dos agents:**
  ```sql
  select entity_type, action, summary, actor, created_at
  from public.operation_logs
  where client_id = :client_id and created_at >= :day_start_utc and created_at < :day_end_utc
  order by created_at;
  ```
- **Análises persistidas hoje:**
  ```sql
  select id, overall_verdict, summary, created_at
  from public.analyses
  where client_id = :client_id and created_at >= :day_start_utc and created_at < :day_end_utc
  order by created_at desc;
  ```
  Para a análise mais recente do dia (se houver), pegue os `analysis_findings`
  (severity, diagnosis, recommended_action) e os `metric_snapshots` de nível
  `campaign` (cplpv_cents, ctr, cpc_cents, cpm_cents, frequency, spend_cents).
- **Estado atual das campanhas:**
  ```sql
  select name, status, budget_mode, daily_budget_cents
  from public.campaigns where client_id = :client_id order by created_at desc;
  ```

### Passo 3 — Compor o resumo (você, a IA)
Escreva um **resumo executivo em pt-BR**, 2 a 5 frases, factual, sem inventar:
- O que os agents criaram/alteraram hoje (campanhas/ads/criativos), se algo.
- Veredito da análise do dia (se houve) e o achado mais relevante (cruzando ≥2
  métricas — nunca métrica isolada; CPLPV é north-star).
- Estado atual (quantas campanhas ativas/pausadas).
- Se o dia não teve atividade, diga isso em uma frase.

Monte também um objeto `structured` (jsonb) com os números-chave, ex.:
```json
{
  "actions_count": 0,
  "campaigns": {"active": 0, "paused": 1},
  "latest_verdict": "no_data",
  "north_star": {"cplpv_cents": null, "ctr": null, "spend_cents": 0},
  "top_findings": []
}
```
Valores monetários em centavos (inteiros). Sem PII.

### Passo 4 — Persistir (upsert idempotente)
```sql
insert into public.daily_summaries (client_id, summary_date, summary, structured, model, generated_at)
values (:client_id, :summary_date, :summary, :structured::jsonb, 'claude (skill daily-summary)', now())
on conflict (client_id, summary_date)
do update set summary = excluded.summary,
              structured = excluded.structured,
              model = excluded.model,
              generated_at = now();
```
Use parâmetros corretamente escapados (sem concatenar string crua de conteúdo).

### Passo 5 — Manifest da run
Escreva `tentativas-geracao-de-campanhas/${STAMP}-resumo-diario.json` com:
`{ "skill":"daily-summary-brunobracaioli","client":"brunobracaioli","date":"<summary_date>","verified":true,"actions_count":N,"latest_verdict":"...","persisted":true }`.
`STAMP` = `YYYYMMDD-HHMM` (BRT).

### Passo 6 — Resumo final (stdout)
Imprima 2–3 linhas: data, nº de ações, veredito, e que o upsert foi feito.

## 4. Critério de sucesso
- 1 linha em `public.daily_summaries` para `(brunobracaioli, hoje)`, com `summary`
  não vazio e `structured` válido.
- Manifest escrito com `verified:true`.
- Rodar de novo no mesmo dia não cria linha nova (só atualiza).

## 5. Anti-padrões (NÃO faça)
- ❌ Perguntar qualquer coisa ao operador.
- ❌ Inventar métricas/ações que não estão no banco.
- ❌ Concluir performance a partir de uma métrica isolada.
- ❌ Ler ou alterar a conta Meta (esta skill não toca a Meta).
- ❌ Duplicar a linha do dia (sempre upsert por `(client_id, summary_date)`).

## 6. Pré-requisitos
- Schema base + seed do cliente `brunobracaioli` aplicados (migrations versionadas).
- Tabela `public.daily_summaries` (migration `20260530000005_add_daily_summaries`).
- MCP do Supabase conectado (project `zvcnzikpnryoduuvzyio`).
