# 0034 — Flow Builder: DAG persistido no Supabase, 1 agent_job por card sobre a fila existente

- **Status:** proposed
- **Data:** 2026-07-03
- **Decisores:** Bruno Bracaioli (operador), Claude Code
- **Relacionados:** [SPEC-020](../specs/SPEC-020-flow-builder.md), ADR 0009 (fila
  `agent_jobs`), ADR 0026/0027 (multi-tenant + runner escopado), ADR 0030 (skills do operador,
  `skill_schedules`, postura de segurança do runner), ADR 0003 (bucket público `ad-ingest`)

## Context

O operador quer montar pipelines de criação **visualmente** (canvas estilo ManyChat/n8n):
cards tipados com input/output/conectores — scraping → copy → criativo de imagem →
aprovação → campanha Meta — recombináveis para qualquer nicho. Hoje a orquestração é
**intra-skill**: `create-traffic-*` executa todas as etapas numa única sessão `claude -p`
de até 25 min, sem recombinação, sem retry parcial e sem pausa humana.

Os building blocks já existem (subagents `scrape-extractor`/`copywriter`/
`image-prompt-generator`, skill `image-generate`, MCP Meta, fila `agent_jobs` + runner Fly +
telemetria `agent_events`). Faltam três coisas: persistência do grafo, um motor de avanço de
DAG e a UI de canvas. As decisões estruturais são: **onde vive o grafo**, **como o DAG
executa** e **quem orquestra**.

## Decision

### 1. Grafo em jsonb (`flows.graph`) + snapshot imutável por run — sem motor externo

O grafo vive em `flows.graph` (jsonb espelhando o React Flow) e cada Run congela um
`flow_runs.graph_snapshot`; o motor só lê o snapshot, então **editar o flow nunca corrompe um
run em andamento**. Steps são normalizados por run (`flow_step_runs`, 1 linha por node, com
`config`/`input`/`output` jsonb) porque é neles que há query por status e avanço.

**Alternativas descartadas:** (a) nodes/edges normalizados na definição — N upserts por
autosave e nenhuma query jamais olha edge individual; (b) tabela `flow_versions` — o snapshot
do run já audita o que rodou, histórico de edição é future work aditivo; (c) motor externo
(Temporal, QStash chains, Vercel Workflow) — terceiro plano de execução para operar, sem
acesso natural ao runner Fly (que não expõe HTTP — ADR 0009) e redundante com a fila que já
tem claim atômico, retry, timeout e telemetria validados em produção.

### 2. **1 `agent_job` por card** (kind `flow_step`), não 1 job por flow

Cada action card vira um `agent_jobs` `{skill:'flow-step-runner', kind:'flow_step',
args:{step_run_id}}`. Racional contra a alternativa "flow inteiro numa sessão":

- o timeout de 25 min viraria teto do flow inteiro (o pipeline atual já beira isso);
- retry seria só do zero — por card, um passo caro (imagens) não se perde porque a Meta falhou;
- o card de **aprovação humana é impossível** numa sessão viva (não se pausa `claude -p` por
  horas); como gate resolvido em SQL, custa zero;
- telemetria/HUD por card de graça (`agent_events.run_id = AGENT_JOB_ID`).

Custos aceitos: 1 sessão Claude por action e até ~1 min de fila por hop nos caminhos que
dependem do poller — mitigado porque `complete_flow_step` chama `advance_flow_run` **na mesma
transação** (o hop feliz não espera tick). Fusão de cards baratos num job (híbrido) fica como
future work.

### 3. Orquestração em **SQL puro** (RPCs `security definer`) + poller de safety-net

`start_flow_run` / `advance_flow_run` / `complete_flow_step` / `fail_flow_step` /
`approve_flow_step` / `cancel_flow_run` — todas idempotentes, EXECUTE só service_role (padrão
`claim_agent_job`). `advance_flow_run` enfileira todo step cujos upstreams completaram,
montando o `input` a partir dos `output` upstream mapeados por porta (handle), e resolve gates
(`approval`, `condition`) sem job. Um novo `poll-flow-runs.sh` (clone estrutural do
`poll-skill-schedules.sh`, 1×/min) só **reconcilia**: steps órfãos de jobs mortos → fail, e
re-advance idempotente de runs `running`.

**Alternativa descartada:** orquestrador em Node (rota Vercel ou serviço no Fly) — precisaria
de trigger próprio (webhook/poll), reimplementaria transacionalidade que o Postgres dá de
graça, e criaria um segundo lugar com lógica de estado além do banco.

### 4. Uma skill executora genérica (`flow-step-runner`), grafo nunca escolhe skill

O runner executa sempre a mesma skill baked, parametrizada **apenas** por `step_run_id`
(UUID — único token que cruza o shell, validado por regex no poller). A skill lê
tipo+config+input do banco via REST e despacha para `steps/<tipo>.md`, reusando os subagents
e skills existentes; valida o output contra o contrato antes do `complete_flow_step`.

**Alternativas descartadas:** (a) uma skill por node type — N entradas de allowlist e N
boilerplates idênticos de fetch/complete para o mesmo isolamento que `steps/*.md` já dá;
(b) materialização efêmera estilo `client_skills` — node types são **code-owned**, não
autoria do usuário; não há nada a materializar.

### 5. UI com `@xyflow/react` (React Flow)

Dependência nova no `web/`. É o padrão de mercado (n8n usa), MIT, custom nodes são componentes
React normais, handles nativos = portas tipadas, e é compatível com a CSP nonce-based do
projeto (`style-src 'unsafe-inline'` já liberado; zero conexões externas). Reatividade do run
por **polling 4s** (padrão `live-feed.tsx`) — mantém a decisão do projeto de não usar Supabase
Realtime com RLS deny-by-default.

**Alternativas descartadas:** canvas caseiro (semanas de pan/zoom/edge-routing sem valor
diferencial) e rete.js (menos React-idiomático, comunidade menor).

### 6. Guardrails de gasto e segurança herdados + gate humano

Mesma postura do ADR 0030: a defesa primária não é permissão de tool no runner
(`allowed-tools` não é enforced sob `--dangerously-skip-permissions`), e sim (a) escopo do
operador (RLS + claim escopado + 3ª barreira do `run-skill.sh`) e (b) gates de gasto na
API Meta: **tudo nasce PAUSED**, `dailyBudgetCents ≤ clients.daily_budget_cap_cents` (422 no
run, sem clamp), ativação fora do flow, e — decisão do operador — card de **aprovação humana
antes do card Meta como template default** da v1.

## Consequences

**Positivas:**
- Pipelines recombináveis por qualquer nicho sem tocar em código/deploy — a skill monolítica
  vira um flow editável.
- Reuso total de fila, claim escopado, timeout, telemetria e barreiras de tenancy já
  validados; nenhum executor novo para operar.
- Retry, custo e observabilidade com granularidade de card; pausa humana sem custo de sessão.
- Snapshot por run dá auditoria exata do que executou, mesmo com o flow editado depois.

**Negativas / trade-offs:**
- Mais sessões `claude -p` (uma por action) e até ~1 min de latência de fila nos caminhos de
  reconciliação — aceito; mitigação futura: drenar N jobs/tick no poller.
- Lógica de avanço em plpgsql é menos ergonômica de testar que TypeScript — compensada por
  RPCs pequenas, idempotentes e critérios de aceite E2E (SPEC-020 §8).
- Contratos de node duplicados (Zod no web, JSON Schema na skill) — drift mitigado por teste
  de paridade no CI (Wave 4).
- Recriar o CHECK/índice de `agent_jobs.kind` é migração delicada — trivial aqui porque o
  kind novo ainda não tem jobs.
- Nova superfície de ataque (grafo do usuário vira execução) — endereçada por: grafo nunca
  escolhe skill, node types em CHECK+registry, config jsonb jamais interpolada em shell,
  threat model dedicado (`docs/security/threats/flow-builder.md`, PR da Wave 2).
