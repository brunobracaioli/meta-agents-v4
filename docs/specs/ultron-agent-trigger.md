# Spec — Ultron dispara agents na Fly.io (criar + ativar campanha via fila)

| Campo | Valor |
|---|---|
| Status | Implementado |
| Data | 2026-05-30 |
| ADR | [0009](../adr/0009-on-demand-agent-jobs-queue.md) |
| Threat model | [web-dashboard](../security/threats/web-dashboard.md) |
| Migration | `supabase/migrations/20260530000007_add_agent_jobs.sql` |

## Objetivo

Permitir que o operador, **por voz no Ultron**, acione os agents na VM Fly.io para:
1. **Criar** uma campanha de tráfego (nasce PAUSED, gasto zero).
2. **Ativar** uma campanha existente (vai ao ar — **gasto real**).

O Ultron não toca a Meta direto (o MCP da Meta vive só no runner). Ele **enfileira** um job
em `public.agent_jobs`; o runner faz polling, executa o skill e grava o resultado.

## Contratos

### Tabela `agent_jobs` (fila durável)
`id, client_id→clients, skill, kind ∈ {create,activate,analyze,summarize}, args jsonb,
status ∈ {pending,claimed,running,completed,failed,cancelled}, requested_by, confirmed_at,
claimed_by/at, started_at, finished_at, exit_code, result jsonb, error, created_at`.
- RLS on, deny-by-default; escrita só por `service_role` (Vercel + poller).
- Índice único parcial `(client_id, kind) where status in ('pending','claimed','running')` —
  no máx. 1 job ativo por cliente+tipo (anti duplo-disparo).
- `claim_agent_job(worker_id)`: claima o `pending` mais antigo (`FOR UPDATE SKIP LOCKED`),
  `SECURITY DEFINER`, `EXECUTE` só `service_role`.

### Tools do Ultron (`web/lib/ultron/tools.ts`)
O `skill` é resolvido **server-side** por mapa fixo por slug (`CREATE_SKILL_BY_SLUG`,
`ACTIVATE_SKILL_BY_SLUG`) — nunca texto livre.

- `request_campaign_creation({ client_slug, confirm })`
  - `confirm=false` → `{ confirmation_required, client, daily_budget_cents, currency, note }`,
    **sem escrever**.
  - `confirm=true` → INSERT `kind='create'`, `args={ "budget-cents": <cap> }`. Unique violation
    (23505) → `{ enqueued:false, reason:"…andamento" }`. Sucesso → `{ enqueued:true, job_id }`.
- `request_campaign_activation({ client_slug, campaign_meta_id, confirm })`
  - Valida: campanha é do cliente, `status='PAUSED'` (ACTIVE → já ativa; outro → erro),
    `daily_budget_cents ≤ daily_budget_cap_cents`.
  - `confirm=false` → `{ confirmation_required, campaign, daily_budget_cents, warning }`.
  - `confirm=true` → INSERT `kind='activate'`, `args={ campaign_meta_id }`.
- `get_recent_jobs({ client_slug?, limit? })` → estado dos jobs recentes (status/erro/horários).
- Rate limit por slug: `campaign-creation` 5/h, `campaign-activation` 3/h (defense in depth).

### System prompt (`web/lib/ultron/prompt.ts`)
Fluxo obrigatório em 2 turnos: sempre `confirm=false` primeiro → ler detalhes ao operador →
só `confirm=true` após "sim/ativa" explícito. Na ativação, reler nome+orçamento e avisar
"gasto real". Recusa → não chamar com `confirm=true`.

### Runner (`scripts/poll-agent-jobs.sh`, cron `* * * * *`)
Lock single-flight (`mkdir /tmp/agent-jobs-poll.lock`) → `claim_agent_job` → **revalida**
skill (`^[a-z0-9-]+$` + existe em `.claude/skills/`) e charset dos `args` → `run-skill.sh
<skill> <args...>` → PATCH status `running`→`completed`/`failed` (com `exit_code`/`error`).
Trap EXIT marca `failed` se sair sem finalizar (anti job preso). `run-skill.sh` estendido
para aceitar `key=value` extra e anexá-los ao prompt do `claude -p`.

### Skill de ativação (`.claude/skills/activate-campaign-brunobracaioli/SKILL.md`)
Headless, autônomo. Recebe `campaign_meta_id`. **Revalida** (cliente, PAUSED, budget≤teto) no
Supabase **e** na Meta; ativa campanha → ad sets → ads via `ads_activate_entity`; persiste
`status='ACTIVE'` + `operation_logs(action='activate', actor='ultron-trigger')`; manifest.
Aborta sem ativar em qualquer ambiguidade.

## Edge cases
- **Duplo-disparo / STT repetido** → índice único derruba o 2º INSERT → "já existe um pedido
  em andamento".
- **Cliente inexistente / fora do allowlist** → erro amigável, nada enfileirado.
- **Campanha não-PAUSED, de outro cliente, ou budget > teto** → ativação recusada.
- **Skill desconhecido/args inseguros** → poller marca o job `failed`, não executa.
- **Erro da Meta (ex.: verificação BR, subcode 3858634)** → skill grava `error`/`verified:false`
  no job/manifest; runner não quebra; Ultron reporta via `get_recent_jobs`.
- **Poller morre no meio** → trap marca `failed`; risco residual coberto por dívida (reaper).

## Critérios de aceite
1. `confirm=false` nunca escreve em `agent_jobs` (criar e ativar). ✅ (testes unitários)
2. `confirm=true` cria 1 linha com `kind` e `skill` corretos; 2º disparo imediato é barrado. ✅
3. Ativação recusa ACTIVE, status≠PAUSED, e budget>teto sem enfileirar. ✅
4. Poller claima, roda o skill e grava status terminal; `fly logs` mostra o ciclo.
5. Ativação real: campanha+ad sets+ads ACTIVE na Meta, `status='ACTIVE'` + `operation_logs`
   no Supabase.
6. `get_recent_jobs` responde o estado atual ao operador.

## Testes
- Unit (`web/lib/ultron/tools.test.ts`, vitest): gates de confirmação, allowlist, PAUSED,
  teto de budget, unique violation. 9 casos.
- Manual: ver "Verificação end-to-end" no plano / critérios 4–6 acima (precisa do deploy Fly).
