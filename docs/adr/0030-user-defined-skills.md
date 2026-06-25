# 0030 — Skills criadas pelo operador (armazenadas no banco, materializadas em runtime)

- **Status:** accepted
- **Data:** 2026-06-25
- **Decisores:** Bruno Bracaioli (operador), Claude Code
- **Relacionados:** [SPEC-018](../specs/SPEC-018-client-and-skill-management.md),
  ADR 0026/0027/0028 (multi-tenant), ADR 0012 (Fly cron runner), ADR 0019 (Ultron autônomo),
  ADR 0029 (connector Meta B2 Tech)

## Context

Toda skill hoje é um arquivo `.claude/skills/<name>/SKILL.md` **baked na imagem do runner Fly** e
executada por `scripts/run-skill.sh` via `claude -p ".claude/skills/<name>"`. Um operador
não-técnico **não consegue criar automações pela UI** — depende de um dev editar o repo e refazer
o deploy. O multi-tenant (SPEC-017) pressupõe operadores autônomos, mas a criação de skills ficou
de fora.

Queremos que o operador crie skills num **fluxo guiado IA-assistido** no frontend, com opção de
**agendar** (recorrência) e de **expor ao Ultron** (function_calling). Isso esbarra em três
decisões estruturais.

## Decision

### 1. Skill do operador vive no **banco**, materializada em runtime

Skills criadas pela UI são armazenadas em `public.client_skills` (corpo markdown + `allowed_tools`
+ `capability` + metadados). Como o operador **não pode escrever no disco da imagem do runner**, o
`run-skill.sh` **materializa** a skill num `SKILL.md` efêmero (`${WORKSPACE_ROOT}/.claude/skills/
<slug>/SKILL.md`) buscando o corpo via Supabase REST **só quando** a skill não existe no disco e o
job carrega `skill_id`. Isso reusa 100% do caminho `claude -p` + telemetria + ownership guard
existentes, sem um segundo executor.

**Alternativas descartadas:** (a) passar o corpo inline como prompt do `claude -p` — perde o
frontmatter `allowed-tools` e a semântica de skill; (b) re-deploy do runner a cada skill — inviável
e lento; (c) bucket de skills versionadas sincronizado por pull — complexidade sem ganho sobre o DB.

### 2. Ultron ganha **tools dinâmicas** geradas do banco

As tools do Ultron eram `Anthropic.Tool` hardcoded + allowlists fixas (`CREATE_SKILL_BY_SLUG`).
Skills com `ultron_enabled` passam a ser **geradas dinamicamente** por operador a partir de
`ultron_function` (`{name, description, parameters}`). O handler enfileira um `agent_jobs`
(kind=`custom`, `skill_id`) — nunca executa a Meta direto — e skills `capability='write'` mantêm a
confirmação 2-turnos. O nome recebe prefixo `run_custom_<slug>` p/ não colidir com tools estáticas.

### 3. Agenda é **DB-driven**, não mais só `/crontab`

Em vez de hardcodar cron no `/crontab`, recorrências do operador vivem em `skill_schedules` com
`next_run_at` calculável em **SQL puro** (`compute_next_run`) — possível porque o picker de
recorrência (diário/semanal/horário) é um subconjunto fechado, sem necessidade de um parser de cron
no runner bash. Um novo `poll-skill-schedules.sh` (cron `* * * * *`) só **enfileira** jobs devidos;
quem executa continua sendo o `poll-agent-jobs.sh`. As crons baked do bruno coexistem (migração é
futura).

### 4. Enquadramento de risco e guardrails

Uma skill do operador **não é escalada de privilégio**: o operador já pode fazer tudo nos
*próprios* clientes (conta Anthropic, connectors e dinheiro dele). É automação da própria
autoridade. Os controles são:

- **Cross-tenant:** RLS por `auth.uid()` em `client_skills`/`skill_schedules` + `operator_id`
  denormalizado p/ claim escopado + 3ª barreira do `run-skill.sh` (já existente).
- **Runaway/DoS:** intervalo mínimo ≥ 15 min na agenda; índice parcial one-active-per-skill;
  `daily_budget_cap_cents`; writes PAUSED por padrão.
- **Prompt-injection de dados externos** (skill que lê uma página e é manipulada): `allowed_tools`
  por skill (frontmatter `allowed-tools`), escopo do operador, e gates de gasto. **Não** dependemos
  *só* do `allowed-tools` — ver spike abaixo.
- **Segredos:** `body` é só instrução; tokens Meta/Google/CAPI nunca entram (validação + grep no CI).

**Spike (Wave 2):** confirmar empiricamente se `allowed-tools` no frontmatter é respeitado sob
`--dangerously-skip-permissions`. Resultado a ser anexado a este ADR. Se insuficiente, a mitigação
de gasto (budget cap + PAUSED + escopo do operador) permanece como defesa primária e o
`allowed-tools` como defesa-em-profundidade.

## Consequences

**Positivas:**
- Operador cria automações sem tocar no repo nem no deploy.
- Reuso total do executor de skills, da fila e da telemetria existentes.
- Agenda e exposição ao Ultron viram dados, não código — auditáveis e RLS-isoladas.

**Negativas / trade-offs:**
- Nova superfície de ataque (instruções autoria-do-usuário executadas por agente) — endereçada
  pelo threat model e pelos guardrails acima.
- Materialização DB→disco adiciona uma chamada REST por run de skill custom (custo desprezível).
- `compute_next_run` em plpgsql cobre só o subconjunto do picker; cron cru arbitrário fica fora do
  v1 (decisão de produto: picker amigável).
- Dois pollers de cron no runner (jobs + schedules) — separação de responsabilidades, custo de 1
  linha de crontab e 1 lock.
