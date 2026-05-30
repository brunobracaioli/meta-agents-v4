# ADR 0009 — Fila `agent_jobs` no Supabase para o Ultron disparar skills na Fly.io

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-30 |
| Decidido por | brunobracaioli |
| Migrations | `add_agent_jobs` (`20260530000007`) |
| Spec | [docs/specs/ultron-agent-trigger.md](../specs/ultron-agent-trigger.md) |
| Relacionado | [ADR 0001](0001-fly-machine-supercronic.md) (runner sem HTTP), [ADR 0007](0007-daily-summaries-and-agent-events.md) (padrão de polling), [Threat model](../security/threats/web-dashboard.md) |

## Context

O Ultron (assistente de voz no dashboard, na Vercel) era **somente leitura**. O operador
pediu para poder **acionar os agents por voz**: "cria campanha pro cliente X" e "ativa a
campanha". Os skills que fazem isso (`create-traffic-…`, e o novo `activate-campaign-…`)
rodam no **runner Fly.io** (`meta-agents-v4`), que é o único host com o **MCP da Meta** e o
**OAuth do Claude** (volume `claude_state`).

Restrições que moldam a decisão:
- A Vercel é serverless com timeout ~60s; um skill leva **5–25 min**. Não dá para rodar o
  skill no request.
- O runner Fly.io é um **worker puro sem porta HTTP** (`fly.toml` não tem `[http_service]`),
  e a **ADR 0001 rejeitou explicitamente** "Vercel → webhook HTTP na Fly" por adicionar
  superfície de ataque (porta, TLS, auth de webhook) sem ganho.
- A **ativação gera gasto real** — o gatilho precisa ser auditável e difícil de disparar por
  engano (erro de STT).

## Decision

**Desacoplar via uma fila durável no Supabase (`public.agent_jobs`) que o runner Fly.io
faz polling.** O Ultron (web) **insere** um job; o runner **claima** atomicamente e executa
o skill; o status volta para a linha do job.

Componentes:
- **Tabela `agent_jobs`** (`id, client_id, skill, kind, args jsonb, status, requested_by,
  confirmed_at, claimed_*, started/finished_at, exit_code, result, error`). RLS on,
  deny-by-default; ambos os lados escrevem via `service_role`. Índice único parcial
  `agent_jobs_one_active_per_kind (client_id, kind) where status in ('pending','claimed',
  'running')` para **deduplicar** disparos repetidos.
- **Função `claim_agent_job(worker_id)`** — `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP
  LOCKED LIMIT 1) RETURNING *`. `SECURITY DEFINER`, `search_path=''`, `EXECUTE` revogado de
  `public/anon/authenticated` (padrão da ADR 0008).
- **Web (tools tipadas, não "rode qualquer skill")** — `request_campaign_creation` e
  `request_campaign_activation`. O **nome do skill é resolvido server-side por um mapa fixo
  por slug**; o usuário nunca fornece string de skill. **Confirmação em 2 turnos** (`confirm`
  + instruções no system prompt). Ativação revalida cliente+PAUSED+budget≤teto. Tool de
  leitura `get_recent_jobs` fecha o loop ("começou? terminou?").
- **Runner (`scripts/poll-agent-jobs.sh`, cron `* * * * *`)** — lock single-flight via
  `mkdir`; claima via RPC; **revalida** o skill (charset + existência) e o charset dos `args`;
  roda `run-skill.sh <skill> <args>` (estendido para aceitar args); grava status terminal.

### Alternativas consideradas
- **Fly Machines API `exec` / `machine run` a partir da Vercel** — colocaria um **Fly API
  token** (poderoso) na Vercel, exigiria orquestrar exec de processo longo e lidar com
  timeouts. Rejeitado: novo segredo cross-service + acoplamento, contra menor privilégio.
- **Webhook HTTP na Fly** — rejeitado pela ADR 0001 (superfície de ataque) e exigiria expor
  porta + auth própria.
- **QStash (fila gerenciada)** — não está configurado no projeto; a fila no Postgres reusa
  infra que já existe (Supabase + service key em ambos os lados) e dá auditoria de graça.

## Consequences

### Positivas
- **Zero segredo novo**: Vercel e Fly já têm `SUPABASE_URL`/`SUPABASE_SECRET_KEY`. Nada de
  Fly API token. Menor privilégio mantido.
- **Durável e auditável**: cada disparo é uma linha; trilha completa (quem/quando/status/erro)
  + `operation_logs` na ativação. Reusa o padrão PostgREST do `emit-agent-event.py`.
- **Sem nova superfície de rede** no runner; alinhado com ADR 0001.
- **Genérico**: a coluna `kind`/`skill` já serve análise/resumo on-demand no futuro, sem 2ª
  migração.

### Negativas / dívidas
- **Latência de até ~60s** entre o pedido e o início (cron de 1 min). Aceitável para criação
  de campanha; o Ultron sinaliza "começa em instantes" e há `get_recent_jobs`.
- **Job órfão**: se o poller morrer entre `claimed` e o fim, a trap EXIT marca `failed`; ainda
  assim fica a dívida de um **reaper** para casos extremos (ex.: máquina morta no meio).
- **Um job por vez** (single-flight). Suficiente hoje (1 cliente, baixa frequência); se a
  vazão crescer, evoluir para N workers (o `FOR UPDATE SKIP LOCKED` já suporta).
- RLS on sem policy (INFO `rls_enabled_no_policy`) — dívida aceita do ADR 0002, inalterada.
