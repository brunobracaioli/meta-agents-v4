# ADR 0007 — Tabelas `daily_summaries` e `agent_events` (resumos diários + live view)

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-30 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/web-dashboard-ultron.md](../specs/web-dashboard-ultron.md) |
| Migrations | `20260530000005_add_daily_summaries`, `20260530000006_add_agent_events` (aplicadas em 2026-05-30) |

## Context

Duas necessidades do dashboard exigem schema novo:

1. **Resumos diários** — o Ultron deve responder "o que foi feito hoje / para o cliente X"
   de forma rápida e barata. Em vez de varrer `operation_logs`/`analyses` a cada pergunta,
   um job gera 1 resumo/dia/cliente por IA e o Ultron lê pronto.
2. **Live view** — espelhar em tempo real o que os agents fazem (scrape, copy, imagem).
   Hoje só há `operation_logs` (pós-conclusão, por entidade); falta um stream de eventos
   granulares durante a execução.

> Pré-requisito: o schema base (ADR 0002/0004) está sendo **recriado e versionado** em
> `supabase/migrations/` (o banco remoto foi resetado e as migrations originais nunca
> tinham sido commitadas — falha de IaC corrigida nessa recriação). Estas duas tabelas
> entram como migrations versionadas na mesma pasta, **depois** do base + seed do cliente.

## Decision

### `daily_summaries`
`id uuid pk` · `client_id uuid fk→clients` · `summary_date date` · `summary text` ·
`structured jsonb` · `model text` · `generated_at timestamptz` · unique `(client_id, summary_date)`.
Upsert idempotente por `(client_id, summary_date)`. RLS enabled deny-by-default (acesso via
service key, igual ao resto). Gerado por uma **skill headless nova**
(`daily-summary-brunobracaioli`) em **cron da Fly.io** (~23:30 BRT) — consistente com o
runner atual; QStash não está configurado.

### `agent_events`
`id uuid pk` · `run_id text` · `client_id uuid null` · `ts timestamptz` ·
`agent_name text` · `agent_type text` (`skill|subagent|tool`) · `event_type text`
(`start|step|decision|error|end`) · `tool_name text null` · `summary text` ·
`payload jsonb`. Índice por `(ts)` e `(run_id)`. Append-only.

**Captura:** hook Claude Code (`.claude/hooks/emit-agent-event.py`) nos eventos
`PreToolUse`/`PostToolUse`/`SubagentStop`, inserindo linhas via Supabase REST com
`SUPABASE_SECRET_KEY` do ambiente Fly. Fail-safe: qualquer erro sai 0 e nunca quebra a
tool call dos agents (mesmo padrão do hook `remind-update-project-memory.py`).

**Leitura em tempo real (decidido):** mantemos o RLS **fechado** (sem policy anon, sem
publicação Realtime). A live view lê via **endpoint server-side** (`GET /api/dashboard/events?since=`)
que consulta com a service key; o browser faz **polling** a cada ~2s (eventos de agent são
de baixa frequência, então polling é suficiente, robusto em serverless e não relaxa o
deny-by-default). Migrar para SSE/Realtime fica como otimização futura se a latência pesar.

## Consequences

**Prós:** Ultron responde resumo do dia em 1 query; live view sem websocket próprio
(Realtime ou SSE). DDL versionado desde o início (IaC). **Contras:** o hook adiciona uma
chamada de rede por tool call no runner (mitigado por fire-and-forget + fail-safe); mapear
`tool_name → summary` legível exige manutenção. **Privacidade:** `payload` não deve conter
PII nem segredos — só metadados de ação.
