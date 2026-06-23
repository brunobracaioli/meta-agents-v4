# ADR 0027 — Um runner Fly por operador (credencial Claude + connectors isolados)

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-18 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/SPEC-017-multi-operator-multitenant.md](../specs/SPEC-017-multi-operator-multitenant.md) |
| Relacionado | [ADR 0001](0001-fly-machine-supercronic.md) (runner Fly/supercronic), [ADR 0009](0009-on-demand-agent-jobs-queue.md) (fila), [ADR 0026](0026-multi-operator-tenancy.md) |

## Context

Hoje há **1 máquina Fly** (`meta-agents-v4`) com **1 conta Claude** (a do Bruno) e seus
connectors (Meta Ads, Supabase) em `/home/runner/.claude/.credentials.json` (volume
`claude_state`), seedada uma vez via `claude login` interativo. No modelo multi-operador,
**cada operador usa a própria conta Anthropic** e conecta os MCP de Meta/Google como
connector pessoal no claude.ai dele. A credencial OAuth do Claude **carrega os connectors**
do operador — ela é a chave que dá acesso às contas Meta/Google daquele operador.

Como rodar N operadores, cada um com sua credencial Claude + connectors?

## Decision

**Provisionar 1 runner Fly por operador.** Cada app tem seu volume `.claude`, sua credencial
Claude (a conta Anthropic do operador) e seus connectors. O app recebe `OPERATOR_ID=<uuid>`
e claima **apenas** os jobs daquele operador (`claim_agent_job(worker_id, $OPERATOR_ID)`).

- **`$HOME/.claude/.credentials.json`** = conta Claude + connectors **do operador** (nível HOME).
- **`/app/clients/<slug>/.claude/...`** = workspace por cliente (nível projeto — ADR 0028).
- `scripts/provision-operator-runner.sh` cria o Fly app + volume + secrets do operador (IaC).
- O operador faz `claude login` + conecta Meta/Google **uma vez** no runner dele (passo
  manual; `connectors_status` reflete a prontidão; enqueue bloqueado até `ready`).

### Alternativas consideradas

- **Runner compartilhado multi-HOME** (`/home/runner/<operator>/.claude`, poller seta `HOME`
  por job) — mais barato (1 máquina), mas concentra as credenciais OAuth + connectors de
  **todos** os operadores no mesmo box: um comprometimento expõe acesso às contas Meta/Google
  de todos. Rejeitado por violar least-privilege/isolamento.
- **Operador auto-hospeda o runner (template)** — isolamento ótimo e casa com o nome do repo
  (`..._template`), mas inviável se operadores forem clientes externos não-técnicos.
  Permanece como caminho para operadores internos/técnicos, não como default do produto.

## Consequences

**Positivas:** isolamento físico por operador (1 box comprometido não vaza os outros);
billing Anthropic naturalmente por operador; connectors do operador nunca compartilhados.

**Negativas / dívidas:** custo e operação escalam por operador (N apps Fly); provisionamento
precisa de automação (Fly API/flyctl) e de um passo manual de `claude login` + connectors por
operador; gestão de N volumes/secrets. O reaper de jobs órfãos (dívida do ADR 0009) passa a
valer por runner. A latência de ~60s do cron (ADR 0009) é inalterada.
