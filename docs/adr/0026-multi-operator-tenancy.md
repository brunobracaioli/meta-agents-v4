# ADR 0026 — Multi-operador / multi-tenant com Supabase Auth + RLS por operador

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-18 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/SPEC-017-multi-operator-multitenant.md](../specs/SPEC-017-multi-operator-multitenant.md) |
| Supersede | [ADR 0006](0006-dashboard-password-auth.md) (senha única + JWT jose) |
| Relacionado | [ADR 0027](0027-runner-per-operator.md), [ADR 0028](0028-per-client-claude-workspace.md) |

## Context

O dashboard era de **operador único** (ADR 0006): senha única `DASHBOARD_PASSWORD` → cookie
JWT jose `{role:"operator"}` sem identidade; reads via `service_role` (RLS on, **sem
policies**); todas as queries leem **todos** os clientes. Vamos abrir para **vários
operadores**, cada um vendo só os seus clientes. O ADR 0006 já previa esta evolução
("migrar para Supabase Auth + RLS por usuário quando houver mais operadores").

Os tokens Meta/Google **não são da plataforma** — vivem no connector claude.ai de cada
operador (ADR 0027). Logo, "segredos por cliente" não é um problema de storage nosso; o
isolamento de dados é o foco aqui.

## Decision

**Adotar Supabase Auth como identidade do operador e RLS por `auth.uid()` como barreira de
isolamento no banco.**

- **`public.operators`** 1:1 com `auth.users` (`id = auth.uid()`), guardando status e estado
  de provisionamento do runner (`fly_app_name`, `runner_status`, `connectors_status`).
- **`clients.operator_id`** (1:N) — cada cliente pertence a um operador. Backfill do
  `brunobracaioli` para o operador #1, depois `not null`.
- **`agent_jobs.operator_id`** denormalizado para o claim escopado por runner.
- **RLS policies** por `auth.uid()` em todas as tabelas client-scoped; `service_role`
  (runner/sistema) continua bypassando.
- **Web**: reads de UI passam a usar **client Supabase autenticado** (JWT do operador) — RLS
  força o isolamento no DB. `service_role` fica só para operações de sistema. Guarda de
  ownership server-side nas rotas `[slug]` (defense-in-depth sobre a RLS).
- **Auth**: Supabase Auth (senha/magic-link) via `@supabase/ssr`, substituindo o jose/senha
  única. Mantém rate-limit e Turnstile.

### Alternativas consideradas

- **Estender o auth atual (jose) + tabela `operators` com Argon2id** — manteria a infra de
  cookie atual, mas exigiria fiar `auth.uid()` na mão para a RLS (set claim/JWT custom) e
  reimplementar reset de senha/magic-link. Rejeitado: Supabase Auth dá `auth.uid()` nativo e
  é a stack declarada no CLAUDE.md.
- **Sem RLS, só filtragem na camada de serviço** — um esquecimento de `where` vaza dados
  cross-tenant. Rejeitado por violar defense-in-depth; RLS é a rede de segurança no DB.
- **N:N (`operator_clients`) desde já** — flexível para equipes, mas o runner-por-operador
  torna um cliente naturalmente de **um** operador (a conta Meta dele). 1:N é mais simples;
  N:N fica como extensão futura.

## Consequences

**Positivas:** isolamento forçado no banco (não depende de disciplina de código); identidade
individual, reset de senha e MFA prontos do Supabase Auth; trilha auditável com `operator_id`.

**Negativas / dívidas:** refator do caminho de leitura do dashboard (de `service_role` para
client autenticado); migração de sessão (jose → Supabase) exige cutover de login; backfill do
bruno é passo manual controlado. Compartilhamento de cliente entre operadores fica para depois.
