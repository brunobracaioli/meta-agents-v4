# Threat Model (STRIDE) — Skills criadas pelo operador

> Spec: [docs/specs/SPEC-018-client-and-skill-management.md](../../specs/SPEC-018-client-and-skill-management.md).
> ADR [0030](../../adr/0030-user-defined-skills.md). Base: [multi-operator.md](multi-operator.md).
> Atualizar quando a superfície mudar.

## Superfície de ataque (acréscimo sobre [multi-operator.md](multi-operator.md))

O operador cria **skills** (instruções markdown + `allowed_tools` + capacidade) pela UI; elas vivem
em `client_skills` (RLS por `auth.uid()`) e são **materializadas em runtime** num `SKILL.md` efêmero
e executadas por `claude -p --dangerously-skip-permissions` no runner do operador, com os connectors
dele (Meta/Google/Cloudflare/Supabase). Gatilhos: manual, agenda (`skill_schedules` + novo poller) e
Ultron (function_calling com tools dinâmicas). Há também CRUD de clientes pela UI.

**Enquadramento central:** a skill executa com a autoridade que o operador **já tem** sobre os
*próprios* clientes — **não é escalada de privilégio**. Os riscos são (1) cross-tenant, (2)
runaway/custo, (3) prompt-injection de dados externos dentro da própria autoridade, (4) injeção via
campos da skill no enqueue/materialização.

## STRIDE

### S — Spoofing
- **Ameaça:** invocar skill de outro operador. **Mitigação:** RLS em `client_skills`/`skill_schedules`
  (`operator_id = auth.uid()`); Ultron só monta tools dinâmicas do operador logado; claim de agenda
  escopado por `OPERATOR_ID`.

### T — Tampering
- **Ameaça:** A edita/cria skill ou agenda de B via API. **Mitigação:** `assertOperatorOwnsClient`
  antes de todo write + RLS no DB; `version` otimista em `client_skills` evita lost-update.
- **Ameaça:** slug malicioso colide com skill baked p/ sequestrar execução. **Mitigação:**
  materialização só ocorre se o arquivo **não** existe no disco (baked nunca é sobrescrito); API
  rejeita slugs reservados (lista de skills baked) e valida `^[a-z0-9-]{2,40}$`.
- **Ameaça:** injeção via `args`/`slug` no `run-skill.sh` (shell). **Mitigação:** charset restrito
  validado server-side; args só `key=value` tokens (herdado); slug usado em path validado.

### R — Repudiation
- **Ameaça:** automação dispara sem rastro. **Mitigação:** todo gatilho gera um `agent_jobs`
  (`operator_id`, `client_id`, `skill_id`, `args`) auditável; agenda registra `last_run_at`/
  `last_job_id`; telemetria `agent_events` por run.

### I — Information disclosure
- **Ameaça:** segredo (token Meta/Google/CAPI) embutido no `body` da skill, exposto a quem lê o DB
  ou os logs. **Mitigação:** `body` é só instrução; validação na API + grep no CI; connectors/
  credenciais nunca no banco (vivem no `~/.claude` do runner — ADR 0027).
- **Ameaça:** skill lê dados de cliente de B. **Mitigação:** 3ª barreira do `run-skill.sh`
  (`client.operator_id == OPERATOR_ID`) + RLS; runner por operador (sem box compartilhado).

### D — Denial of service / custo
- **Ameaça:** agenda agressiva (a cada minuto) exaure runner/leilão Meta. **Mitigação:** intervalo
  mínimo ≥ 15 min (CHECK + Zod); `next_run_at` server-side (operador não controla a cadência do
  poller); single-flight lock no poller.
- **Ameaça:** loop de gasto (skill que cria/ativa campanha repetidamente). **Mitigação:** writes
  PAUSED por padrão; `daily_budget_cap_cents`; índice parcial one-active-per-skill (não acumula
  jobs custom duplicados); ativação só explícita (skill `activate-*` / confirmação 2-turnos Ultron).
- **Ameaça:** `POST /draft` (Anthropic) abusado p/ custo de tokens. **Mitigação:** rate-limit por
  operador (reusar `rateLimiters`); só operador autenticado.

### E — Elevation of privilege
- **Ameaça:** skill chama tool fora do declarado p/ agir além do pretendido. **Realidade (spike
  2026-06-25):** `allowed_tools` no frontmatter **NÃO** é enforced sob `--dangerously-skip-permissions`
  — uma skill `allowed-tools: Read` rodou `Bash`. Logo o `allowed_tools` é **advisory**, não uma
  barreira de runtime. **Mitigação real:** a skill nunca excede a autoridade que o operador já tem
  sobre os *próprios* clientes (sem cross-tenant — RLS + 3ª barreira do `run-skill.sh`), e o gasto é
  gated a nível de Meta API (PAUSED + `daily_budget_cap_cents` + ativação explícita). `capability='write'`
  e a confirmação 2-turnos do Ultron são gates de fluxo/UX, não de runtime. **Futuro:** rodar skills
  custom sem `--dangerously-skip-permissions` + `settings.json` allow-listado torna isso enforced (ADR 0030).
- **Ameaça:** prompt-injection de dado externo (página/relatório que a skill lê) reescreve o
  objetivo. **Mitigação:** escopo do operador + gates de gasto limitam o dano ao próprio tenant;
  `allowed_tools` restringe o leque; writes PAUSED dão janela de revisão.

## Checklist antes de mergear (por wave)

- [ ] RLS validado em dois contextos `auth.uid()` (A não lê/edita skill/agenda de B).
- [ ] `assertOperatorOwnsClient` antes de todo write; reads de UI sem `service_role`.
- [ ] Slug validado + slugs reservados (baked) rejeitados; baked nunca sobrescrito.
- [ ] Intervalo mínimo de agenda aplicado (CHECK + Zod).
- [ ] Sem segredo no `body`/diff/banco (grep).
- [ ] Writes rodam PAUSED + budget cap; ativação só explícita.
- [ ] Rate-limit no `/draft`.
- [ ] Spike `allowed-tools` documentado no ADR 0030.
