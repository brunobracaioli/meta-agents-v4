# SPEC-017 — Multi-operador / Multi-tenant

| Campo | Valor |
|---|---|
| Status | Draft |
| Data | 2026-06-18 |
| Autor | brunobracaioli |
| ADRs | [0026](../adr/0026-multi-operator-tenancy.md), [0027](../adr/0027-runner-per-operator.md), [0028](../adr/0028-per-client-claude-workspace.md) |
| Threat model | [docs/security/threats/multi-operator.md](../security/threats/multi-operator.md) |
| Supersede | [ADR 0006](../adr/0006-dashboard-password-auth.md) (senha única) |

## 1. Objetivo

Transformar a plataforma de **single-tenant na prática** (1 operador, 1 cliente
`brunobracaioli`, senha única, 1 runner Fly) em **multi-operador / multi-tenant**:
vários operadores se cadastram, logam com identidade própria e enxergam **apenas seus
clientes**. Cada operador gerencia N clientes.

Restrição que define a arquitetura: **cada operador usa a própria conta Anthropic** e
conecta os MCP de **Meta Ads** e **Google Ads** como *connector personalizado* dentro da
**própria conta claude.ai** (`https://claude.ai/customize/connectors`). Portanto **não há
token Meta/Google para a plataforma armazenar** — eles vivem na conta claude.ai do operador
(materializados no `~/.claude/.credentials.json` do runner dele). O que isolamos é a
**credencial Claude + connectors por operador no runner** e os **dados por operador no banco**.

## 2. Modelo conceitual

- **Operador** — usuário humano da plataforma. Camada de auth/dados (web + Supabase).
- **Cliente** — infoprodutor/conta de anúncios gerida. Pertence a **um** operador (1:N).
- **Credencial Claude + connectors** — nível `$HOME` do runner, **por operador**.
- **Skills/hooks/agents/settings/materiais** — nível projeto `.claude`, **por cliente**
  (workspace completo, materializado de um template — ver ADR 0028).

```
operador ──1:N──> cliente ──1:N──> campanhas/landing pages/análises/jobs
   │                  │
   └ conta Anthropic  └ .claude workspace completo (no runner do operador)
     + connectors
     (no runner)
```

## 3. Contratos

### 3.1 Banco (Supabase)

**Nova tabela `public.operators`** (1:1 com `auth.users`, `id = auth.uid()`):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | references `auth.users(id)` on delete cascade |
| `display_name` | text | |
| `status` | text | `active` \| `suspended` (default `active`) |
| `fly_app_name` | text | runner provisionado (nullable) |
| `runner_status` | text | `none` \| `provisioned` \| `ready` \| `error` |
| `connectors_status` | jsonb | ex.: `{"claude_login":true,"meta":true,"google":false}` |
| `created_at`/`updated_at` | timestamptz | |

**`clients`** — adicionar `operator_id uuid references public.operators(id)`:
nullable → backfill `brunobracaioli` → `set not null`. Índice `clients_operator_id_idx`.

**`agent_jobs`** — adicionar `operator_id uuid not null references public.operators(id)`
(denormalizado para o claim escopado). Índice `agent_jobs_operator_status_idx (operator_id, status)`.

**RLS** (role `authenticated`, via `auth.uid()`):
- `operators`: `using (id = auth.uid())`.
- `clients`: `using (operator_id = auth.uid())`.
- tabelas com `client_id` direto: `using (client_id in (select id from public.clients where operator_id = auth.uid()))`.
- tabelas sem `client_id` direto (`ad_sets`, `ads`): escopar via FK pai.
- `service_role` continua bypassando (runner/sistema).

**RPC `claim_agent_job(p_worker_id text, p_operator_id uuid)`** — claim escopado:
`WHERE status='pending' AND operator_id = p_operator_id ... FOR UPDATE SKIP LOCKED`.
`SECURITY DEFINER`, `search_path=''`, EXECUTE revogado de `public/anon/authenticated`.

### 3.2 Auth da plataforma (web)

- Signup/login via **Supabase Auth** (senha ou magic-link); sessão cookie-based `@supabase/ssr`.
- Endpoints: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`.
- Substitui `web/lib/auth/session.ts` + `password.ts` (jose/`DASHBOARD_PASSWORD`) e a checagem
  do `middleware.ts`. **Mantém** rate-limit por IP no login e Turnstile opcional.
- Reads de UI usam **client Supabase autenticado** (JWT do operador) → RLS isola.
  `service_role` fica **só** para operações de sistema, nunca para reads de UI.
- Guarda de ownership nas rotas `[slug]`: 404 se o cliente não pertence ao operador.

### 3.3 Runner (1 por operador — ADR 0027)

- Cada operador → 1 Fly app, com env `OPERATOR_ID=<uuid>` e secrets próprios
  (`SUPABASE_*`, `OPENAI_API_KEY`). **Token Meta/Google não entram** (vêm dos connectors).
- `scripts/poll-agent-jobs.sh`: `claim_agent_job(worker_id, $OPERATOR_ID)` — claima só jobs do operador.
- `scripts/run-skill.sh`: resolve `client_slug` do job → `cd /app/clients/<slug>` →
  `claude -p ".claude/skills/<skill> <args>"`. **Valida** `client.operator_id == $OPERATOR_ID`
  antes de executar; aborta (exit≠0) se divergir.
- Skill valida que o `ad_account_id` alvo é visível em `ads_get_ad_accounts` (connector do
  operador) **antes** de criar/ativar — falha cedo, sem gasto indevido.

### 3.4 Workspace por cliente (ADR 0028)

- Template em `templates/client-claude/`. `scripts/scaffold-client-workspace.sh <slug>`
  materializa `clients/<slug>/.claude/...` + materiais. Idempotente (re-propaga updates).
- Constantes do cliente (ad_account, BM, page, budget) resolvidas em runtime via
  `SELECT ... FROM clients WHERE slug=<slug>` — fonte única no DB.

## 4. Edge cases

- Operador sem `claude login`/connectors prontos → `run-skill.sh` falha (exit 3);
  `connectors_status` reflete no dashboard; **enqueue bloqueado** até `runner_status='ready'`.
- Job para cliente de outro operador → rejeitado no enqueue **e** no claim **e** no
  `run-skill.sh` (3 barreiras).
- `ad_account_id` não visível no connector do operador → skill falha antes de gastar.
- Operador `suspended` → enqueue bloqueado; runner pausado (`fly machine stop`).
- Backfill: `brunobracaioli` recebe `operator_id` antes do `not null`.
- `service_role` jamais no browser; reads de UI nunca usam `service_role`.

## 5. Critérios de aceite

1. Operador A não lê (via dashboard nem via API) nenhum dado de operador B — validado por
   RLS (dois contextos `auth.uid()`) **e** pela guarda de ownership.
2. Runner do operador A nunca claima job de B (`claim_agent_job` escopado por `OPERATOR_ID`).
3. Signup → login → logout funcionam via Supabase Auth; rate-limit e Turnstile mantidos.
4. Onboarding de cliente materializa workspace e cria row `clients` com `operator_id`.
5. Criação de campanha por um 2º operador de teste roda PAUSED no runner dele, isolada de bruno.
6. Nenhum token Meta/Google é persistido pela plataforma (grep no diff + no banco).
7. `brunobracaioli` migrado como operador #1 sem perda de dados.

## 6. Fora de escopo (futuro)

- Compartilhamento N:N de um cliente entre membros de equipe (`operator_clients`).
- Billing/quota por operador.
- Automação total do `claude login` + connectors (passo inerentemente manual).
