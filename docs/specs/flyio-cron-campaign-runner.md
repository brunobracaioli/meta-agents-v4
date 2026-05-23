# Spec — Fly.io Cron Campaign Runner

| Campo | Valor |
|---|---|
| Status | accepted |
| Owner | brunobracaioli |
| Última atualização | 2026-05-19 |
| Plano de fundo | `~/.claude/plans/claude-estamos-na-fase-idempotent-pumpkin.md` |
| ADR relacionado | [docs/adr/0001-fly-machine-supercronic.md](../adr/0001-fly-machine-supercronic.md) |
| Threat model | [docs/security/threats/flyio-runner.md](../security/threats/flyio-runner.md) |
| Skill alvo | `.claude/skills/create-traffic-brunobracaioli-campaign/SKILL.md` |

## 1. Objetivo

Disparar **1x/dia, 10:00 BRT**, de forma totalmente não-interativa, o comando:

```bash
claude -p --dangerously-skip-permissions ".claude/skills/create-traffic-brunobracaioli-campaign"
```

dentro de uma **Fly Machine** em `gru`, criando 1 campanha de tráfego PAUSED + 1 adset PAUSED + 3 ads PAUSED no ad account `225179730538661` (cliente nome do cliente), com cap absoluto de R$ 50/dia.

A skill já é **headless-safe** (validada localmente em 2026-05-19 18:05 — campanha `120246183822430505`). O runner é uma camada fina; toda inteligência (scrape, copy, imagens, persistência) está dentro da skill.

## 2. Contratos

### 2.1 Trigger → wrapper

Disparado pelo `supercronic` interno via entrada do `crontab` (TZ = `America/Sao_Paulo`):

```
0 10 * * * /app/scripts/run-skill.sh create-traffic-brunobracaioli-campaign
```

**Input do wrapper**: `$1 = client_skill_slug` (string, kebab-case, obrigatório).

### 2.2 Wrapper → Claude Code

```bash
timeout 1500 claude -p --dangerously-skip-permissions ".claude/skills/${SKILL}" 2>&1 | tee "${LOG}"
```

- `timeout=1500s` (25 min). Skill típica leva 5–10 min; folga para 1ª execução com imagens.
- `--dangerously-skip-permissions`: necessário em headless — justificativa de segurança no threat model §STRIDE-E.
- `cwd = /app`: garante que `.claude/` resolve.

### 2.3 Outputs

| Destino | Conteúdo |
|---|---|
| `/var/log/runs/<utc-ts>-<skill>.log` | Stdout/stderr completo do `claude -p`. Persiste no volume `claude_state`. |
| `fly logs -a meta-agents-v3` | Mesmo conteúdo via supercronic `-passthrough-logs`. Retenção ~30d. |
| `/app/tentativas-geracao-de-campanhas/<ts>-trafego.json` | Manifest da execução (gerado pela skill). |
| Meta Ads (account `225179730538661`) | 1 campanha PAUSED `[TRF][CCA][YYYY-MM-DD]` + 1 adset PAUSED + 3 ads PAUSED. |
| Supabase (via MCP) | Registros que a skill normalmente persiste — runner não escreve direto. |

### 2.4 Exit codes do wrapper

| Code | Significado |
|---|---|
| `0` | Skill rodou e retornou sucesso. |
| `2` | Skill não encontrada em `/app/.claude/skills/<slug>/SKILL.md`. Falha pré-claude — zero custo. |
| `3` | OAuth do Claude Code não está seedado (`/home/runner/.claude/.credentials.json` ausente). |
| `124` | Timeout do `timeout 1500` — skill travou. |
| Outros | Exit code do `claude -p`. |

## 3. Variáveis de ambiente (via `fly secrets`)

**Nunca embarcadas na imagem.** `.env.local` está em `.dockerignore`.

| Nome | Origem em `.env.local` local | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | `CLAUDE_API_KEY` | Fallback SDK e cobertura de chamadas API-only feitas dentro de skills. |
| `OPENAI_API_KEY` | igual | `/image-generate` (gpt-image-2). |
| `SUPABASE_URL` | igual | MCP + persistência. |
| `SUPABASE_SERVICE_ROLE_KEY` | igual | MCP server-side. |
| `SUPABASE_ANON_KEY` | igual | Quando algum tool usa anon. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | igual | Cache e rate-limit. |
| `WORKSPACE_MAX_DAILY_BUDGET_CENTS` | `=5000` | Cap respeitado pela skill. |
| `WORKFLOW_LLM_BUDGET_USD_CAP` | `=2.00` | Cap LLM. |

A **conta Claude.ai + connectors Claude.ai (Meta MCP, Supabase MCP)** vem do **volume** em `/home/runner/.claude`, não de env. Seed manual via `fly ssh console` → `claude` (única vez).

## 4. Fluxo (passo a passo)

1. `supercronic` lê `crontab`. Às 10:00 BRT chama `/app/scripts/run-skill.sh create-traffic-brunobracaioli-campaign`.
2. Wrapper valida (a) skill existe; (b) OAuth seedado. Falha rápido se algum falhar.
3. Cria `/var/log/runs/<ts>-<skill>.log` e faz `cd /app`.
4. Executa `claude -p --dangerously-skip-permissions ".claude/skills/<skill>"`, com `timeout 1500`, output `tee`'d.
5. Skill internamente: lista cliente → scrape landing page → gera prompts de imagem → gera imagens via `/image-generate` → gera copy → cria campaign + adset + 3 ads via Meta MCP (tudo PAUSED) → grava manifest.
6. Wrapper captura `${PIPESTATUS[0]}`, loga `RUN_RESULT skill=... exit=... log=...`, propaga exit.
7. supercronic mantém a Machine viva. Próximo disparo: 24h depois.

## 5. Edge cases

| Cenário | Comportamento |
|---|---|
| OAuth expirou | wrapper exit 3 OU `claude` falha de auth. `fly logs` mostra. Operador refaz seed. |
| Skill movida/renomeada | exit 2 antes de chamar claude. Zero custo. |
| MCP Meta indisponível | Skill retorna erro; exit ≠ 0 propaga; nada criado em Meta. |
| Reboot da Machine entre 09:59 e 10:01 BRT | supercronic perde o slot. Aceito (próximo dia roda). |
| Disparo manual via SSH durante o cron | Ambos rodam. Ambos terminam PAUSED. Custo Meta = 0 até ativação manual. |
| LLM cria campanha duplicada por hallucination | Mesmo cenário: PAUSED. Custo LLM cap'd em $2.00. |
| Volume corrompido | Re-seed via SSH (~2 min). |
| `fly logs` rotaciona | Log também no volume em `/var/log/runs/`. |

## 6. Critérios de aceite

- [ ] `fly deploy` completa; Machine `started` em `gru`; healthz `passing` em ≤ 60s.
- [ ] `fly ssh console -C "claude --version"` retorna versão pinada no Dockerfile.
- [ ] `fly ssh console -C "supercronic -test /app/crontab"` exit 0.
- [ ] Após seed manual, `/home/runner/.claude/.credentials.json` existe e é JSON válido.
- [ ] `fly ssh console -C "/app/scripts/run-skill.sh create-traffic-brunobracaioli-campaign"` cria 1 campanha PAUSED + 1 adset PAUSED + 3 ads PAUSED, exit 0.
- [ ] Manifest aparece em `/app/tentativas-geracao-de-campanhas/`.
- [ ] Próximo 10:00 BRT: disparo automático visível em `fly logs` com `RUN_START` e `RUN_RESULT exit=0`.
- [ ] Threat model preenchido em `docs/security/threats/flyio-runner.md`.

## 7. Operação

### 7.1 Seed inicial (1 vez)

```bash
fly ssh console -a meta-agents-v3
# dentro do container:
claude       # OAuth flow no browser; tokens gravados em /home/runner/.claude/
exit
```

### 7.2 Execução manual

Em produção, o cron via supercronic já roda como `runner` (devido a `USER runner` no Dockerfile), então env vars do `fly secrets` são herdadas naturalmente. Para teste manual via SSH, **use `runuser` em vez de `su - runner -c`** — o `su -` cria um shell de login limpo que apaga env vars do PID 1:

```bash
# CORRETO (preserva env do PID 1):
fly ssh console -a meta-agents-v3 -C "runuser -u runner -- /app/scripts/run-skill.sh create-traffic-brunobracaioli-campaign"

# ERRADO (env vazio → skill roda em modo degradado):
fly ssh console -a meta-agents-v3 -C "su - runner -c '/app/scripts/run-skill.sh ...'"
```

### 7.3 Inspeção de logs

```bash
fly logs -a meta-agents-v3                                 # tempo real
fly ssh console -a meta-agents-v3 -C "ls /var/log/runs/"   # arquivos persistidos
```

### 7.4 Mudança de cadência

Edite `crontab`, commit, `fly deploy --remote-only`.

## 8. Não-objetivos desta entrega

- Tabela `campaign_runs` no Supabase com dedup forte: skill já encerra em PAUSED + cap LLM em $2; impacto financeiro real é zero antes de ativação manual.
- Multi-cliente: primeiro `brunobracaioli`. cliente na onda 2.
- Dashboard observabilidade: `fly logs` + manifest folder são suficientes.
- Retry automático em falha: 1x/dia é suficiente; operador investiga falhas no dia seguinte.
