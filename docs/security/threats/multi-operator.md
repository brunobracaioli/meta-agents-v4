# Threat Model (STRIDE) — Multi-operador / Multi-tenant

> Spec: [docs/specs/SPEC-017-multi-operator-multitenant.md](../../specs/SPEC-017-multi-operator-multitenant.md).
> ADRs [0026](../../adr/0026-multi-operator-tenancy.md)/[0027](../../adr/0027-runner-per-operator.md)/[0028](../../adr/0028-per-client-claude-workspace.md).
> Atualizar quando a superfície mudar.

## Superfície de ataque (acréscimo sobre [web-dashboard.md](web-dashboard.md))

Vários operadores com identidade própria (Supabase Auth); dados multi-tenant isolados por
RLS (`auth.uid()`); 1 runner Fly **por operador** com a credencial Claude + connectors
(Meta/Google) daquele operador; provisionamento de runner (Fly API/flyctl); enqueue de jobs
escopado por operador; workspace `.claude` por cliente no runner.

Mudança de superfície vs ADR 0006: deixa de ser 1 senha/1 operador. Agora há **fronteira de
isolamento entre operadores** — o risco central é **cross-tenant** (A acessar dados/jobs/contas de B).

## STRIDE

### S — Spoofing
- **Ameaça:** acesso como outro operador. **Mitigação:** Supabase Auth (não rolar crypto
  própria); sessão cookie httpOnly/Secure/SameSite=Lax; MFA disponível, **obrigatória para
  contas com runner provisionado**. Rate-limit + Turnstile no login (herdado).
- **Ameaça:** signup abusivo cria operadores em massa. **Mitigação:** rate-limit no signup;
  provisionamento de runner é passo gated (aprovação/manual), não automático no signup.

### T — Tampering
- **Ameaça:** operador A altera dado de B via API. **Mitigação:** RLS por `auth.uid()` no DB
  **+** guarda de ownership server-side nas rotas `[slug]`; reads de UI via client autenticado
  (nunca `service_role`). Queries parametrizadas (supabase-js).
- **Ameaça:** runner de A executa skill no workspace/cliente de B. **Mitigação:** `run-skill.sh`
  valida `client.operator_id == $OPERATOR_ID` antes do `cd` no workspace; aborta se divergir.

### R — Repudiation
- **Ameaça:** ação sem rastro de quem foi. **Mitigação:** `agent_jobs.operator_id`,
  `operation_logs`/`agent_events` carregam o operador; cada job é uma linha auditável.

### I — Information disclosure
- **Ameaça:** A lê clientes/campanhas/análises de B. **Mitigação:** RLS deny-by-default com
  policy por `auth.uid()` em todas as tabelas client-scoped; `service_role` nunca chega ao browser.
- **Ameaça:** credencial Claude/connectors de B exposta. **Mitigação:** **1 runner por
  operador** (ADR 0027) — sem box compartilhado; credencial só no volume do runner do operador,
  nunca no banco nem no repo. Plataforma **não armazena** token Meta/Google.
- **Ameaça:** PII nos logs. **Mitigação:** logs sem PII (herdado); só IDs internos.

### D — Denial of service / custo
- **Ameaça:** A enfileira jobs que drenam o custo (LLM/Meta) de B. **Mitigação:** enqueue só
  para clientes do próprio operador (ownership); dedup `agent_jobs_one_active_per_kind`;
  rate-limit por operador; budget caps por cliente (`daily_budget_cap_cents`).
- **Ameaça:** um operador esgota recursos do runner compartilhado. **Mitigação:** runner é
  **dedicado** por operador — blast radius contido ao próprio operador.

### E — Elevation of privilege
- **Ameaça:** A dispara trabalho/gasto na conta de B. **Mitigação:** **3 barreiras** —
  enqueue valida ownership (operator_id do JWT) → `claim_agent_job` escopado por `$OPERATOR_ID`
  (runner de A nunca pega job de B) → `run-skill.sh` revalida `client.operator_id`. Criação
  nasce PAUSED; ativação revalida cliente+PAUSED+budget≤teto.
- **Ameaça:** skill cria/ativa num `ad_account_id` que o operador não controla. **Mitigação:**
  a skill confirma o account em `ads_get_ad_accounts` (connector do operador) antes de gastar.
- **Ameaça:** operador suspenso continua operando. **Mitigação:** `status='suspended'` bloqueia
  enqueue; runner pausado (`fly machine stop`).

## Checklist antes do deploy

- [ ] RLS com policy por `auth.uid()` em TODAS as tabelas client-scoped (testado com 2 contextos)
- [ ] Reads de UI via client autenticado; `service_role` ausente do bundle client (`grep` no `.next`)
- [ ] Guarda de ownership nas rotas `[slug]` (404 cross-tenant)
- [ ] `claim_agent_job` escopado por `OPERATOR_ID`; runner de A não pega job de B (testado)
- [ ] `run-skill.sh` valida `client.operator_id == OPERATOR_ID` antes de executar
- [ ] Enqueue valida ownership + `runner_status='ready'` + operador não suspenso
- [ ] Nenhum token Meta/Google no diff, no banco ou no repo (`gitleaks`)
- [ ] Supabase Auth: rate-limit no signup/login, Turnstile, MFA para contas com runner
- [ ] Logs sem PII; erros genéricos ao cliente
