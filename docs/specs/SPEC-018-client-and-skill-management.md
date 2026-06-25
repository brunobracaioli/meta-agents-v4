# SPEC-018 — Gestão de clientes + criação de skills pelo operador

| Campo | Valor |
|---|---|
| Status | Draft |
| Data | 2026-06-25 |
| Autor | brunobracaioli |
| ADRs | [0030](../adr/0030-user-defined-skills.md) |
| Threat model | [docs/security/threats/user-defined-skills.md](../security/threats/user-defined-skills.md) |
| Depende de | [SPEC-017](SPEC-017-multi-operator-multitenant.md) (multi-tenant, cutover Fase 7 concluído) |

## 1. Objetivo

A plataforma já é multi-operador (SPEC-017): cada operador loga via Supabase Auth, enxerga só
seus clientes (RLS por `auth.uid()`), tem 1 runner Fly escopado e jobs escopados. **Faltam duas
superfícies** que o multi-tenant pressupõe mas não construiu:

1. **Gestão de clientes pela UI** — hoje criar/editar cliente é manual via SQL. O operador
   precisa de CRUD de clientes no dashboard, escopado por operador.
2. **Criação de skills pelo operador** — hoje toda skill é um `SKILL.md` hardcoded baked na
   imagem do runner; um operador não-técnico não consegue criar automações. Este SPEC entrega um
   **fluxo guiado (wizard) IA-assistido**: o operador descreve, em linguagem natural, uma
   automação; o Claude redige a skill; o operador revisa/edita e publica. A skill pode (opcional)
   ser **agendada** por recorrência e (opcional) ser **invocável pelo Ultron via function_calling**.

**Restrição que define a arquitetura:** skills criadas pela UI **não podem** ser escritas no disco
da imagem do runner. Portanto vivem **no banco** (`client_skills`) e são **materializadas em
runtime** pelo runner num `SKILL.md` efêmero antes do `claude -p`, reusando 100% do caminho de
execução existente.

## 2. Modelo conceitual

```
operador ──1:N──> cliente ──1:N──> client_skills ──0:1──> skill_schedules (recorrência)
                     │                    │
                     │                    └──0:1──> ultron_function (exposição via function_calling)
                     └ campanhas / landing pages / análises / agent_jobs
```

- **Skill (do operador)** — automação declarativa (instruções markdown + `allowed-tools` +
  capacidade), armazenada em `client_skills`, pertencente a **um** cliente (logo a **um** operador).
- **Execução** — sempre via `agent_jobs` (kind=`custom`) → runner materializa o `SKILL.md` →
  `claude -p`. Gatilhos: manual ("rodar agora"), agenda (`skill_schedules`), ou Ultron (function call).

**Enquadramento de risco (base do threat model):** uma skill do operador **não é escalada de
privilégio** — o operador já pode fazer tudo nos *próprios* clientes (conta Anthropic, connectors
e dinheiro dele). É automação da própria autoridade. Os riscos reais são cross-tenant (já mitigado
por RLS + claim escopado + 3ª barreira do `run-skill.sh`), runaway/DoS (min-interval + one-active +
budget cap) e prompt-injection de dados externos (`allowed-tools` + PAUSED-por-padrão + budget cap).

## 3. Contratos

### 3.1 Banco (Supabase)

**Nova tabela `public.client_skills`:**

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `client_id` | uuid not null | references `clients(id)` on delete cascade |
| `operator_id` | uuid not null | references `operators(id)`; denormalizado p/ RLS + scoping (como `agent_jobs`) |
| `slug` | text not null | runner-safe `^[a-z0-9-]{2,40}$`; **unique (client_id, slug)** |
| `name` | text not null | exibição |
| `description` | text | |
| `body` | text not null | conteúdo do `SKILL.md` (redigido pela IA + editado); **sem segredos** |
| `allowed_tools` | text[] not null | famílias de tools do catálogo curado → frontmatter `allowed-tools` |
| `capability` | text not null | `read` \| `write` (default `read`); gate de guardrails |
| `ultron_enabled` | boolean not null | default `false` |
| `ultron_function` | jsonb | `{name, description, parameters}` (JSON-schema) quando exposto ao Ultron |
| `status` | text not null | `draft` \| `active` \| `disabled` (default `draft`) |
| `version` | int not null | default 1; concorrência otimista (como `landing_pages`) |
| `created_at`/`updated_at` | timestamptz | trigger `set_updated_at` |

**Nova tabela `public.skill_schedules`:**

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `skill_id` | uuid not null | references `client_skills(id)` on delete cascade |
| `client_id` | uuid not null | denormalizado |
| `operator_id` | uuid not null | denormalizado (claim escopado + RLS) |
| `recurrence` | jsonb not null | `{freq:'hourly'\|'daily'\|'weekly'\|'monthly', time:'HH:MM', weekday?, monthday?, every_n_hours?}` |
| `cron_expression` | text | derivado de `recurrence` (exibição/portabilidade) |
| `timezone` | text not null | default `America/Sao_Paulo` |
| `enabled` | boolean not null | default `true` |
| `next_run_at` | timestamptz not null | |
| `last_run_at` | timestamptz | |
| `last_job_id` | uuid | references `agent_jobs(id)` |
| `created_at`/`updated_at` | timestamptz | |

CHECK: intervalo mínimo ≥ 15 min (anti-runaway); validado também na API.

**`agent_jobs`** — estender CHECK de `kind` p/ incluir `'custom'`; adicionar `skill_id uuid`
nullable (references `client_skills(id)`); novo índice parcial unique p/ `kind='custom'` em
`(client_id, skill_id) WHERE status IN ('pending','claimed','running')` (substitui a colisão do
`agent_jobs_one_active_per_kind` quando há múltiplas skills custom no mesmo cliente).

**RLS** (role `authenticated`, via `auth.uid()`):
- `client_skills`: `using (operator_id = auth.uid())` (select/insert/update/delete).
- `skill_schedules`: idem.
- `service_role` continua bypassando (runner/sistema).

**RPCs** (`SECURITY DEFINER`, `search_path=''`, EXECUTE revogado de `public/anon/authenticated`):
- `compute_next_run(p_recurrence jsonb, p_tz text, p_from timestamptz) → timestamptz` — plpgsql puro.
- `claim_due_skill_schedule(p_worker_id text, p_operator_id uuid)` — `WHERE enabled AND
  next_run_at <= now() AND operator_id = p_operator_id ... FOR UPDATE SKIP LOCKED`.
- `advance_skill_schedule(p_id uuid, p_job_id uuid)` — `last_run_at=now()`,
  `next_run_at = compute_next_run(...)`, `last_job_id=p_job_id`.

### 3.2 API (web) — ver [openapi.yaml](../api/openapi.yaml)

Padrão obrigatório por rota: **auth (operador) → guarda de ownership (`assertOperatorOwnsClient`)
→ validação Zod → write via `db()` service-role**. Reads de UI via client Supabase autenticado.

- `/api/clients`: `GET` (lista do operador), `POST` (cria; `operator_id` carimbado de `auth.uid()`),
  `PATCH /:id`, `DELETE /:id`.
- `/api/skills`:
  - `POST /draft` — IA-assistida: `{clientId, goal}` → Anthropic (prompt-cache) redige
    `{name, description, body, allowed_tools, capability}` (não persiste). Rate-limited.
  - `GET`, `POST` (cria do draft revisado), `PATCH /:id` (version check), `DELETE /:id`.
  - `POST /:id/run` — "rodar agora" (enfileira `agent_jobs` kind=`custom`).
  - `POST|PATCH|DELETE /:id/schedule` — gerencia `skill_schedules`.

### 3.3 Runner

- `scripts/poll-agent-jobs.sh` exporta `AGENT_JOB_SKILL_ID`/slug além do client.
- `scripts/run-skill.sh`: se a skill não existe no disco **e** o job tem `skill_id`, busca
  `client_skills.body` + `allowed_tools` via Supabase REST (service-role), escreve
  `${WORKSPACE_ROOT}/.claude/skills/<slug>/SKILL.md` efêmero com frontmatter `allowed-tools`, e
  segue o fluxo normal (telemetria, timeout, ownership guard intactos).
- Novo `scripts/poll-skill-schedules.sh` (`* * * * *` no crontab, single-flight lock): claima agenda
  devida (`claim_due_skill_schedule`), **enfileira** um `agent_jobs` (kind=`custom`, `skill_id`),
  chama `advance_skill_schedule`. **Não executa** a skill — quem executa é o poller de jobs.

### 3.4 Ultron (function_calling)

- `web/lib/ultron/tools.ts`: após as tools estáticas, gerar tools dinâmicas de
  `client_skills WHERE ultron_enabled AND status='active'` escopadas ao operador (já há `operatorId`
  no `ToolContext`). Nome com prefixo seguro (`run_custom_<slug>`). Handler enfileira `agent_jobs`
  (kind=`custom`, `skill_id`, `args`=input) reusando enqueue + `RUNNER_NOT_READY` + ownership. Skills
  `capability='write'` mantêm a **confirmação 2-turnos** (`prompt.ts`).

## 4. Edge cases

- Operador sem runner pronto (`operatorRunnerReady` falso) → enqueue bloqueado (manual, agenda e
  Ultron) com `RUNNER_NOT_READY`.
- Skill `capability='write'` → roda PAUSED por padrão; respeita `daily_budget_cap_cents`; campanha
  ativa só com ativação explícita (skill `activate-*` ou Ultron com confirmação 2-turnos).
- Agenda com intervalo < 15 min → rejeitada (CHECK + Zod).
- Skill `disabled`/`draft` → não materializa via Ultron nem agenda (só `active`).
- Skill removida com agenda/jobs em voo → `on delete cascade` na agenda; jobs já enfileirados
  carregam `skill_id` que pode virar nulo? Não: job guarda `skill` (slug) + `args`; a materialização
  falha graciosamente (exit 2 "skill not found") se a row sumiu.
- `slug` colidindo com skill baked (ex. `create-traffic-brunobracaioli-campaign`) → unique é por
  cliente, mas a materialização só ocorre se o arquivo **não** existe no disco; logo skill custom
  nunca sobrescreve baked. Validação na API rejeita slugs reservados (lista de skills baked).
- Job custom para cliente de outro operador → rejeitado no enqueue, no claim e no `run-skill.sh`.

## 5. Critérios de aceite

1. Operador cria/edita/remove cliente pela UI; `operator_id` vem de `auth.uid()`; operador A não vê
   clientes de B (RLS + ownership).
2. Operador cria skill pelo wizard IA-assistido (objetivo → draft → revisa → publica).
3. "Rodar agora" enfileira job custom; runner materializa o `SKILL.md` efêmero e executa; telemetria
   `agent_events` aparece.
4. Agenda diária dispara: `poll-skill-schedules.sh` enfileira 1 job no horário e avança `next_run_at`.
5. Skill `ultron_enabled` aparece como tool dinâmica no chat do Ultron; skill de escrita pede
   confirmação 2-turnos; enqueue carimba `operator_id`/`client_id`/`skill_id`.
6. Skill `capability='write'` que cria campanha roda PAUSED e respeita budget cap.
7. RLS validado em dois contextos `auth.uid()`; nenhum segredo no `body` ou no banco.

## 6. Fora de escopo (futuro)

- Migrar as crons hardcoded do bruno (`/crontab`) p/ `skill_schedules` (coexistem no v1).
- Versionamento/rollback de skills além do `version` otimista.
- Marketplace/compartilhamento de skills entre operadores.
- Edição visual por blocos (no-code) — v1 é instrução em linguagem natural redigida pela IA.
- Genericização das 8 skills baked slug-específicas (tracked à parte no NOTES §16 D).
